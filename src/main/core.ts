// Crypthy 코어: 상태·폴링·안전 정지·수익·설정. Electron 에 의존하지 않는다.
// 데스크톱(main.ts, Electron 셸)과 헤드리스(headless.ts, Node + 원격 API)가 같은 코어를 쓴다.
// 화면·알림·대화상자처럼 실행 환경마다 다른 부분은 init 때 받은 env 로만 다룬다.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Alert, AppState, ChartsView, CompareRow, PnlView, SaleInput, GpuConfig, GpuId, GpuView, HubView, ProfitView, Settings, SetupView, SharedLedgerView, UpdateView, Vendor } from '../shared/types';
import { allowedLinks, knownProcessNames, loadCatalog, recommend, type Catalog } from './catalog';
import { DEFAULT_SETTINGS, isKryptexPool, mergeSettings, newGpu, parseBatArgs, readJson, shortName, validateAccount, writeJson } from './config';
import { linuxHardware, mockHardware, mockSeed, windowsHardware } from './hardware';
import { MINER_APIS, type MinerStats } from './minerApi';
import {
  autoStartDecision, controlProcessName, createMinerControl, decodeConsole, gpuSelectionEnv, isUsableProcessName, parseTaskStatus, parseTaskXml, spawnOptions,
  startBlocker, stripGpuArgs, unwrapConhost, validateControl, type Platform,
} from './minerControl';
import { parsePciBus, type NvGpu } from './nvsmi';
import {
  correctPayouts, dateKey, emptyLedger, migrateLedger, settleDrift, subtractEarnings, miningNetKrwPerHour, prlPerHour, PRICE_STALE_MS, recordEarnings, recordEnergy, recordPrice,
  rentalNetKrwPerHour, reviewAlerts, summarize, type Ledger, type Payout, type PoolStats,
} from './profit';
import {
  buildLimitsJson, followNvidiaLimits, isPowerTaskRegistered, readPowerLog, registerPowerTask, runPowerTask, validateWatts,
} from './powerLimit';
import { addSample, dailyClose, dailySeries, emptyHistory, historyToJson, loadHistory, parseMarketChart, seriesOf, type History } from './history';
import { linuxPower } from './powerLimitLinux';
import type { Logger } from './log';
import {
  addEnergy, addPending, addPoolIncrease, addSale, adjustMined, appendEvent, findPayoutDuplicates, bookDailyPoints, bootstrap, dailyCsv, emptyBook, estimateBackfillFrom, eventsCsv,
  clearPending, freshPayouts, loadBook, mergeEvents, pnlDaily, priceUnpriced, readEvents, replayEvents, separateLegacyBackfill, startTracking, summarizePnl,
  type PnlBook, type PnlEvent,
} from './pnl';
import {
  adoptPoolState, claimAutoSellDay, createMirror, createTailReader, ensureInstanceId, poolStateOf, readPoolState, readSharedEvents, readSharedSettings,
  SHARED_SETTING_KEYS, sharedEventsFile, sharedEventsStamp, sharedRoot, sharedSettingsOf, writePoolState, writeSharedSettings, type SyncState,
} from './shared';
import { fetchCoingecko, fetchKryptex, fetchKryptexPool, fetchMarketChart, fetchVastStats, type VastStats } from './remote';
import { evaluateSafety, type SafetyState } from './safety';
import { matchSrbDevice } from './srbminer';
import { nextRunAt, runAutoSell, validateAutoSell, type SellResult } from './autosell';
import { createSafeTrade, DEFAULT_FEE_RATE, type ExchangeKey, type Order } from './safetrade';
import { mapFromApi, mapFromListed, mergeMap, parseListDevices, resolveGpuIds, srbCacheKey, type SrbDeviceCache } from './srbDevices';
import { DISABLED_UPDATE, MAX_INTERVAL_MIN, MIN_INTERVAL_MIN } from './updater';

import { CONSENT_TEXT, type Confirm } from './confirm';
export { CONSENT_TEXT, NeedConfirm, type Confirm, type ConfirmKind } from './confirm';

export interface CoreEnv {
  /** 설정·장부·로그를 두는 폴더 */
  dataDir: string;
  version: string;
  /** 전력 제한 스크립트가 있는 resources 폴더 */
  resourcesDir: string;
  log: Logger;
  /** 알림 (데스크톱: OS 알림, 헤드리스: 로그) */
  notify(a: Alert): void;
  /** 상태가 바뀜 (데스크톱: 창·트레이 갱신) */
  onChange(): void;
  /** 업데이트 상태 (데스크톱만, 헤드리스는 비활성) */
  updateView?(): UpdateView;
  /** 설정 저장 뒤 셸 쪽 반영 (로그인 시 실행·업데이트 주기 등) */
  onSettings?(s: Settings): void;
  /** 공유 장부 폴더를 설정 대신 지정 (헤드리스 --shared-ledger) */
  sharedLedgerDir?: string;
  /** SafeTrade API 키 (데스크톱: OS 보안 저장소, 헤드리스: 0600 파일·systemd credential). 코어는 이 함수로만 받는다 */
  exchangeKey?(): ExchangeKey | null;
  /** 키 보관 방식 (화면 표시용) */
  exchangeKeyStore?(): string | null;
  /** 거래소 요청에 쓸 fetch (데스크톱: Electron net.fetch — SafeTrade 의 Cloudflare 가 Node fetch 를 막는다) */
  exchangeFetch?: typeof fetch;
}

let env: CoreEnv;

const MOCK = process.env.CRYPTHY_MOCK === '1';
const POLL_MS = 2000;
const REMOTE_MS = 5 * 60_000;
const VAST_MS = 30 * 60_000;
const MAX_ALERTS = 50;
const KILL_RETRY_MS = 15_000;
const KILL_CONFIRM_MS = 4000;
const REVIEW_REPEAT_MS = 6 * 3600_000;

const IS_LINUX = process.platform === 'linux';
const PLATFORM: Platform = IS_LINUX ? 'linux' : process.platform === 'win32' ? 'windows' : 'other';
const mockHw = MOCK ? mockHardware() : null;
const hw = mockHw ?? (IS_LINUX ? linuxHardware(() => knownMiners, () => [...ownMiners]) : windowsHardware);
/** 전력 제한 백엔드: Windows = UAC 1회 예약 작업, Linux = pkexec 1회 systemd 서비스 + polkit */
const power = IS_LINUX
  ? linuxPower
  : { isRegistered: isPowerTaskRegistered, register: registerPowerTask, run: runPowerTask, readLog: readPowerLog };
const powerUser = () => (IS_LINUX ? os.userInfo().username : `${process.env.USERDOMAIN}\\${process.env.USERNAME}`);
const file = (name: string) => path.join(env.dataDir, name);

interface Runtime {
  /** 안전 보류 GPU → 사유. 사용자가 해제하기 전까지 유지(앱 재시작·재부팅 후에도) */
  holds: Record<GpuId, string>;
  /** 채굴 켜기 전 위험·비용 고지에 동의한 시각 (처음 켤 때 1회) */
  minerConsentAt: number | null;
}

let catalog: Catalog;
let knownMiners: string[] = [];
/** 켜기·끄기에 지정한(또는 지정했던) 실행 파일 이름. 실행 중이면 설정을 바꿔도 꺼질 때까지 감시·정지 대상에 남긴다 */
let ownMiners = new Set<string>();
let links = new Set<string>();
/** 이 PC 의 GPU 벤더 (시작 시 1회 감지, 실패하면 nvidia-smi 결과로 NVIDIA 만) */
let vendors: Vendor[] = [];
let settings: Settings;
let ledger: Ledger;
let runtime: Runtime;
let safetyState: SafetyState = {};
let alerts: Alert[] = [];
let lastNv: NvGpu[] = [];
let lastStats: MinerStats | null = null;
let processes: string[] = [];
let running = false;
/** 켜기 직후 채굴기가 잡히기 전까지 (두 번 누름 방지) */
let startingUntil = 0;
/** 이번 실행이 앱의 켜기로 시작됐는지 (꺼지면 해제) */
let startedByApp = false;
/** 마지막 위험 정지(시각·내용). 켜기 전에 경고로 보여 준다 */
let lastDangerStop: { at: number; message: string } | null = null;
/** tasklist 가 실패해 프로세스 목록을 모르는 상태 */
let procsUnknown = false;
/** 이번 세션에 nvidia-smi 로 한 번이라도 보인 GPU (빠진 GPU 를 채굴 중으로 오판하지 않기 위해) */
const seenGpus = new Set<GpuId>();
let lastPollAt = 0;
let lastKillAt = 0;
let killing = false;
let history: History = emptyHistory();
/** 누적 손익 장부 (pnl/daily.json) 와 이벤트 로그 (pnl/events.jsonl) */
let pnl: PnlBook = emptyBook();
const pnlDir = () => file('pnl');
const pnlEvents = () => path.join(pnlDir(), 'events.jsonl');
/** 이벤트에는 고유 id 를 붙인다 (공유 장부에서 같은 이벤트를 한 번만 세려고) */
const logEvent = (ev: PnlEvent) => {
  appendEvent(pnlEvents(), { ...ev, id: ev.id ?? `${instanceId}-${Date.now().toString(36)}-${(eventSeq++).toString(36)}` } as PnlEvent);
  sharedDirty = true;
};
let eventSeq = 0;
// ---- 공유 장부 ----
let instanceId = 'local';
let sync: SyncState = { poolGen: 0, settingsGen: 0 };
let sharedBook: PnlBook | null = null;
let sharedOverlaps = 0;
let sharedStamp = '';
let sharedDirty = true;
let sharedStatus: SharedLedgerView | null = null;
/** 로컬 소급분을 날짜별 금액이 담긴 이벤트로 올렸는지 (실행마다 한 번 확인) */
let backfillShared = false;
/** 공유 폴더 이어 읽기·내 파일 미러 (폴더가 바뀌면 새로) */
let sharedTail = createTailReader();
let mirror: { dir: string; push: () => number } | null = null;
const SHARED_SYNC_MS = 60_000;

/** 전력 이벤트는 10분 단위로 묶어 기록 */
let energyBuf: { start: number; end: number; wms: number; kwh: number } | null = null;
const ENERGY_EVENT_MS = 10 * 60_000;
let priceSeries: { t: number; usd: number }[] = [];
let powerRegistered = false;
let powerLog: string | null = null;
/** GPU 별 직전 nvidia-smi 전력 제한 (앱 밖에서 바꾼 값을 알아채는 기준) */
let seenLimits: Record<GpuId, number> = {};
/** 재적용 파일을 마지막으로 쓸 때의 GPU 구성 (구성이 바뀌면 옛 bus id 를 바로 걷어낸다) */
let writtenGpuSet = '';
const remote = {
  prlUsd: null as number | null,
  /** 시세를 받은 시각 (조회 실패 시 마지막 정상 시세를 계속 쓰고 이 시각을 보여 준다) */
  priceAt: null as number | null,
  change24h: null as number | null,
  balance: null as number | null,
  payouts: [] as Payout[],
  pool: null as PoolStats | null,
  vast: {} as Record<string, VastStats>,
  updatedAt: null as number | null,
  error: null as string | null,
};

// ---------- 상태 ----------

const holdSet = () => new Set(Object.keys(runtime.holds));
const saveRuntime = () => writeJson(file('runtime.json'), runtime);
const saveSettings = () => writeJson(file('settings.json'), settings);
const nvOf = (id: GpuId) => lastNv.find((n) => n.busId === id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const coin = () => catalog.coins.find((c) => c.id === settings.coin) ?? catalog.coins[0];
const kryptexPool = () => (isKryptexPool(settings.pool) ? coin().pools.find((p) => p.stats === 'kryptex') : undefined);

export function pushAlert(a: Alert, notify = a.level !== 'info' || a.code.startsWith('review')): void {
  alerts = [a, ...alerts].slice(0, MAX_ALERTS);
  if (notify) env.notify(a);
}

export function alertOnce(a: Alert, withinMs: number): void {
  if (!alerts.some((x) => x.code === a.code && x.gpu === a.gpu && a.ts - x.ts < withinMs)) pushAlert(a);
}

// GPU id 가 곧 PCI bus id 이므로 nvidia-smi 가 실패해도 채굴기 API 장치와 매칭할 수 있다
const deviceOf = (g: GpuConfig) => (lastStats ? matchSrbDevice(lastStats.devices, parsePciBus(g.id)) : undefined);

/** GPU 별 채굴 선택은 실행 파일 방식에서만 적용된다 (채굴기 환경 변수를 이 앱이 정하므로) */
const selectionActive = () => settings.minerControl.mode === 'direct';
/** 채굴하지 않기로 고른 GPU (선택이 적용되는 방식일 때만) */
const mineOff = (g: GpuConfig | undefined) => !!g && selectionActive() && g.mine === false;
const gpuOf = (busId: string) => settings.gpus.find((g) => g.id === busId);
/** 채굴 비용에 넣는 전력: 채굴하지 않기로 고른 GPU 의 전력은 뺀다 */
const miningWatts = () => lastNv.reduce((a, n) => a + (mineOff(gpuOf(n.busId)) ? 0 : (n.powerW ?? 0)), 0);

function isMining(g: GpuConfig): boolean {
  if (!running || mineOff(g)) return false;
  const dev = deviceOf(g);
  if (dev) return (dev.hashrate ?? 0) > 0;
  // 채굴기 API 에 장치 정보가 없으면, 이번 세션에 보인 GPU 는 보수적으로 채굴 중이라고 본다
  return !lastStats?.devices.length && seenGpus.has(g.id);
}

function gpuViews(): GpuView[] {
  return settings.gpus.map((g) => {
    const nv = nvOf(g.id);
    const dev = deviceOf(g);
    return {
      id: g.id,
      label: g.label,
      index: nv?.index ?? null,
      name: nv?.name ?? dev?.model ?? g.label,
      tempC: nv?.tempC ?? dev?.tempC ?? null,
      fanPct: nv?.fanPct ?? dev?.fanPct ?? null,
      powerW: nv?.powerW ?? dev?.powerW ?? null,
      powerLimitW: nv?.powerLimitW ?? null,
      powerMinW: nv?.powerMinW ?? null,
      powerMaxW: nv?.powerMaxW ?? null,
      utilPct: nv?.utilPct ?? null,
      hashrate: running ? (dev?.hashrate ?? null) : null,
      mining: isMining(g),
      hold: runtime.holds[g.id] ?? null,
      present: !!nv,
      mine: g.mine !== false,
      selectable: selectionActive() && !!nv,
    };
  });
}

function compareRows(gpus: GpuView[]): CompareRow[] {
  const p = settings.profit;
  return settings.gpus.map((g) => {
    const v = gpus.find((x) => x.id === g.id);
    const vast = remote.vast[shortName(v?.name ?? g.label)] ?? null;
    const auto = vast?.status === 'ok' ? vast.median : null;
    const rentalUsd = g.rentalUsdManual > 0 ? g.rentalUsdManual : auto;
    return {
      id: g.id,
      label: g.label,
      miningKrwPerH:
        remote.prlUsd !== null && remote.pool && v?.hashrate && v.powerW !== null
          ? miningNetKrwPerHour(v.hashrate, v.powerW, remote.prlUsd, remote.pool, p)
          : null,
      rentalKrwPerH: rentalUsd === null ? null : rentalNetKrwPerHour(rentalUsd, p),
      rentalUsd,
      rentalSource: g.rentalUsdManual > 0 ? 'manual' : auto !== null ? 'vast' : null,
      vast,
    };
  });
}

function profitView(gpus: GpuView[]): ProfitView {
  const p = settings.profit;
  const now = Date.now();
  const usd = remote.prlUsd;
  const sum = summarize(ledger, now, usd, p);
  const supported = !!kryptexPool();
  const hash = lastStats?.totalHashrate ?? null;
  // 채굴하지 않기로 고른 GPU 의 전력은 비용에서 뺀다
  const watts = gpus.reduce((s, g) => s + (g.present && !(g.selectable && !g.mine) ? (g.powerW ?? 0) : 0), 0);
  const liveCoinPerH = hash && remote.pool ? prlPerHour(hash, remote.pool) : null;
  return {
    supported,
    symbol: coin().symbol,
    price: usd === null || remote.priceAt === null ? null : { usd, at: remote.priceAt, stale: now - remote.priceAt > PRICE_STALE_MS },
    change24hPct: remote.change24h,
    balanceCoin: remote.balance,
    // 지급 합계는 지금까지 본 모든 지급 (지급 중 포함), 풀 누적 = 지급 + 풀 잔고 (지갑과 대조하기 쉽게 나눠 보여 준다)
    paidCoin: supported && ledger.lastTotal !== null ? ledger.paidTotal : null,
    payingCoin: remote.payouts.some((x) => x.pending) ? remote.payouts.filter((x) => x.pending).reduce((s, x) => s + x.amount, 0) : 0,
    lifetimeCoin: supported ? (ledger.poolTotal ?? ledger.lastTotal) : null,
    liveCoinPerH,
    // 전체 GPU 전력비를 빼서 보수적으로 (채굴 안 하는 GPU 전력도 비용)
    liveKrwPerH: liveCoinPerH !== null && usd !== null ? liveCoinPerH * usd * p.krwPerUsd - (watts / 1000) * p.krwPerKwh : null,
    today: sum.today,
    month: sum.month,
    compare: compareRows(gpus),
    updatedAt: remote.updatedAt,
    error: remote.error,
  };
}

function hubView(): HubView {
  const c = coin();
  const detected: Vendor[] = vendors.length ? vendors : lastNv.length ? ['nvidia'] : [];
  return {
    coin: c.id,
    algorithm: c.algorithm,
    vendors: detected,
    recommendations: recommend(catalog, c.id, detected),
    poolSources: c.pools.map((p) => p.source),
    checkedAt: catalog.checkedAt,
  };
}

function flushEnergy(): void {
  if (!energyBuf || energyBuf.kwh <= 0) return;
  const span = Math.max(1, energyBuf.end - energyBuf.start);
  logEvent({ t: energyBuf.end, type: 'energy', start: energyBuf.start, end: energyBuf.end, avgW: energyBuf.wms / span, kwh: energyBuf.kwh, krwPerKwh: settings.profit.krwPerKwh, coin: settings.coin });
  energyBuf = null;
}

const priceKrw = () => (remote.prlUsd === null ? null : remote.prlUsd * settings.profit.krwPerUsd);

/**
 * 화면·소급에 쓰는 장부. 공유 장부가 켜져 있으면 모든 인스턴스 이벤트를 다시 계산한 장부에
 * 이 인스턴스의 실시간 추정분과 아직 이벤트로 기록하지 않은 전력을 더한다. 아니면 로컬 장부 그대로.
 */
function bookView(): PnlBook {
  if (!sharedBook) return pnl;
  const b: PnlBook = structuredClone(sharedBook);
  b.pending = { ...pnl.pending };
  if (energyBuf && energyBuf.kwh > 0) addEnergy(b, settings.coin, energyBuf.end, energyBuf.kwh, settings.profit.krwPerKwh);
  return b;
}

function pnlView(): PnlView {
  const stale = remote.priceAt !== null && Date.now() - remote.priceAt > PRICE_STALE_MS;
  const book = bookView();
  const s = summarizePnl(book, settings.coin, Date.now(), priceKrw(), stale);
  return {
    symbol: coin().symbol,
    ...s,
    trackStart: book.trackStart,
    bootstrapped: book.bootstrapped,
    backfill: book.backfill && { from: book.backfill.from, to: book.backfill.to, qty: book.backfill.qty, watts: book.backfill.watts, auto: book.backfill.auto },
    currentWatts: Math.round(miningWatts()),
    logDir: pnlDir(),
  };
}

/** 일별 장부 저장. 전력 이벤트는 10분 단위로만 기록하고, 종료·업데이트 때(final)만 남은 구간을 바로 기록 */
function savePnl(final = false): void {
  if (final) flushEnergy();
  writeJson(path.join(pnlDir(), 'daily.json'), pnl);
}

/** 소급 적용(다시 계산하면 이전 소급분을 바꿔 끼움). trackStart 가 있을 때만 부른다 */
function applyBackfill(from: number, watts: number, auto: boolean): void {
  const ts = bookView().trackStart!;
  const fx = settings.profit.krwPerUsd;
  const closeKrw = Object.fromEntries(Object.entries(dailyClose(priceSeries)).map(([d, usd]) => [d, usd * fx]));
  const r = bootstrap(pnl, { coin: settings.coin, from, to: ts.at, qty: ts.total, watts, krwPerKwh: settings.profit.krwPerKwh, closeKrwByDay: closeKrw, fallbackKrw: priceKrw(), auto });
  // 날짜별 금액까지 담아 두면 다른 인스턴스가 다시 계산해도 같은 값이 된다
  logEvent({ t: Date.now(), type: 'bootstrap', coin: settings.coin, from, to: ts.at, qty: ts.total, watts, kwh: r.kwh, auto, days: pnl.backfill?.days });
  if (sharedBook) syncShared();
}

/**
 * 추적 시작 전 채굴분을 자동으로 소급한다(한 번만). 시작 시각은 풀 누적치 ÷ 지금 기대 채굴 속도로 추정하고
 * 가장 이른 지급보다 늦지 않게, 전력은 지금 GPU 전력 합. 해시레이트·풀 통계·전력이 모두 있을 때까지 기다린다.
 */
function autoBackfill(): void {
  const book = bookView();
  const ts = book.trackStart;
  if (!ts || book.bootstrapped || !(ts.total > 0) || !kryptexPool()) return;
  const watts = Math.round(miningWatts());
  const rate = lastStats?.totalHashrate && remote.pool ? prlPerHour(lastStats.totalHashrate, remote.pool) : null;
  const paid = remote.payouts.map((p) => p.at).filter((t): t is number => typeof t === 'number' && Number.isFinite(t));
  const from = estimateBackfillFrom({ to: ts.at, qty: ts.total, coinPerHour: rate, earliestPayoutAt: paid.length ? Math.min(...paid) : null });
  if (from === null || !(watts > 0)) return;
  applyBackfill(from, watts, true);
}

export function chartsView(): ChartsView {
  return {
    gpus: settings.gpus.filter((g) => history.series[g.id] || history.acc[g.id]).map((g) => ({ id: g.id, label: g.label, points: seriesOf(history, g.id) })),
    price: priceSeries,
    // 공유 장부면 인스턴스별 ledger 대신 합친 장부로
    daily: sharedBook ? bookDailyPoints(bookView(), settings.coin) : dailySeries(ledger, dailyClose(priceSeries), remote.prlUsd, settings.profit),
    pnl: pnlDaily(bookView(), settings.coin, priceKrw()),
    symbol: coin().symbol,
  };
}

function setupView(): SetupView {
  return { walletSet: !!settings.wallet, poolSet: !!settings.pool, apiConnected: lastStats !== null };
}

export function buildState(): AppState {
  const gpus = gpuViews();
  return {
    ts: Date.now(),
    mock: MOCK,
    setup: setupView(),
    miner: {
      running,
      mode: running ? (startedByApp ? 'app' : 'external') : null,
      processes,
      pool: lastStats?.pool ?? null,
      latencyMs: lastStats?.latencyMs ?? null,
      uptimeS: lastStats?.uptimeS ?? null,
      accepted: lastStats?.accepted ?? null,
      rejected: lastStats?.rejected ?? null,
      totalHashrate: lastStats?.totalHashrate ?? null,
      apiOk: lastStats !== null,
      gpuSelection: lastSelection,
      control: controlView(),
    },
    gpus,
    alerts,
    profit: profitView(gpus),
    power: { registered: powerRegistered, lastLog: powerLog },
    update: env.updateView?.() ?? DISABLED_UPDATE,
    appVersion: env.version,
    platform: PLATFORM,
    settings,
    coins: catalog.coins.map((c) => ({ id: c.id, name: c.name, symbol: c.symbol, algorithm: c.algorithm })),
    poolExamples: coin().pools.flatMap((p) => p.examples),
    hub: hubView(),
    pnl: pnlView(),
    sharedLedger: sharedStatus,
    minerTask: taskStatus,
    autoSell: autoSellView(),
  };
}

// ---------- 안전 정지 (kill-only, 재시작 없음) ----------

/** 실행 중인 알려진 채굴기를 모두 정지하고 실제로 꺼졌는지 확인한다 */
async function killKnownMiners(): Promise<string | null> {
  // tasklist 가 실패하면(null) 꺼졌다고 가정하지 않고 알려진 이름 전부에 kill 을 시도
  const before = await hw.runningMiners(knownMiners).catch(() => null);
  if (before !== null && before.length === 0) {
    // 프로세스 이름은 모르는데 통계 API 는 응답 → 정지할 수 없다 (거짓 성공 방지)
    return (await minerApiAlive())
      ? '채굴기 통계 API 는 응답하지만 실행 파일 이름을 몰라 정지할 수 없습니다 — 채굴기를 직접 종료해 주세요'
      : null;
  }
  const errors: string[] = [];
  for (const exe of before ?? knownMiners) {
    const err = await hw.kill(exe);
    if (err && before !== null) errors.push(`${exe}: ${err}`);
  }
  const deadline = Date.now() + KILL_CONFIRM_MS;
  let listed = false;
  while (Date.now() < deadline) {
    await sleep(500);
    const left = await hw.runningMiners(knownMiners).catch(() => null);
    listed ||= left !== null;
    if (left !== null && left.length === 0 && !(await minerApiAlive())) return null;
  }
  if (!listed && !(await minerApiAlive())) return '채굴기 정지를 시도했지만 프로세스 목록(tasklist)을 읽지 못해 확인하지 못했습니다 — 작업 관리자에서 확인해 주세요';
  return `채굴기 정지 실패${errors.length ? `: ${errors.join(' · ')}` : ''} — 관리자 권한으로 실행된 채굴기는 앱이 끌 수 없습니다. 작업 관리자에서 직접 종료해 주세요`;
}

function minerApiAlive(): Promise<boolean> {
  if (settings.minerApi.adapter === 'none') return Promise.resolve(false);
  return hw.minerStats(settings.minerApi.adapter, settings.minerApi.port).then(() => true, () => false);
}

async function enforceHolds(newTrips: { id: GpuId; reason: string }[], now: number): Promise<void> {
  // 프로세스 목록을 모르면(tasklist 실패) 실행 중일 수 있다고 보고 정지를 시도한다
  if ((!running && !procsUnknown) || Object.keys(runtime.holds).length === 0) return;
  const reasons = newTrips.length ? newTrips : Object.entries(runtime.holds).map(([id, reason]) => ({ id, reason }));
  const labels = reasons.map((r) => `${settings.gpus.find((g) => g.id === r.id)?.label ?? r.id}(${r.reason})`).join(', ');
  if (!settings.safetyKill) {
    alertOnce({ ts: now, level: 'critical', code: 'safety_hold_running', message: `위험 조건 ${labels} — 자동 정지가 꺼져 있습니다. 채굴기를 직접 멈춰 주세요` }, 60_000);
    return;
  }
  if (killing || (newTrips.length === 0 && now - lastKillAt < KILL_RETRY_MS)) return;
  killing = true;
  lastKillAt = now;
  try {
    // 예약 작업·systemd 유닛으로 켠 경우 그쪽도 멈춘다 (Restart=always 등으로 감독자가 다시 띄우지 않게)
    const mc = settings.minerControl;
    const err = mc.mode === 'task' || mc.mode === 'systemd' ? await minerControl.stop(mc) : await killKnownMiners();
    if (err) alertOnce({ ts: now, level: 'critical', code: 'kill_failed', message: err }, 60_000);
    else if (newTrips.length) {
      const message = `위험 조건 ${labels} → 채굴기를 정지했습니다. 앱은 채굴기를 다시 시작하지 않습니다`;
      lastDangerStop = { at: now, message };
      pushAlert({ ts: now, level: 'critical', code: 'miner_killed', message });
    }
    else alertOnce({ ts: now, level: 'critical', code: 'miner_killed_again', message: `안전 보류 중(${labels})인데 채굴기가 다시 실행되어 정지했습니다. 원인 해결 후 보류를 해제해 주세요` }, 60_000);
  } finally {
    killing = false;
  }
}

export function clearHold(id: GpuId): void {
  delete runtime.holds[id];
  delete safetyState[id];
  saveRuntime();
  const label = settings.gpus.find((g) => g.id === id)?.label ?? id;
  pushAlert({ ts: Date.now(), level: 'info', code: 'hold_cleared', gpu: id, message: `${label} 안전 보류 해제 (사용자). 채굴기는 사용자가 직접 시작합니다` }, false);
}

// ---------- 채굴 켜기·끄기 (사용자가 구성한 채굴기만, 자동 재시작 없음) ----------

const STARTING_MS = 30_000;
/** 켜기 직후 위험 정지가 이 시간 안에 있었으면 원인을 다시 보여 준다 */
const DANGER_WARN_MS = 6 * 3600_000;

const minerControl = createMinerControl({
  exec: (cmd) =>
    mockHw
      ? Promise.resolve(cmd.args.includes('/End') || cmd.args.includes('stop') ? undefined : mockHw.start())
      : new Promise((resolve, reject) =>
          execFile(cmd.file, cmd.args, { timeout: 15_000, windowsHide: true }, (err, _out, stderr) => (err ? reject(new Error((stderr || err.message).trim())) : resolve())),
        ),
  spawnDetached: (cmd, cwd, hide) =>
    new Promise<void>((resolve, reject) => {
      if (mockHw) {
        // 모의 모드: "채굴 창 보기" 확인용 출력
        const out = openMinerLog();
        if (out !== null) {
          fs.writeSync(out, `\x1b[32mSRBMiner-MULTI (mock)\x1b[0m\nGPU0 RTX 5090  354.0 TH/s  63C\nGPU1 RTX 5080  226.0 TH/s  68C\naccepted 1/1\n`);
          fs.closeSync(out);
        }
        return resolve(mockHw.start());
      }
      // 셸 없이, 앱과 분리해 실행 (앱을 꺼도 채굴기는 계속). 실제로 떴는지(spawn) 실패했는지(error) 기다린다
      // 채굴기 출력은 logs/miner.log 로 (창을 띄우지 않고 앱에서 원할 때 본다)
      const out = openMinerLog();
      const child = spawn(cmd.file, cmd.args, spawnOptions(cwd, hide, out ?? 'ignore'));
      const done = () => {
        if (out !== null) fs.closeSync(out);
      };
      child.once('spawn', () => {
        done();
        child.unref();
        resolve();
      });
      child.once('error', (e) => {
        done();
        reject(e);
      });
    }),
  killMiners: () => killKnownMiners(),
});

const holdLabels = () => Object.entries(runtime.holds).map(([id, r]) => `${settings.gpus.find((g) => g.id === id)?.label ?? id}(${r})`);

function controlBlocker(): string | null {
  return startBlocker({ config: settings.minerControl, platform: MOCK ? 'windows' : PLATFORM, running, holds: holdLabels(), starting: Date.now() < startingUntil, procsUnknown });
}

function controlView(): AppState['miner']['control'] {
  const blocker = controlBlocker();
  return {
    mode: settings.minerControl.mode,
    canStart: blocker === null,
    canStop: running && !killing,
    blocker,
    starting: Date.now() < startingUntil,
    consented: runtime.minerConsentAt !== null,
  };
}

/** 감지·정지 대상: 카탈로그의 알려진 이름 + 사용자가 지정한 채굴기 실행 파일 */
function refreshKnownMiners(): void {
  const base = knownProcessNames(catalog, IS_LINUX ? 'linux' : 'windows');
  const own = controlProcessName(settings.minerControl, PLATFORM);
  if (!running) ownMiners = new Set();
  if (own) ownMiners.add(own);
  knownMiners = [...base, ...[...ownMiners].filter((o) => !base.some((b) => b.toLowerCase() === o.toLowerCase()))];
}

/**
 * 켜기: 조건 확인 → (처음이면) 위험·비용 고지 동의 → (최근 위험 정지가 있으면) 원인 확인 → 실행.
 * 확인은 confirm 으로 받는다 (데스크톱: 대화상자, 원격: 요청에 담긴 확인, 헤드리스: --accept-risk).
 */
export async function startMining(confirm: Confirm): Promise<string | null> {
  // 최신 상태로 다시 확인 (이미 돌고 있으면 두 번째 채굴기를 띄우지 않는다)
  const procs = await hw.runningMiners(knownMiners).catch(() => null);
  procsUnknown = procs === null;
  if (procs?.length || (await minerApiAlive())) running = true;
  const blocked = controlBlocker();
  if (blocked) return blocked;
  if (runtime.minerConsentAt === null) {
    if (!(await confirm('consent', CONSENT_TEXT))) return '취소됨';
    acceptRisk();
  }
  const danger = recentDangerStop();
  if (danger && !(await confirm('danger', danger))) return '취소됨';
  if (controlBlocker()) return controlBlocker();
  if (settings.minerControl.mode === 'direct' && !mockHw && !fs.existsSync(settings.minerControl.exe)) return `실행 파일이 없습니다: ${settings.minerControl.exe}`;
  startingUntil = Date.now() + STARTING_MS;
  // GPU 별 채굴: 고른 GPU 로만 (실행 파일 방식)
  const sel = await prepareGpuSelection(settings.minerControl);
  if ('error' in sel) {
    startingUntil = 0;
    return sel.error;
  }
  const err = await minerControl.start(sel.mc, sel.env);
  if (err) {
    startingUntil = 0;
    return err;
  }
  startedByApp = true;
  pushAlert({ ts: Date.now(), level: 'info', code: 'miner_started', message: '채굴 켜기 (사용자)' }, false);
  env.onChange();
  return null;
}

/**
 * GPU 별 채굴 켜기·끄기. 채굴 중이면(실행 파일 방식) 새 선택으로 다시 시작하고, 하나도 안 남으면 끈다.
 * 끄기 확인은 묻지 않는다(사용자가 방금 고름). 켜기의 동의·위험 정지 확인은 그대로 받는다.
 */
export async function setGpuMining(id: string, mine: boolean, confirm: Confirm): Promise<string | null> {
  const g = settings.gpus.find((x) => x.id === id);
  if (!g) return '알 수 없는 GPU 입니다';
  if (g.mine === mine) return null;
  g.mine = mine;
  saveSettings();
  env.log.info(`gpu ${g.label} mining ${mine ? 'on' : 'off'}`);
  if (!selectionActive() || !running) {
    env.onChange();
    return null;
  }
  const accept: Confirm = (k, d) => (k === 'stop' ? Promise.resolve(true) : confirm(k, d));
  const stopErr = await stopMining(accept);
  if (stopErr) return `다시 시작하려고 끄지 못했습니다: ${stopErr}`;
  if (!settings.gpus.some((x) => x.mine !== false && nvOf(x.id))) {
    env.onChange();
    return null;
  }
  running = false;
  return startMining(accept);
}

// ---------- GPU 별 채굴 선택 적용 ----------

let lastSelection: AppState['miner']['gpuSelection'] = null;
let srbCache: SrbDeviceCache | null = null;
const srbCacheFile = () => file('srb-devices.json');
const isSrbMiner = (mc = settings.minerControl) => settings.minerApi.adapter === 'srbminer' || /srbminer/i.test(path.basename(mc.exe));
const nvCards = () => lastNv.map((n) => ({ busId: n.busId, uuid: n.uuid, driver: n.driver }));

/** 채굴기 통계 API 의 장치 번호·bus 로 매핑을 배우거나 고친다 (돌고 있을 때 가장 확실한 출처) */
function learnSrbMap(): void {
  if (!lastStats?.devices.length || !isSrbMiner() || !lastNv.length) return;
  const add = mapFromApi(lastStats.devices).filter((e) => lastNv.some((n) => n.bus === e.bus));
  // 모든 NVIDIA 카드로 돌 때만 배운다 (--gpu-id 로 일부만 켰을 때 번호를 다시 매기는 버전이 있을 수 있어서)
  if (!lastNv.every((n) => add.some((e) => e.bus === n.bus))) return;
  const key = srbCacheKey(settings.minerControl.exe, nvCards());
  const base = srbCache?.key === key ? srbCache.map : [];
  const map = mergeMap(base, add);
  if (srbCache?.key === key && JSON.stringify(map) === JSON.stringify(srbCache.map)) return;
  srbCache = { key, map, source: 'api', at: Date.now() };
  writeJson(srbCacheFile(), srbCache);
}

/** `--list-devices` 로 매핑 (캐시가 없거나 카드·드라이버·채굴기가 바뀌었을 때). 원문은 logs/srb-list-devices.txt 에 남긴다 */
async function listSrbDevices(exe: string): Promise<{ map: SrbDeviceCache['map'] } | { error: string }> {
  if (mockHw) return { map: lastNv.map((n) => ({ srbId: n.index + 1, bus: n.bus ?? -1 })) };
  const text = await new Promise<string>((resolve, reject) =>
    execFile(exe, ['--list-devices'], { cwd: path.dirname(exe), timeout: 60_000, windowsHide: true, maxBuffer: 1024 * 1024 }, (err, out, errOut) =>
      err && !out ? reject(err) : resolve(`${out}\n${errOut}`),
    ),
  ).catch((e: Error) => e);
  if (text instanceof Error) return { error: `--list-devices 실행 실패: ${text.message}` };
  try {
    fs.mkdirSync(file('logs'), { recursive: true });
    fs.writeFileSync(file(path.join('logs', 'srb-list-devices.txt')), text.slice(0, 64_000));
  } catch {
    // 진단용 사본은 실패해도 된다
  }
  const map = mapFromListed(parseListDevices(text), lastNv.flatMap((n) => (n.bus === null ? [] : [n.bus])));
  return map.length ? { map } : { error: '--list-devices 출력에서 카드의 장치 번호를 찾지 못했습니다 (logs/srb-list-devices.txt)' };
}

/**
 * 켤 때 GPU 선택을 채굴기에 적용한다.
 *  - SRBMiner: 고른 카드의 SRBMiner 장치 번호로 --gpu-id (사용자 인자의 --gpu-id 는 뺌). 번호는 통계 API·--list-devices 로 매핑
 *  - 그 밖의 채굴기: CUDA_VISIBLE_DEVICES (보조)
 * 매핑하지 못하면 막지 않고 모든 카드로 채굴하며 이유를 알린다. 하나도 고르지 않았으면 켜지 않는다.
 */
async function prepareGpuSelection(mc: Settings['minerControl']): Promise<{ mc: Settings['minerControl']; env?: Record<string, string> } | { error: string }> {
  lastSelection = null;
  if (!selectionActive()) return { mc };
  const present = settings.gpus.flatMap((g) => {
    const nv = nvOf(g.id);
    return nv ? [{ g, nv, mine: g.mine !== false }] : [];
  });
  const sel = present.length ? gpuSelectionEnv(present.map((p) => ({ index: p.nv.index, uuid: p.nv.uuid, mine: p.mine }))) : null;
  if (sel === 'none') return { error: '채굴할 GPU 를 하나 이상 켜 주세요' };
  if (!sel) return { mc };
  const chosen = present.filter((p) => p.mine);
  const label = chosen.map((p) => p.g.label).join(', ');
  const fallback = (reason: string) => {
    lastSelection = { applied: false, via: null, reason };
    pushAlert({ ts: Date.now(), level: 'warn', code: 'gpu_selection_failed', message: `카드 선택을 적용할 수 없음 — 모든 카드로 채굴 중 (${reason})` });
    env.log.warn(`gpu selection not applied: ${reason}`);
    return { mc };
  };
  if (!isSrbMiner(mc)) {
    lastSelection = { applied: true, via: 'CUDA_VISIBLE_DEVICES', reason: null };
    return { mc, env: sel };
  }
  const key = srbCacheKey(mc.exe, nvCards());
  let map = srbCache?.key === key ? srbCache.map : [];
  const buses = chosen.map((p) => p.nv.bus).filter((b): b is number => b !== null);
  if (buses.length !== chosen.length) return fallback('카드의 PCI bus 를 읽지 못했습니다');
  let r = resolveGpuIds(buses, map);
  if ('error' in r) {
    const listed = await listSrbDevices(mc.exe);
    if ('error' in listed) return fallback(listed.error);
    map = mergeMap(map, listed.map);
    srbCache = { key, map, source: 'list-devices', at: Date.now() };
    writeJson(srbCacheFile(), srbCache);
    r = resolveGpuIds(buses, map);
    if ('error' in r) return fallback(r.error);
  }
  const stripped = stripGpuArgs(mc.args);
  const args = `${stripped.args} --gpu-id ${r.ids.join(',')}`.trim();
  lastSelection = { applied: true, via: `SRBMiner --gpu-id ${r.ids.join(',')} (${label})`, reason: null };
  if (stripped.removed.length) {
    pushAlert({ ts: Date.now(), level: 'info', code: 'gpu_args_removed', message: `GPU 별 채굴 선택을 쓰는 동안 인자 ${stripped.removed.join(', ')} 대신 --gpu-id ${r.ids.join(',')} 로 실행합니다` }, false);
  }
  return { mc: { ...mc, args } };
}

// ---------- SafeTrade 자동 매도 (하루 1회, 한 기기에서만) ----------

interface AutoSellState {
  history: SellResult[];
  /** 실제 매도를 마지막으로 실행한 날 / 모의 실행한 날 */
  lastRealDay: string | null;
  lastDryDay: string | null;
  /** 걸어 둔 주문 (앱이 중간에 꺼지면 다음 시작 때 취소·기록) */
  open: { id: number; price: number; amount: number; day: string } | null;
  /** 실행 중 지금까지 끝난 주문 (앱이 꺼지면 다음 시작 때 이걸로 기록을 마무리) */
  progress: SellResult | null;
  balance: { prl: number; usdt: number; at: number } | null;
  /** 주 1회 출금 권장 알림을 보낸 주 (YYYY-MM-DD, 그 주 일요일) */
  withdrawHintDay: string | null;
}

const autoSellFile = () => file('autosell-state.json');
let autoSell: AutoSellState = { history: [], lastRealDay: null, lastDryDay: null, open: null, progress: null, balance: null, withdrawHintDay: null };
let autoSellBusy = false;
/** 실행 중에 자동 매도를 끄면 다음 주문 전에 멈춘다 */
let autoSellStop = false;
const saveAutoSell = () => writeJson(autoSellFile(), autoSell);

/** 오늘 실행 시각 (지났으면 내일) */
function nextAutoSellAt(now = Date.now()): number | null {
  const c = settings.autoSell;
  return c.enabled ? nextRunAt(c.time, (c.dryRun ? autoSell.lastDryDay : autoSell.lastRealDay) === dateKey(now), now) : null;
}

const todaySoldPrl = () =>
  autoSell.history.filter((r) => !r.dryRun && r.day === dateKey(Date.now())).reduce((a, r) => a + r.soldPrl, 0);

function autoSellView(): AppState['autoSell'] {
  return {
    keySet: !!env.exchangeKey?.(),
    keyStore: env.exchangeKeyStore?.() ?? null,
    running: autoSellBusy,
    nextRunAt: nextAutoSellAt(),
    todaySoldPrl: todaySoldPrl(),
    last: autoSell.history[0] ?? null,
    history: autoSell.history.slice(0, 10),
    balance: autoSell.balance,
  };
}

function sellClient(key: ExchangeKey) {
  return createSafeTrade(key, env.exchangeFetch ?? fetch);
}

/** 매도 결과를 PnL 장부에 "실현 매도" 로 (USDT → 원은 설정 환율). 공유 장부면 이벤트로 다른 OS 에도 */
function recordSale(r: SellResult): void {
  if (r.dryRun || !(r.soldPrl > 0)) return;
  const fx = settings.profit.krwPerUsd;
  const avg = r.proceedsUsdt / r.soldPrl;
  const now = Date.now();
  addSale(pnl, settings.coin, now, r.soldPrl, r.proceedsUsdt * fx, r.feeUsdt * fx);
  logEvent({
    t: now, type: 'sale', coin: settings.coin, qty: r.soldPrl, proceedsKrw: r.proceedsUsdt * fx, feeKrw: r.feeUsdt * fx, venue: 'SafeTrade (자동)',
    note: `${r.soldPrl.toFixed(4)} PRL @ ${avg.toFixed(4)} = ${r.proceedsUsdt.toFixed(2)} USDT, 수수료 ${r.feeUsdt.toFixed(4)} USDT, 주문 ${r.orders.map((o) => o.id).join(',')}`,
  });
  savePnl();
  if (sharedBook) syncShared();
}

function noteResult(r: SellResult): void {
  autoSell.history = [r, ...autoSell.history].slice(0, 30);
  if (!r.dryRun) autoSell.progress = null;
  // 지난 실행을 나중에 마무리한 기록이 오늘 날짜를 되돌리지 않게
  if (r.dryRun) autoSell.lastDryDay = r.day > (autoSell.lastDryDay ?? '') ? r.day : autoSell.lastDryDay;
  else autoSell.lastRealDay = r.day > (autoSell.lastRealDay ?? '') ? r.day : autoSell.lastRealDay;
  saveAutoSell();
  recordSale(r);
  const level: Alert['level'] = r.status === 'error' || r.status === 'skipped' ? 'warn' : 'info';
  const head = r.dryRun ? '자동 매도(모의)' : '자동 매도';
  const msg =
    r.status === 'planned' ? `${head}: ${r.reason}`
    : r.status === 'sold' || r.status === 'partial' ? `${head}: ${r.soldPrl.toFixed(4)} PRL → ${r.proceedsUsdt.toFixed(2)} USDT (평균 ${(r.proceedsUsdt / r.soldPrl).toFixed(4)})${r.reason ? ` · ${r.reason}` : ''}`
    : `${head} 안 함: ${r.reason ?? r.status}`;
  pushAlert({ ts: Date.now(), level, code: `autosell_${r.status}`, message: msg }, level !== 'info');
  // 팔 PRL 이 없으면: 풀 지급분을 SafeTrade 로 보내라는 안내
  if (r.status === 'nothing' && /팔 수 있는 PRL/.test(r.reason ?? '')) {
    alertOnce({ ts: Date.now(), level: 'info', code: 'autosell_send_prl', message: `SafeTrade 에 팔 PRL 이 없습니다 — 지갑의 PRL 을 SafeTrade 로 보내세요 (입금 최소 ${settings.cashout.prlDepositMin} PRL, ${settings.cashout.prlConfirmations} 컨펌)` }, 20 * 3600_000);
  }
}

/** 실행 전 잔고·주 1회 출금 권장 */
async function refreshExchangeBalance(key: ExchangeKey): Promise<void> {
  const b = await sellClient(key).balances().catch(() => null);
  if (!b) return;
  // 2026-10-18 부터 PRL 의 통화 id 는 pearl (그 전 prl)
  autoSell.balance = { prl: (b.pearl ?? b.prl)?.available ?? 0, usdt: b.usdt?.available ?? 0, at: Date.now() };
  const now = new Date();
  const c = settings.cashout;
  if (now.getDay() === 0 && autoSell.balance.usdt >= c.withdrawSuggestUsdt && autoSell.withdrawHintDay !== dateKey(now.getTime())) {
    autoSell.withdrawHintDay = dateKey(now.getTime());
    pushAlert({ ts: Date.now(), level: 'info', code: 'cashout_withdraw', message: `SafeTrade USDT ${autoSell.balance.usdt.toFixed(2)} — 이번 주 바이낸스로 출금 권장 (${c.withdrawNetwork}, 수수료 ${c.withdrawFeeUsdt} USDT, 최소 ${c.withdrawMinUsdt})` }, false);
  }
  saveAutoSell();
}

/**
 * 앱이 매도 중에 꺼졌을 때: 남은 주문은 취소하고, 그때까지 끝난 주문과 그 주문의 체결분을 장부에 기록한다.
 * (오늘 실행한 것으로 이미 저장돼 있어 같은 날 다시 팔지는 않는다)
 */
async function recoverInterrupted(key: ExchangeKey): Promise<void> {
  const o = autoSell.open;
  const p = autoSell.progress;
  if (!o && !p) return;
  const orders = [...(p?.orders ?? [])];
  if (o) {
    const c = sellClient(key);
    try {
      await c.cancel(o.id).catch(() => undefined);
      const st = await c.order(o.id);
      if (st.filledAmount > 0) orders.push({ id: o.id, price: o.price, amount: o.amount, filled: st.filledAmount, avgPrice: st.avgPrice });
    } catch (e) {
      // 거래소에 닿지 않으면 다음 시작 때 다시
      env.log.warn(`autosell: cannot recover open order ${o.id}: ${(e as Error).message}`);
      return;
    }
  }
  autoSell.open = null;
  autoSell.progress = null;
  saveAutoSell();
  const sold = orders.reduce((s, x) => s + x.filled, 0);
  if (sold > 0) {
    noteResult({
      day: p?.day ?? o!.day, at: Date.now(), dryRun: false, status: 'partial', reason: '앱이 매도 중에 꺼져 남은 주문을 취소했습니다 (수수료는 0.1% 로 추정)',
      floorUsd: p?.floorUsd ?? null, refUsd: p?.refUsd ?? null, plan: p?.plan ?? (o ? { price: o.price, amount: o.amount } : null),
      orders, soldPrl: sold, proceedsUsdt: orders.reduce((s, x) => s + x.filled * x.avgPrice, 0), feeUsdt: orders.reduce((s, x) => s + x.filled * x.avgPrice, 0) * DEFAULT_FEE_RATE,
    });
  }
}

/**
 * 자동 매도 1회. manual 이면 시각과 무관하게 (실제 매도는 confirm 으로 확인). 같은 날 실제 매도는 한 번만,
 * 공유 장부를 쓰면 다른 기기가 이미 실행했는지 공유 폴더의 그날 기록으로 확인한다.
 */
export async function runAutoSellOnce(o: { dryRun: boolean; manual: boolean; confirm?: Confirm }): Promise<string | null> {
  const cfg = { ...settings.autoSell, dryRun: o.dryRun };
  const err = validateAutoSell(cfg);
  if (err) return err;
  if (autoSellBusy) return '자동 매도가 이미 진행 중입니다';
  const key = env.exchangeKey?.() ?? null;
  if (!key) return 'SafeTrade API 키가 없습니다 (이 PC 의 자동 매도 카드에서 입력)';
  const day = dateKey(Date.now());
  if (!o.dryRun) {
    if (!(cfg.floorUsd > 0)) return '실제 매도에는 최저가($)를 0보다 크게 정해야 합니다';
    if (autoSell.lastRealDay === day) return '오늘은 이미 자동 매도를 실행했습니다';
    if (o.manual && o.confirm && !(await o.confirm('sell', `SafeTrade 에서 지금 실제로 매도합니다 (지정가, 하한가 아래로는 팔지 않음, 하루 최대 ${cfg.dailyMaxPrl} PRL, 1회 최대 ${cfg.orderMaxUsd} USDT).`))) return '취소됨';
    // 확인을 기다리는 동안 예약 실행이 먼저 돌았을 수 있다
    if (autoSellBusy) return '자동 매도가 이미 진행 중입니다';
    if (autoSell.lastRealDay === day) return '오늘은 이미 자동 매도를 실행했습니다';
    const dir = sharedDir();
    if (dir) {
      if (!sharedStatus?.ok) return '공유 장부 폴더가 보이지 않아 다른 기기의 실행 여부를 확인할 수 없습니다 — 오늘은 팔지 않습니다';
      // 기기마다 시간대가 다를 수 있어(듀얼부팅 KST/UTC) 공유 폴더의 날짜는 UTC 로
      let claim: ReturnType<typeof claimAutoSellDay>;
      try {
        claim = claimAutoSellDay(sharedRoot(dir), new Date().toISOString().slice(0, 10), instanceId);
      } catch (e) {
        return `공유 장부 폴더에 오늘 실행 기록을 남길 수 없습니다 (${(e as Error).message}) — 오늘은 팔지 않습니다`;
      }
      if (!claim.ok) {
        autoSell.lastRealDay = day;
        saveAutoSell();
        return claim.by === instanceId ? '오늘은 이미 자동 매도를 실행했습니다' : `오늘은 다른 기기(${claim.by})가 이미 자동 매도를 실행했습니다`;
      }
    }
  }
  autoSellBusy = true;
  autoSellStop = false;
  if (!o.dryRun) {
    // 첫 주문 전에 오늘 실행한 것으로 저장 (중간에 꺼져도 같은 날 다시 팔지 않게)
    autoSell.lastRealDay = day;
    saveAutoSell();
  }
  env.onChange();
  try {
    await recoverInterrupted(key);
    await refreshExchangeBalance(key);
    const r = await runAutoSell(cfg, {
      client: sellClient(key),
      // 자동 매도를 끄면 기다리던 중에도 바로 깨어나 주문을 정리한다
      sleep: async (ms) => {
        const end = Date.now() + ms;
        while (Date.now() < end && !autoSellStop) await new Promise((res) => setTimeout(res, Math.min(5000, end - Date.now())));
      },
      shouldStop: () => autoSellStop,
      onProgress: (p) => {
        if (o.dryRun) return;
        autoSell.progress = p;
        saveAutoSell();
      },
      now: Date.now,
      refPriceUsd: () => (remote.prlUsd !== null && remote.priceAt !== null && Date.now() - remote.priceAt < 3 * 3600_000 ? remote.prlUsd : null),
      soldTodayPrl: todaySoldPrl(),
      day,
      onOpen: (ord: Order | null) => {
        autoSell.open = ord ? { id: ord.id, price: ord.price, amount: ord.originAmount, day } : null;
        saveAutoSell();
      },
    });
    noteResult(r);
    await refreshExchangeBalance(key);
    return r.status === 'error' ? r.reason : null;
  } finally {
    autoSellBusy = false;
    env.onChange();
  }
}

/** 1분마다: 켜져 있고 실행 시각이 지났고 오늘 아직이면 실행 */
async function maybeAutoSell(): Promise<void> {
  const c = settings.autoSell;
  if (!c.enabled || autoSellBusy) return;
  const next = nextAutoSellAt();
  if (next === null || Date.now() < next) return;
  const err = await runAutoSellOnce({ dryRun: c.dryRun, manual: false }).catch((e: Error) => `자동 매도 오류: ${e.message}`);
  if (err) {
    // 같은 이유로 매분 다시 시도하지 않게 오늘은 실행한 것으로 둔다
    if (c.dryRun) autoSell.lastDryDay = dateKey(Date.now());
    else autoSell.lastRealDay = dateKey(Date.now());
    saveAutoSell();
    alertOnce({ ts: Date.now(), level: 'warn', code: 'autosell_skipped', message: `자동 매도 안 함: ${err}` }, 20 * 3600_000);
  }
}

/** 위험·비용 고지에 동의했는지 */
export const isConsented = () => runtime.minerConsentAt !== null;

/** 시작 직후 채굴 자동 시작까지 기다리는 시간 (로그온 시 예약 작업 등 다른 경로가 먼저 띄운 채굴기를 감지하려고) */
export const AUTO_START_DELAY_MS = 30_000;

/**
 * Crypthy 시작 시 채굴 자동 시작 (설정을 켰을 때 한 번만). 버튼과 같은 조건을 쓰되 확인이 필요하면 묻지 않고 건너뛴다.
 * 위험 정지 뒤 자동으로 다시 켜지 않는다는 원칙은 그대로: 보류·최근 위험 정지가 있으면 하지 않는다.
 */
export async function autoStartMining(): Promise<void> {
  const d = autoStartDecision({ enabled: settings.autoStartMining, consented: isConsented(), recentDanger: recentDangerStop() !== null, blocker: controlBlocker() });
  let reason = d.reason;
  if (d.start) {
    // 확인이 필요한 경우(동의·위험 정지)는 위에서 걸렀다. 그 사이 상태가 바뀌어 확인이 필요해지면 켜지 않는다
    const err = await startMining(async () => false);
    if (!err) {
      env.log.info('auto start: mining started');
      pushAlert({ ts: Date.now(), level: 'info', code: 'auto_start', message: 'Crypthy 시작 시 채굴 자동 시작' }, false);
      return;
    }
    reason = err === '취소됨' ? '확인이 필요한 상태입니다' : err;
  }
  if (!reason) return;
  env.log.info(`auto start skipped: ${reason}`);
  pushAlert({ ts: Date.now(), level: 'info', code: 'auto_start_skipped', message: `채굴 자동 시작 안 함: ${reason}` }, false);
  env.onChange();
}

/** 위험·비용 고지 동의를 기록한다 (대화상자·헤드리스 --accept-risk) */
export function acceptRisk(): void {
  if (runtime.minerConsentAt !== null) return;
  runtime.minerConsentAt = Date.now();
  saveRuntime();
}

/** 최근 위험 정지 안내 문장 (없으면 null) */
export function recentDangerStop(): string | null {
  if (!lastDangerStop || Date.now() - lastDangerStop.at >= DANGER_WARN_MS) return null;
  return `${new Date(lastDangerStop.at).toLocaleString('ko-KR')} — ${lastDangerStop.message}\n\n원인(팬·온도·전력)을 해결했는지 확인한 뒤 켜 주세요.`;
}

/** 끄기: (설정 시) 확인 1회 → 정지 명령 → 프로세스 정지 확인. 관리자 권한 채굴기는 끌 수 없으면 안내 */
export async function stopMining(confirm: Confirm): Promise<string | null> {
  if (!running) return '실행 중인 채굴기가 없습니다';
  if (settings.minerControl.confirmStop && !(await confirm('stop', '채굴을 끌까요?'))) return '취소됨';
  if (killing) return '정지하는 중입니다';
  killing = true;
  try {
    const err = await minerControl.stop(settings.minerControl);
    startingUntil = 0;
    if (!err) {
      startedByApp = false;
      pushAlert({ ts: Date.now(), level: 'info', code: 'miner_stopped', message: '채굴 끄기 (사용자)' }, false);
    }
    return err;
  } finally {
    killing = false;
    env.onChange();
  }
}

// ---------- 채굴기 출력 (logs/miner.log) ----------

const MINER_LOG_MAX = 2 * 1024 * 1024;
const minerLogFile = () => file(path.join('logs', 'miner.log'));

/** 직접 실행하는 채굴기의 출력 파일을 연다 (2MB 를 넘으면 miner.old.log 로 한 번 회전). 실패하면 null */
function openMinerLog(): number | null {
  try {
    const f = minerLogFile();
    fs.mkdirSync(path.dirname(f), { recursive: true });
    if (fs.existsSync(f) && fs.statSync(f).size > MINER_LOG_MAX) fs.renameSync(f, f.replace(/\.log$/, '.old.log'));
    const fd = fs.openSync(f, 'a');
    fs.writeSync(fd, `\n--- ${new Date().toISOString()} Crypthy started the miner ---\n`);
    return fd;
  } catch (e) {
    env.log.warn(`miner log: ${(e as Error).message}`);
    return null;
  }
}

/** "채굴 창 보기": 채굴기 출력의 끝부분 (색 코드 제거). 직접 실행 방식만 */
export function minerLogTail(maxLines = 200): { text: string; path: string; at: number | null; available: boolean } {
  const f = minerLogFile();
  const available = settings.minerControl.mode === 'direct';
  try {
    const st = fs.statSync(f);
    const len = Math.min(st.size, 64 * 1024);
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(f, 'r');
    try {
      fs.readSync(fd, buf, 0, len, st.size - len);
    } finally {
      fs.closeSync(fd);
    }
    const lines = buf.toString('utf8').replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').replace(/\r(?!\n)/g, '\n').split(/\r?\n/);
    return { text: lines.slice(len < st.size ? 1 : 0).slice(-maxLines).join('\n'), path: f, at: st.mtimeMs, available };
  } catch {
    return { text: '', path: f, at: null, available };
  }
}

// ---------- 예약 작업 (Windows) ----------

/** 설정한 예약 작업의 상태 (실행 파일 방식으로 바꾼 뒤 그 작업이 아직 켜져 있으면 채굴기가 두 개 뜰 수 있어 안내) */
let taskStatus: { name: string; status: string | null; at: number } | null = null;

function schtasks(args: string[]): Promise<string> {
  return new Promise((resolve, reject) =>
    execFile('schtasks.exe', args, { timeout: 10_000, windowsHide: true, encoding: 'buffer' }, (err, out, stderr) =>
      err ? reject(new Error(decodeConsole(stderr).trim() || err.message)) : resolve(decodeConsole(out)),
    ),
  );
}

export async function refreshTaskStatus(): Promise<void> {
  const name = settings.minerControl.taskName;
  if (PLATFORM !== 'windows' || MOCK || !name || validateControl({ ...settings.minerControl, mode: 'task' }, 'windows')) {
    taskStatus = null;
    return;
  }
  const out = await schtasks(['/Query', '/TN', name, '/FO', 'CSV', '/NH']).catch(() => null);
  taskStatus = { name, status: out === null ? null : parseTaskStatus(out), at: Date.now() };
}

/** 예약 작업 끄기 (사용자가 확인한 뒤). 다시 켜려면 schtasks /Change /TN <작업> /ENABLE */
export async function disableMinerTask(): Promise<string | null> {
  const name = settings.minerControl.taskName;
  if (PLATFORM !== 'windows' || MOCK) return 'Windows 에서만 쓸 수 있습니다';
  if (validateControl({ ...settings.minerControl, mode: 'task' }, 'windows')) return '예약 작업 이름이 없습니다';
  try {
    await schtasks(['/Change', '/TN', name, '/DISABLE']);
  } catch (e) {
    return `작업을 끄지 못했습니다 (${(e as Error).message}). 관리자 권한으로 만든 작업이면 관리자 명령 프롬프트에서: schtasks /Change /TN ${name} /DISABLE`;
  }
  await refreshTaskStatus();
  env.onChange();
  return null;
}

/** Windows 예약 작업의 실행 파일·인자를 읽어 설정에 채운다 (작업 이름은 설정에서) */
export async function importMinerTask(): Promise<string | null> {
  if (PLATFORM !== 'windows' || MOCK) return 'Windows 에서만 가져올 수 있습니다';
  const c = settings.minerControl;
  if (validateControl({ ...c, mode: 'task' }, 'windows')) return '예약 작업 이름을 먼저 입력·저장해 주세요';
  const xml = await new Promise<string>((resolve, reject) =>
    execFile('schtasks.exe', ['/Query', '/TN', c.taskName, '/XML'], { timeout: 10_000, windowsHide: true, encoding: 'buffer' }, (err, out, stderr) =>
      err ? reject(new Error(decodeConsole(stderr).trim() || err.message)) : resolve(decodeConsole(out)),
    ),
  ).catch((e: Error) => e);
  if (xml instanceof Error) return `예약 작업을 읽지 못했습니다: ${xml.message}`;
  const raw = parseTaskXml(xml);
  if (!raw) return '예약 작업에서 실행 파일 동작을 찾지 못했습니다';
  // conhost.exe --headless "<채굴기>" … 로 감싼 작업이면 실제 채굴기를 꺼낸다
  const parsed = unwrapConhost(raw.exe, raw.args);
  if (!isUsableProcessName(path.win32.basename(parsed.exe))) {
    return `예약 작업이 ${path.win32.basename(parsed.exe)} 로 실행됩니다. 채굴기 이름을 알 수 없어 가져오지 않았습니다 — 실행 파일 칸에 채굴기 exe 경로를 직접 입력하세요 (작업 켜기·끄기는 그대로 쓸 수 있습니다)`;
  }
  // 작업 스케줄러가 띄우면 콘솔 창을 숨길 수 없으므로 실행 파일 방식으로 바꾼다 (작업 이름은 남겨 두어 끄기 안내에 쓴다)
  const err = applyPatch({ minerControl: { ...c, mode: 'direct', exe: parsed.exe, args: parsed.args, hideWindow: true } });
  if (!err) await refreshTaskStatus();
  return err;
}

// ---------- 폴링 ----------

async function settle<T>(p: Promise<T>): Promise<T | null> {
  try {
    return await p;
  } catch {
    return null;
  }
}

function discoverGpus(): void {
  let added = false;
  for (const n of lastNv) {
    if (!settings.gpus.some((g) => g.id === n.busId)) {
      settings.gpus.push(newGpu(n.busId, shortName(n.name)));
      added = true;
    }
  }
  if (added) saveSettings();
}

/**
 * 로그온·부팅 재적용 파일: 이번 실행에서 한 번이라도 보인 GPU 만 (슬롯을 옮겨 사라진 bus id 제외).
 * 한 번 빠졌다 돌아오는 GPU 를 지우지 않도록 직전 목록이 아니라 seenGpus 기준. 아직 아무 GPU 도 못 읽었으면 거르지 않는다
 */
function writePowerLimits(): void {
  writeJson(file('power-limits.json'), buildLimitsJson(settings.gpus.filter((g) => !mineOff(g)), seenGpus.size ? seenGpus : undefined));
}

/** 전력 제한 목표값이 NVIDIA 실제값을 따르게 하고, 값이나 GPU 구성이 바뀌면 재적용 파일도 맞춘다 */
function followLiveLimits(): void {
  if (!lastNv.length) return;
  const r = followNvidiaLimits(settings.gpus, lastNv, seenLimits);
  seenLimits = r.seen;
  if (r.changed) {
    settings = { ...settings, gpus: r.gpus };
    saveSettings();
    env.onSettings?.(settings);
  }
  const gpuSet = [...seenGpus].sort().join(',');
  if (r.changed || gpuSet !== writtenGpuSet) {
    writePowerLimits();
    writtenGpuSet = gpuSet;
  }
}

export async function poll(): Promise<void> {
  const now = Date.now();
  const useApi = settings.minerApi.adapter !== 'none';
  const [nv, stats, procs] = await Promise.all([
    settle(hw.queryGpus()),
    useApi ? settle(hw.minerStats(settings.minerApi.adapter, settings.minerApi.port)) : Promise.resolve(null),
    settle(hw.runningMiners(knownMiners)),
  ]);
  lastNv = nv ?? [];
  lastNv.forEach((n) => seenGpus.add(n.busId));
  lastStats = stats;
  learnSrbMap();
  procsUnknown = procs === null;
  // tasklist 가 한 번 실패하면 직전 목록을 유지한다 (실행 중이던 채굴기를 놓치지 않게)
  processes = procs ?? processes;
  running = processes.length > 0 || stats !== null;
  if (running) startingUntil = 0;
  else if (Date.now() > startingUntil) {
    startedByApp = false;
    if (ownMiners.size > 1) refreshKnownMiners();
  }
  discoverGpus();
  followLiveLimits();

  for (const g of gpuViews()) {
    if (g.present) history = addSample(history, g.id, { hash: g.hashrate, temp: g.tempC, power: g.powerW }, now);
  }

  if (lastPollAt) {
    const watts = miningWatts();
    const dt = Math.min(now - lastPollAt, 10_000);
    // 같은 시간의 해시레이트 기반 추정 채굴량 (풀 통계·채굴기 API 가 있을 때만)
    const est = lastStats?.totalHashrate && remote.pool ? (prlPerHour(lastStats.totalHashrate, remote.pool) * dt) / 3_600_000 : 0;
    ledger = recordEnergy(ledger, watts, dt, now, est);
    // 풀에 아직 반영되지 않은 몫 (다음 풀 증가 때 확정분으로 바뀜)
    addPending(pnl, settings.coin, now, est);
    const kwh = (watts * dt) / 3_600_000 / 1000;
    addEnergy(pnl, settings.coin, now, kwh, settings.profit.krwPerKwh);
    if (kwh > 0) {
      energyBuf ??= { start: now - dt, end: now, wms: 0, kwh: 0 };
      energyBuf.end = now;
      energyBuf.wms += watts * dt;
      energyBuf.kwh += kwh;
      if (energyBuf.end - energyBuf.start >= ENERGY_EVENT_MS) {
        flushEnergy();
        if (sharedBook) syncShared();
      }
    }
  }
  lastPollAt = now;

  // 안전 감시: nvidia-smi 우선, 없으면 채굴기 API 값
  const result = evaluateSafety(
    gpuViews().map((g) => ({ id: g.id, label: g.label, powerW: g.powerW, fanPct: g.fanPct, tempC: g.tempC, mining: g.mining })),
    safetyState, settings.safety, holdSet(), now,
  );
  safetyState = result.state;
  // 채굴하지 않기로 고른 GPU 에서 해시레이트가 나오면 채굴기가 GPU 선택(CUDA_VISIBLE_DEVICES)을 따르지 않는 것
  for (const g of settings.gpus) {
    const h = mineOff(g) && running ? (deviceOf(g)?.hashrate ?? 0) : 0;
    if (h > 0) {
      alertOnce({ ts: now, level: 'warn', code: 'gpu_selection_ignored', gpu: g.id, message: `${g.label}: 채굴하지 않기로 골랐는데 채굴 중입니다 — 카드 선택이 채굴기에 적용되지 않았습니다${lastSelection?.via ? ` (${lastSelection.via})` : ''}. 채굴을 껐다 켜 보고, 계속되면 채굴기 인자로 GPU 를 지정하세요` }, 6 * 3600_000);
    }
  }
  // 채굴하지 않기로 고른 GPU 의 위험 경보는 2초마다 반복되지 않게 아래의 경고 하나(10분 간격)로 대신한다
  result.alerts.filter((a) => !(a.level === 'critical' && a.gpu && mineOff(gpuOf(a.gpu)))).forEach((a) => pushAlert(a));
  // 채굴하지 않기로 고른 GPU 의 위험은 알리기만 한다: 그 GPU 는 채굴기가 쓰지 않으므로 채굴기를 멈춰도 소용없고 보류도 걸지 않는다
  const trips = result.exclude.filter((e) => !mineOff(gpuOf(e.id)));
  for (const e of result.exclude.filter((x) => !trips.includes(x))) {
    alertOnce({ ts: now, level: 'warn', code: 'safety_not_mining', gpu: e.id, message: `${gpuOf(e.id)?.label ?? e.id}: ${e.reason} — 채굴하지 않는 GPU 라 채굴기는 그대로 둡니다. 카드 상태를 확인하세요` }, 10 * 60_000);
  }
  for (const e of trips) runtime.holds[e.id] = e.reason;
  if (trips.length) saveRuntime();
  await enforceHolds(trips, now);

  env.onChange();
}

export async function refreshRemote(includeVast: boolean): Promise<void> {
  const c = coin();
  const kp = kryptexPool();
  const errors: string[] = [];
  const now = Date.now();
  const models = [...new Set(settings.gpus.filter((g) => g.rentalUsdManual <= 0 && nvOf(g.id)).map((g) => shortName(nvOf(g.id)!.name)))];
  await Promise.all([
    fetchCoingecko(c.coingeckoId).then((r) => {
      if (!r) throw new Error('CoinGecko 응답 형식');
      remote.prlUsd = r.usd;
      remote.priceAt = now;
      remote.change24h = r.change24h;
      ledger = recordPrice(ledger, r.usd, now);
      logEvent({ t: now, type: 'price', coin: c.id, usd: r.usd, krwPerUsd: settings.profit.krwPerUsd });
      priceUnpriced(pnl, c.id, r.usd * settings.profit.krwPerUsd);
      if (settings.profit.baselinePrlUsd <= 0) {
        settings.profit.baselinePrlUsd = r.usd;
        saveSettings();
      }
    }).catch((e) => errors.push(`시세: ${(e as Error).message}`)),
    kp && !settings.wallet
      ? fetchKryptexPool(kp.ticker).then((pool) => { remote.pool = pool ?? remote.pool; }).catch((e) => errors.push(`풀: ${(e as Error).message}`))
      : null,
    kp && settings.wallet
      ? fetchKryptex(kp.ticker, settings.wallet).then((k) => {
          remote.pool = k.pool ?? remote.pool;
          remote.payouts = k.payouts;
          if (k.balance !== null) {
            remote.balance = k.balance;
            // 공유 장부를 쓰는데 폴더가 안 보이면 풀 증가를 기록하지 않는다: 다른 OS 가 이미 센 몫을 이 PC 의
            // 오래된 기준점으로 다시 세게 된다. 폴더가 다시 보이면 그때의 기준점부터 이어 간다
            if (sharedDir() && !sharedStatus?.ok) return;
            // 다른 인스턴스(다른 OS)가 그 사이 기록한 기준점이 있으면 먼저 받아들인다
            syncPoolIn();
            if (ledger.payoutKeys !== 2) fixPayoutDuplicates(k.balance, k.payouts, k.payoutsComplete, now);
            // 다른 OS 가 먼저 바로잡은 기준점을 받은 경우: 이 PC 장부의 중복분만 한 번 뺀다
            else if (!pnl.dupFixed) {
              const { events, shared } = ledgerEvents();
              fixLocalBook(findPayoutDuplicates(events, c.id), shared);
            }
            const prevTotal = ledger.lastTotal;
            const fresh = freshPayouts(new Set(ledger.seenPayouts), k.payouts);
            ledger = recordEarnings(ledger, k.balance, k.payouts, now, k.payoutsComplete);
            // 기록한 누적치가 한 시간 넘게 풀 진실값보다 높으면 진실값으로 내리고 장부에서도 뺀다
            const drift = settleDrift(ledger, now);
            if (drift.gap > 0) {
              ledger = drift.ledger;
              logEvent({ t: now, type: 'adjust', coin: c.id, qty: -drift.gap, at: now, krwPerCoin: priceKrw(), reason: 'pool-truth' });
              warnLeft(adjustMined(pnl, c.id, now, -drift.gap, priceKrw()));
              env.log.info(`pnl: cumulative lowered to the pool total by ${drift.gap.toFixed(8)} ${c.id}`);
              pushAlert({ ts: now, level: 'info', code: 'pnl_corrected', message: `누적 채굴량을 풀 실측(지급 + 풀 잔고)에 맞춰 ${drift.gap.toFixed(4)} ${c.symbol} 내렸습니다 (한 시간 넘게 풀 값이 더 낮았음)` }, false);
            }
            for (const p of fresh) logEvent({ t: now, type: 'payout', coin: c.id, key: p.key, amount: p.amount, at: p.at });
            if (ledger.lastTotal !== null && ledger.lastTotal !== prevTotal) {
              logEvent({ t: now, type: 'pool', coin: c.id, total: ledger.lastTotal });
              if (prevTotal === null) {
                // 처음 잡은 누적치 = 추적 시작 이전 채굴분 (소급 대상)
                startTracking(pnl, c.id, now, ledger.lastTotal);
              } else if (ledger.lastTotal > prevTotal) {
                const qty = ledger.lastTotal - prevTotal;
                const from = pnl.lastMinedAt ?? undefined;
                addPoolIncrease(pnl, c.id, now, qty, priceKrw());
                logEvent({ t: now, type: 'mined', coin: c.id, qty, krwPerCoin: priceKrw(), from });
              }
              syncPoolOut();
            }
          }
        }).catch((e) => errors.push(`풀: ${(e as Error).message}`))
      : null,
    includeVast || priceSeries.length === 0
      ? fetchMarketChart(c.coingeckoId).then((j) => { priceSeries = parseMarketChart(j); }).catch((e) => errors.push(`시세 차트: ${(e as Error).message}`))
      : null,
    ...(includeVast
      ? models.map((m) =>
          fetchVastStats({ gpuName: m, verifiedOnly: settings.profit.vastVerifiedOnly, type: settings.profit.vastType, regions: settings.profit.vastRegions.split(',') }, now)
            .then((v) => { remote.vast[m] = v; })
            .catch((e) => errors.push(`Vast ${m}: ${(e as Error).message}`)),
        )
      : []),
  ]);
  remote.updatedAt = now;
  remote.error = errors.length ? errors.join(' · ') : null;
  writeJson(file('ledger.json'), ledger);
  if (sharedDir()) syncShared();
  autoBackfill();
  savePnl();

  const rows = compareRows(gpuViews()).map((r) => ({ ...r, reviewRentalUsd: settings.gpus.find((g) => g.id === r.id)?.reviewRentalUsd ?? 0 }));
  for (const a of reviewAlerts(rows, remote.prlUsd, settings.profit, now)) alertOnce(a, REVIEW_REPEAT_MS);
  env.onChange();
}

/**
 * 0.5.0 이하에서 같은 지급을 두 번 센 장부 바로잡기 (한 번). 지급 중 → 지급 완료로 바뀌며 txid 가 생기면 다른 지급으로 보았다.
 * 누적치는 풀 진실값(잔고 + 지급 합)으로, 채굴량은 중복이 들어간 증가분의 날짜에서 그때 시세로 뺀다 (공유 장부에도 바로잡기 이벤트).
 */
function fixPayoutDuplicates(balance: number, payouts: Payout[], complete: boolean, now: number): void {
  // 아직 기준점이 없으면 바로잡을 것이 없다 (첫 조회가 새 키로 지급을 센다)
  if (ledger.lastTotal === null) {
    ledger = { ...ledger, payoutKeys: 2 };
    return;
  }
  const coin = settings.coin;
  const { events, shared } = ledgerEvents();
  const dups = findPayoutDuplicates(events, coin);
  const dupPaid = dups.reduce((s, d) => s + d.amount, 0);
  const dupQty = dups.reduce((s, d) => s + d.qty, 0);
  const before = ledger.lastTotal;
  const r = correctPayouts(ledger, balance, payouts, complete, dupPaid, now, dupQty);
  ledger = r.ledger;
  for (const d of dups) {
    if (!d.done) logEvent({ t: now, id: d.id, type: 'adjust', coin, qty: -d.qty, at: d.t, krwPerCoin: d.krwPerCoin, reason: 'payout-dup' });
  }
  fixLocalBook(dups, shared);
  // 중복 지급으로 설명되지 않는 나머지 (지급 목록이 잔고보다 먼저 바뀐 순간이 굳은 경우 등): 오늘부터 거슬러 뺀다.
  // id 가 인스턴스와 무관해 다른 OS 가 같은 바로잡기를 해도 공유 장부에서 한 번만
  const rest = r.excess - dupQty;
  if (rest > 1e-6) {
    logEvent({ t: now, id: `fix-pool-truth:${coin}:v0.5.1`, type: 'adjust', coin, qty: -rest, at: now, krwPerCoin: priceKrw(), reason: 'pool-truth' });
    warnLeft(adjustMined(pnl, coin, now, -rest, priceKrw()));
    ledger = subtractEarnings(ledger, now, rest);
  }
  if (ledger.lastTotal !== before) logEvent({ t: now, type: 'pool', coin, total: ledger.lastTotal ?? 0 });
  savePnl();
  writeJson(file('ledger.json'), ledger);
  syncPoolOut();
  sharedDirty = true;
  env.log.info(`pnl: payout keys migrated (${dups.length} duplicate payouts, paid ${dupPaid.toFixed(8)} / mined ${dupQty.toFixed(8)} ${coin}; total ${before} → ${ledger.lastTotal}, list ${complete ? 'complete' : 'partial'})`);
  if (r.excess > 1e-6 || dupQty > 1e-6) {
    pushAlert({ ts: now, level: 'info', code: 'pnl_corrected', message: `누적 채굴량을 바로잡았습니다: 같은 지급을 두 번 센 ${Math.max(r.excess, dupQty).toFixed(4)} ${coin.toUpperCase()} 를 뺐습니다 (지급 중 → 지급 완료 때 중복). 이제 풀 누적 = 지급 + 풀 잔고` }, false);
  }
}

/** 바로잡기에 쓸 이벤트: 공유 장부가 보이면 모든 인스턴스 것, 아니면 이 PC 것 */
function ledgerEvents(): { events: (PnlEvent & { src?: string })[]; shared: boolean } {
  const dir = sharedDir();
  const shared = !!dir && !!sharedStatus?.ok;
  return { events: shared ? mergeEvents(readSharedEvents(sharedRoot(dir!))) : readEvents(pnlEvents()), shared };
}

/** 이 PC 장부(공유 폴더가 안 보일 때 쓰는 장부)에서 이 PC 가 센 중복 지급분을 한 번 뺀다 */
function fixLocalBook(dups: ReturnType<typeof findPayoutDuplicates>, shared: boolean): void {
  if (pnl.dupFixed) return;
  for (const d of dups) {
    if (shared && d.src !== instanceId) continue;
    warnLeft(adjustMined(pnl, settings.coin, d.t, -d.qty, d.krwPerCoin));
    ledger = subtractEarnings(ledger, d.t, d.qty);
  }
  pnl.dupFixed = true;
}

/** 확정 채굴 기록이 모자라 빼지 못한 양 (소급분만 있는 경우 등) */
function warnLeft(left: number): void {
  if (left > 1e-9) env.log.warn(`pnl: correction could not remove ${left.toFixed(8)} (not enough confirmed output recorded)`);
}

function validatePatch(p: Partial<Settings>): string | null {
  const next = mergeSettings(settings, p);
  const acc = validateAccount(next);
  if (acc) return acc;
  if (!catalog.coins.some((c) => c.id === next.coin)) return '알 수 없는 코인입니다';
  if (next.minerApi.adapter !== 'none' && !Object.hasOwn(MINER_APIS, next.minerApi.adapter)) return '지원하지 않는 채굴기 API 입니다';
  if (!Number.isInteger(next.minerApi.port) || next.minerApi.port < 1024 || next.minerApi.port > 65535) return '채굴기 API 포트는 1024~65535 정수여야 합니다';
  const mc = next.minerControl;
  if (!['none', 'task', 'systemd', 'direct'].includes(mc.mode) || ![mc.taskName, mc.unit, mc.exe, mc.args].every((v) => typeof v === 'string')) return '채굴 켜기·끄기 설정이 올바르지 않습니다';
  const ctlErr = validateControl(mc, MOCK ? 'windows' : PLATFORM);
  if (ctlErr) return ctlErr;
  if (mc.mode === 'direct' && !MOCK && !fs.existsSync(mc.exe)) return `채굴기 실행 파일이 없습니다: ${mc.exe}`;
  // 자동 매도를 바꾸는 저장만 검사한다 (예전 버전에서 남은 값이 다른 설정 저장이나 "끄기"를 막지 않게 — 실행 때 다시 검사)
  const turningOff = p.autoSell?.enabled === false && Object.keys(p.autoSell).length === 1;
  const asErr = p.autoSell !== undefined && !turningOff ? validateAutoSell(next.autoSell) : null;
  if (asErr) return `자동 매도: ${asErr}`;
  const co = next.cashout;
  if (![co.prlDepositMin, co.prlConfirmations, co.sellFeePct, co.withdrawFeeUsdt, co.withdrawMinUsdt, co.withdrawSuggestUsdt].every((v) => Number.isFinite(v) && v >= 0) || typeof co.withdrawNetwork !== 'string' || co.withdrawNetwork.length > 20 || typeof co.measuredAt !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(co.measuredAt)) {
    return '현금화 경로 값이 올바르지 않습니다';
  }
  if (typeof next.sharedLedgerDir !== 'string' || (next.sharedLedgerDir && !path.isAbsolute(next.sharedLedgerDir)) || /[\0\r\n]/.test(next.sharedLedgerDir)) {
    return '공유 장부 폴더는 절대 경로여야 합니다 (예: U:\\ 또는 /mnt/crypthy)';
  }
  if (!Number.isInteger(next.updateIntervalMin) || next.updateIntervalMin < MIN_INTERVAL_MIN || next.updateIntervalMin > MAX_INTERVAL_MIN) {
    return `업데이트 확인 주기는 ${MIN_INTERVAL_MIN}~${MAX_INTERVAL_MIN}분 정수여야 합니다`;
  }
  for (const g of next.gpus) {
    const nv = nvOf(g.id);
    const err = validateWatts(g.powerLimitW, nv?.powerMinW ?? null, nv?.powerMaxW ?? null);
    if (err) return `${g.label}: ${err}`;
    if (!(g.rentalUsdManual >= 0 && g.reviewRentalUsd >= 0)) return `${g.label}: 대여가 값이 올바르지 않습니다`;
    if (!g.label.trim() || g.label.length > 40) return 'GPU 이름은 1~40자여야 합니다';
  }
  const s = next.safety;
  if (!(s.fanStopPowerW > 0 && s.fanStopSeconds >= 2 && s.tempWarnC < s.tempStopC && s.tempStopC <= 95)) {
    return '안전 설정 값이 올바르지 않습니다 (경고 < 정지 ≤ 95°C, 팬 판정 ≥ 2초)';
  }
  const pr = next.profit;
  if (!['on-demand', 'interruptible'].includes(pr.vastType)) return 'Vast 매물 유형이 올바르지 않습니다';
  if (!/^\s*([A-Za-z]{2}(\s*,\s*[A-Za-z]{2})*)?\s*$/.test(pr.vastRegions)) return 'Vast 지역은 국가 코드 쉼표 목록(예: KR,JP)이어야 합니다';
  if (![pr.krwPerKwh, pr.krwPerUsd, pr.vastHostShare, pr.rentalPowerW, pr.reviewPrlDropPct, pr.baselinePrlUsd].every((v) => Number.isFinite(v) && v >= 0)) {
    return '수익 설정 값이 올바르지 않습니다';
  }
  return null;
}

/** 코인이 바뀌면 시세 기준가·장부 기준점을 새로 잡는다 (로컬 변경·공유 설정 받아들이기 공통) */
function resetForCoin(): void {
  settings.profit.baselinePrlUsd = 0;
  ledger = emptyLedger();
  remote.prlUsd = remote.balance = remote.priceAt = null;
  remote.payouts = [];
  priceSeries = [];
  sharedDirty = true;
}

export function applyPatch(p: Partial<Settings>): string | null {
  const err = validatePatch(p);
  if (err) return err;
  const coinChanged = p.coin !== undefined && p.coin !== settings.coin;
  const vastKey = (x: Settings) => `${x.profit.vastVerifiedOnly}|${x.profit.vastType}|${x.profit.vastRegions}`;
  const vastChanged = vastKey(mergeSettings(settings, p)) !== vastKey(settings);
  const sharedKey = (x: Settings) => JSON.stringify(SHARED_SETTING_KEYS.map((k) => x[k]));
  const sharedChanged = sharedKey(mergeSettings(settings, p)) !== sharedKey(settings);
  const dirChanged = p.sharedLedgerDir !== undefined && p.sharedLedgerDir !== settings.sharedLedgerDir;
  settings = mergeSettings(settings, p);
  refreshKnownMiners();
  if (coinChanged) resetForCoin();
  saveSettings();
  env.onSettings?.(settings);
  if (dirChanged) {
    sharedBook = null;
    sharedStamp = '';
    sharedStatus = null;
    mirror = null;
    sharedTail = createTailReader();
    syncShared();
  } else if (sharedChanged) {
    sync.settingsDirty = true;
    saveSync();
    pushSharedSettings();
  }
  if (vastChanged) {
    // 필터가 바뀌면 이전 조건의 시세를 버리고 바로 다시 조회
    remote.vast = {};
    void refreshRemote(true);
  }
  return null;
}


/** 설정 저장 (검증 → 반영 → 시세·풀 다시 조회) */
export function saveSettingsPatch(patch: Partial<Settings>): string | null {
  const err = applyPatch(patch);
  if (!err) void refreshRemote(false);
  return err;
}

export const REAL_SELL_TEXT =
  '자동 매도를 실제 매도로 전환합니다. 매일 정한 시각에 SafeTrade 에서 지정가로 PRL 을 팝니다 (하한가 아래로는 팔지 않음). 먼저 모의 실행 결과를 확인했는지 다시 보세요.';

/**
 * 확인이 필요한 자동 매도 변경: 실제 매도를 새로 켜거나, 실제 매도 중에 보호 장치를 느슨하게 (하한가·한도 등)
 */
export function sellChangeNeedsConfirm(patch: Partial<Settings>): string | null {
  if (!patch.autoSell) return null;
  const cur = settings.autoSell;
  const next = { ...cur, ...patch.autoSell };
  if (!(next.enabled && !next.dryRun)) return null;
  if (!(cur.enabled && !cur.dryRun)) return REAL_SELL_TEXT;
  const looser =
    next.floorUsd < cur.floorUsd || next.maxDropPct > cur.maxDropPct || next.maxSpreadPct > cur.maxSpreadPct || next.minBidDepthUsd < cur.minBidDepthUsd ||
    next.dailyMaxPrl > cur.dailyMaxPrl || next.orderMaxUsd > cur.orderMaxUsd || next.reservePrl < cur.reservePrl ||
    next.repriceStepPct > cur.repriceStepPct || next.maxReprices > cur.maxReprices || next.market !== cur.market;
  return looser ? '실제 자동 매도의 하한가·한도 같은 보호 설정을 느슨하게 바꿉니다. 맞는지 확인해 주세요.' : null;
}

/** 설정 저장 — 실제 자동 매도를 켜거나 보호 설정을 느슨하게 하는 변경은 먼저 확인을 받는다 (화면·원격 모두) */
export async function saveSettingsConfirmed(patch: Partial<Settings>, confirm: Confirm): Promise<string | null> {
  const why = sellChangeNeedsConfirm(patch);
  if (why && !(await confirm('sell', why))) return '취소됨';
  // 실행 중에 자동 매도를 끄면 다음 주문 전에 멈춘다
  if (patch.autoSell?.enabled === false && autoSellBusy) autoSellStop = true;
  return saveSettingsPatch(patch);
}

export function addSaleRecord(raw: SaleInput): string | null {
  const qty = Number(raw?.qty);
  const proceeds = Number(raw?.proceedsKrw);
  const fee = Number(raw?.feeKrw ?? 0);
  if (!(qty > 0) || !(proceeds >= 0) || !(fee >= 0) || ![qty, proceeds, fee].every(Number.isFinite)) return '수량·매도 대금·수수료를 확인해 주세요';
  const venue = String(raw?.venue ?? '').slice(0, 60);
  const note = String(raw?.note ?? '').slice(0, 200);
  const now = Date.now();
  addSale(pnl, settings.coin, now, qty, proceeds, fee);
  logEvent({ t: now, type: 'sale', coin: settings.coin, qty, proceedsKrw: proceeds, feeKrw: fee, venue, note });
  savePnl();
  return null;
}

export function backfillPnl(fromMs: unknown, watts: unknown): string | null {
  const from = Number(fromMs);
  const w = Number(watts);
  const book = bookView();
  if (book.bootstrapped && !book.backfill) return '이전 버전에서 적용한 소급분이라 다시 계산할 수 없습니다';
  if (!book.trackStart) return '풀 누적치를 아직 받지 못했습니다 (지갑·Kryptex 풀 설정 후 다시 시도)';
  if (!Number.isFinite(from) || from >= book.trackStart.at || from < book.trackStart.at - 366 * 86_400_000) return '채굴 시작 시각은 추적 시작 이전, 1년 이내여야 합니다';
  if (!(w >= 0 && w <= 20_000)) return '추정 전력(W)을 확인해 주세요';
  applyBackfill(from, w, false);
  savePnl();
  return null;
}

/** PnL 일별 집계·이벤트 CSV 를 dir 에 쓴다 */
export function exportPnlCsv(dir: string): void {
  savePnl(true);
  const stamp = new Date().toISOString().slice(0, 10);
  // 공유 장부면 모든 인스턴스를 합친 장부 (이벤트 CSV 는 이 PC 의 로그)
  fs.writeFileSync(path.join(dir, `crypthy-pnl-daily-${stamp}.csv`), dailyCsv(bookView()));
  fs.writeFileSync(path.join(dir, `crypthy-pnl-events-${stamp}.csv`), eventsCsv(readEvents(pnlEvents())));
}

export function pnlFolder(): string {
  fs.mkdirSync(pnlDir(), { recursive: true });
  return pnlDir();
}

/** 기존 채굴기 bat 내용에서 지갑·풀을 읽어 설정에 넣는다 */
export function importBatText(text: string): string | null {
  const parsed = parseBatArgs(text.slice(0, 64_000));
  if (!parsed.wallet && !parsed.pool) return 'bat 에서 --wallet / --pool 값을 찾지 못했습니다';
  return applyPatch(parsed);
}

/** 카탈로그에 있는 저장소·출처 링크인가 (그 링크만 외부 브라우저로 연다) */
export const isAllowedLink = (url: unknown): url is string => typeof url === 'string' && links.has(url);

export async function registerPowerLimits(): Promise<string | null> {
  if (MOCK) return 'mock 모드에서는 예약 작업을 등록하지 않습니다';
  try {
    writePowerLimits();
    await power.register(env.resourcesDir, file('power-limits.json'), powerUser());
    powerRegistered = await power.isRegistered();
    await sleep(4000);
    powerLog = power.readLog();
    return powerRegistered ? null : '등록 확인 실패';
  } catch (e) {
    return `등록 실패(${IS_LINUX ? '인증 취소 포함' : 'UAC 취소 포함'}): ${(e as Error).message}`;
  }
}

export async function applyPowerLimits(): Promise<string | null> {
  if (MOCK) return 'mock 모드에서는 전력 제한을 적용하지 않습니다';
  writePowerLimits();
  if (!powerRegistered) return '먼저 전력 제한 등록을 1회 실행해 주세요';
  try {
    await power.run();
    await sleep(4000);
    powerLog = power.readLog();
    return null;
  } catch (e) {
    return `적용 실패: ${(e as Error).message}`;
  }
}

export const currentSettings = (): Settings => settings;


function loadState(): void {
  catalog = loadCatalog(path.join(__dirname, '..', 'catalog.json'));
  links = allowedLinks(catalog);
  // 차트 라이브러리 라이선스 고지 링크
  links.add('https://www.tradingview.com/');
  const raw = readJson<Partial<Settings> & { apiPort?: unknown }>(file('settings.json'), {});
  settings = mergeSettings(DEFAULT_SETTINGS, raw);
  // 0.1.x 의 SRBMiner API 포트(apiPort)를 이어받는다
  if (raw && !raw.minerApi && Number.isInteger(raw.apiPort)) settings.minerApi.port = raw.apiPort as number;
  if (!catalog.coins.some((c) => c.id === settings.coin)) settings.coin = catalog.coins[0].id;
  // 0.3.1 이하 장부는 v2 로 옮긴다 (음수를 만들던 일별 값은 순수익 계산에서 뺌, 풀 누적 기준점은 유지)
  ledger = migrateLedger(readJson<unknown>(file('ledger.json'), null));
  if (ledger.lastPrice) {
    remote.prlUsd = ledger.lastPrice.usd;
    remote.priceAt = ledger.lastPrice.at;
  }
  history = loadHistory(readJson<unknown>(file('history.json'), null));
  pnl = loadBook(readJson<unknown>(path.join(pnlDir(), 'daily.json'), null));
  // 0.3.3 이하에서 업데이트: 이미 잡힌 풀 누적치를 추적 시작점으로 (그 이전 채굴분은 소급으로 채움)
  if (!pnl.trackStart && ledger.lastTotal !== null) startTracking(pnl, settings.coin, Date.now(), ledger.lastTotal);
  // 0.3.4 에서 일별 장부에 합쳐 둔 소급분은 따로 떼어 낸다 (다시 계산할 수 있게)
  if (pnl.bootstrapped && !pnl.backfill) {
    const ev = readEvents(pnlEvents()).filter((e) => e.type === 'bootstrap').at(-1);
    if (ev?.type === 'bootstrap') separateLegacyBackfill(pnl, ev);
  }
  if (MOCK && Object.keys(history.series).length === 0) {
    const seed = mockSeed(Date.now());
    for (const g of seed.gpus) history.series[g.id] = g.points;
    for (const [k, d] of Object.entries(seed.days)) {
      ledger.days[k] ??= { prl: d.prl, kwh: d.kwh, matchedKwh: d.kwh * 0.97, matchedMs: 23 * 3_600_000, estPrl: d.prl * 0.95 };
    }
  }
  // 0.1.x 의 안전 제외(excluded)는 보류(holds)로 이어받는다
  const saved = readJson<{ holds?: Record<string, string>; excluded?: Record<string, string>; minerConsentAt?: unknown }>(file('runtime.json'), {});
  runtime = { holds: saved.holds ?? saved.excluded ?? {}, minerConsentAt: Number.isFinite(saved.minerConsentAt) ? (saved.minerConsentAt as number) : null };
  refreshKnownMiners();
}


// ---------- 공유 장부 동기화 ----------

const sharedDir = () => env.sharedLedgerDir || settings.sharedLedgerDir;
const syncFile = () => file('shared-sync.json');
const saveSync = () => writeJson(syncFile(), sync);

/** 다른 인스턴스가 더 최근에 쓴 풀 기준점을 받아들인다 (다른 OS 에서 돌던 동안의 증가분을 다시 세지 않게) */
function syncPoolIn(): void {
  const dir = sharedDir();
  if (!dir || !sharedStatus?.ok) return;
  const st = readPoolState(sharedRoot(dir));
  if (!st || st.gen <= sync.poolGen) return;
  // 다른 코인의 기준점은 받지 않는다 (공유 설정의 코인을 먼저 받아들인 뒤 다시 맞춘다)
  if (st.coin && st.coin !== settings.coin) return;
  if (st.payoutKeys !== 2 && st.by !== instanceId && ledger.payoutKeys === 2) {
    alertOnce({ ts: Date.now(), level: 'warn', code: 'shared_old_version', message: `다른 OS 의 Crypthy(${st.by})가 0.5.0 이하입니다 — 그 기기도 0.5.1 이상으로 업데이트하세요 (그 버전은 지급 중 → 완료 때 같은 지급을 두 번 셉니다)` }, 24 * 3600_000);
  }
  ledger = adoptPoolState(ledger, st);
  if (st.lastMinedAt !== null) pnl.lastMinedAt = Math.max(pnl.lastMinedAt ?? 0, st.lastMinedAt);
  // 재부팅 전 실시간 추정분은 그 사이 다른 OS 가 확정분으로 기록했다
  if (st.by !== instanceId) clearPending(pnl, settings.coin);
  sync.poolGen = st.gen;
  saveSync();
  env.log.info(`shared ledger: adopted pool state gen ${st.gen} from ${st.by} (total ${st.lastTotal})`);
}

/** 이 인스턴스가 바꾼 풀 기준점을 공유 폴더에 쓴다 */
function syncPoolOut(): void {
  const dir = sharedDir();
  if (!dir || !sharedStatus?.ok) return;
  try {
    const root = sharedRoot(dir);
    const gen = Math.max(sync.poolGen, readPoolState(root)?.gen ?? 0) + 1;
    writePoolState(root, poolStateOf(ledger, settings.coin, pnl.lastMinedAt, gen, instanceId));
    sync.poolGen = gen;
    saveSync();
  } catch (e) {
    env.log.warn(`shared ledger: cannot write pool state: ${(e as Error).message}`);
  }
}

function pushSharedSettings(): void {
  const dir = sharedDir();
  if (!dir || !sharedStatus?.ok) return;
  try {
    const root = sharedRoot(dir);
    const gen = Math.max(sync.settingsGen, readSharedSettings(root)?.gen ?? 0) + 1;
    writeSharedSettings(root, sharedSettingsOf(settings, gen, instanceId));
    sync.settingsGen = gen;
    sync.settingsDirty = false;
    saveSync();
  } catch (e) {
    env.log.warn(`shared ledger: cannot write shared settings: ${(e as Error).message}`);
  }
}

/**
 * 공유 폴더와 맞춘다 (시작·1분마다·설정 변경 때):
 *  1) 공유 설정(코인·지갑·풀·수익)이 더 새로우면 받아들이고, 처음이면 이 PC 설정을 올린다
 *  2) 풀 기준점 받아들이기
 *  3) 로컬 이벤트 중 공유 폴더의 내 파일에 없는 것을 덧붙인다 (처음엔 기존 장부 전체, 꺼져 있던 동안의 밀린 것도)
 *  4) 공유 이벤트가 바뀌었으면 모든 인스턴스 이벤트로 장부를 다시 계산
 * 폴더가 없거나(마운트 안 됨) 쓸 수 없으면 로컬에 계속 기록하고 다음에 다시 맞춘다.
 */
export function syncShared(): void {
  const dir = sharedDir();
  if (!dir) {
    sharedBook = null;
    sharedStatus = null;
    return;
  }
  const root = sharedRoot(dir);
  const status: SharedLedgerView = { dir, ok: false, error: null, instanceId, instances: sharedStatus?.instances ?? [], at: sharedStatus?.at ?? null, overlaps: sharedOverlaps };
  try {
    if (!fs.existsSync(dir)) throw new Error('폴더가 없습니다 (디스크가 연결·마운트되지 않았을 수 있습니다)');
    // 한 번 연결했던 폴더에 crypthy/ 가 없으면 만들지 않는다: 마운트되지 않은 빈 마운트 지점일 가능성이 크다
    if (sync.rootDir === dir && !fs.existsSync(path.join(root, 'pnl'))) throw new Error(`${root} 가 없습니다 (공유 파티션이 마운트되지 않았을 수 있습니다)`);
    fs.mkdirSync(path.join(root, 'pnl'), { recursive: true });
    if (sync.rootDir !== dir) {
      sync.rootDir = dir;
      saveSync();
    }
    status.ok = true;
    sharedStatus = status;

    // 1) 공유 설정: 이 PC 에서 바꾼 것(연결이 끊겼던 동안 포함)을 먼저 올리고, 아니면 더 새로운 것을 받아들인다
    const ss = readSharedSettings(root);
    if (!ss || sync.settingsDirty) pushSharedSettings();
    else if (ss.gen > sync.settingsGen) {
      const patch = Object.fromEntries(SHARED_SETTING_KEYS.map((k) => [k, ss[k]]).filter(([, v]) => v !== undefined)) as Partial<Settings>;
      if (!validatePatch(patch)) {
        const coinChanged = patch.coin !== undefined && patch.coin !== settings.coin;
        settings = mergeSettings(settings, patch);
        if (coinChanged) resetForCoin();
        saveSettings();
        env.log.info(`shared ledger: adopted shared settings gen ${ss.gen} from ${ss.by}`);
      }
      sync.settingsGen = ss.gen;
      saveSync();
    }

    // 2) 풀 기준점
    syncPoolIn();

    // 3) 내 로그 → 공유 폴더의 내 파일 (처음엔 기존 장부 전체, 이후 늘어난 것만)
    if (!mirror || mirror.dir !== dir) mirror = { dir, push: createMirror(pnlEvents(), sharedEventsFile(root, instanceId)) };
    const pushed = mirror.push();
    if (pushed) env.log.info(`shared ledger: pushed ${pushed} events`);

    // 4) 모든 인스턴스 이벤트로 다시 계산 (파일이 바뀌었을 때만, 늘어난 부분만 읽는다)
    const stamp = sharedEventsStamp(root);
    if (stamp !== sharedStamp || sharedDirty || !sharedBook) {
      let lists = readSharedEvents(root, sharedTail);
      // 소급분은 날짜별 금액을 담은 이벤트로 한 번 올려 둔다 (어느 인스턴스에도 그런 이벤트가 없을 때만)
      if (!backfillShared && pnl.backfill && pnl.backfill.coin === settings.coin && !lists.some((l) => l.events.some((e) => e.type === 'bootstrap' && e.days))) {
        const bf = pnl.backfill;
        logEvent({ t: Date.now(), type: 'bootstrap', coin: bf.coin, from: bf.from, to: bf.to, qty: bf.qty, watts: bf.watts, kwh: Object.values(bf.days).reduce((a, d) => a + d.energyKwh, 0), auto: bf.auto, days: bf.days });
        mirror.push();
        lists = readSharedEvents(root, sharedTail);
      }
      backfillShared = true;
      // 바로잡기 전 버전(다른 OS)이 같은 지급을 두 번 센 기록이 들어오면 바로잡기 이벤트를 남긴다
      if (ledger.payoutKeys === 2) {
        const fresh = findPayoutDuplicates(mergeEvents(lists), settings.coin).filter((d) => !d.done);
        for (const d of fresh) {
          logEvent({ t: Date.now(), id: d.id, type: 'adjust', coin: settings.coin, qty: -d.qty, at: d.t, krwPerCoin: d.krwPerCoin, reason: 'payout-dup' });
          // 그 구버전 기준점도 이만큼 더 부풀려졌다: 받아들일 때 더 낮춰 본다 (나중에 다시 빼지 않게)
          if (d.src !== instanceId) ledger = { ...ledger, legacyOffset: (ledger.legacyOffset ?? 0) + d.qty };
        }
        if (fresh.length) {
          writeJson(file('ledger.json'), ledger);
          mirror.push();
          lists = readSharedEvents(root, sharedTail);
        }
      }
      const r = replayEvents(mergeEvents(lists), settings.coin);
      sharedBook = r.book;
      if (r.overlaps > 0 && r.overlaps !== sharedOverlaps) {
        alertOnce({ ts: Date.now(), level: 'warn', code: 'shared_ledger_overlap', message: `공유 장부: 다른 OS 의 전력 기록과 시간이 ${r.overlaps}곳 겹칩니다 — 두 인스턴스가 동시에 돌았거나 시계가 어긋났을 수 있습니다` }, 6 * 3600_000);
      }
      sharedOverlaps = r.overlaps;
      sharedStamp = sharedEventsStamp(root);
      sharedDirty = false;
      status.instances = lists.map((l) => l.src);
    }
    status.overlaps = sharedOverlaps;
    status.at = Date.now();
  } catch (e) {
    status.ok = false;
    status.error = (e as Error).message;
    sharedBook = null;
    alertOnce({ ts: Date.now(), level: 'warn', code: 'shared_ledger_offline', message: `공유 장부 폴더를 쓸 수 없어 이 PC 에만 기록합니다 (${status.error}). 이 동안 풀 증가분은 기록하지 않고, 폴더가 다시 보이면 이어서 기록합니다` }, 6 * 3600_000);
  }
  sharedStatus = status;
}

// ---------- 수명 주기 ----------

const timers: NodeJS.Timeout[] = [];

/** 코어 시작: 상태를 읽고 첫 폴링 뒤 주기 작업(2초 폴링·5분 시세/풀·1분 저장)을 건다 */
export async function initCore(e: CoreEnv): Promise<void> {
  env = e;
  loadState();
  instanceId = ensureInstanceId(env.dataDir, PLATFORM);
  srbCache = readJson<SrbDeviceCache | null>(srbCacheFile(), null);
  autoSell = { ...autoSell, ...readJson<Partial<AutoSellState>>(autoSellFile(), {}) };
  void refreshTaskStatus();
  sync = { poolGen: 0, settingsGen: 0, ...readJson<Partial<SyncState>>(syncFile(), {}) };
  syncShared();
  if (!MOCK) {
    powerRegistered = await power.isRegistered().catch(() => false);
    powerLog = power.readLog();
  }
  void hw.gpuVendors().then((v) => { vendors = v; }).catch(() => undefined);
  await poll();
  let polling = false;
  timers.push(setInterval(() => {
    if (polling) return;
    polling = true;
    poll().finally(() => (polling = false));
  }, POLL_MS));
  let remoteTick = 0;
  void refreshRemote(true);
  timers.push(setInterval(() => void refreshRemote(++remoteTick % (VAST_MS / REMOTE_MS) === 0), REMOTE_MS));
  timers.push(setInterval(() => saveAll(false), 60_000));
  timers.push(setInterval(() => {
    syncShared();
    env.onChange();
  }, SHARED_SYNC_MS));
  if (settings.autoStartMining) timers.push(setTimeout(() => void autoStartMining(), AUTO_START_DELAY_MS));
  timers.push(setInterval(() => void maybeAutoSell(), 60_000));
  // 지난번에 매도 중에 꺼졌으면 남은 주문을 정리하고 판 양을 기록 (자동 매도를 꺼 두었어도)
  if (autoSell.open || autoSell.progress) {
    timers.push(
      setTimeout(() => {
        const key = env.exchangeKey?.() ?? null;
        if (!key || autoSellBusy) return;
        autoSellBusy = true;
        void recoverInterrupted(key)
          .catch((e: Error) => env.log.warn(`autosell: recovery failed: ${e.message}`))
          .finally(() => {
            autoSellBusy = false;
            env.onChange();
          });
      }, 10_000),
    );
  }
}

/** 장부·기록 저장. final 이면 남은 전력 구간도 바로 기록 (종료·업데이트 설치 전) */
export function saveAll(final: boolean): void {
  if (!env || !settings) return;
  try {
    saveRuntime();
    writeJson(file('ledger.json'), ledger);
    writeJson(file('history.json'), historyToJson(history));
    savePnl(final);
  } catch (err) {
    env.log.error('save failed', err);
  }
}

/** 주기 작업 정지 (종료·업데이트 설치 전) */
export function stopCore(): void {
  for (const t of timers.splice(0)) clearInterval(t);
}

