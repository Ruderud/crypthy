// Crypthy 코어: 상태·폴링·안전 정지·수익·설정. Electron 에 의존하지 않는다.
// 데스크톱(main.ts, Electron 셸)과 헤드리스(headless.ts, Node + 원격 API)가 같은 코어를 쓴다.
// 화면·알림·대화상자처럼 실행 환경마다 다른 부분은 init 때 받은 env 로만 다룬다.
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Alert, AppState, ChartsView, CompareRow, PnlView, SaleInput, GpuConfig, GpuId, GpuView, HubView, ProfitView, Settings, SetupView, UpdateView, Vendor } from '../shared/types';
import { allowedLinks, knownProcessNames, loadCatalog, recommend, type Catalog } from './catalog';
import { DEFAULT_SETTINGS, isKryptexPool, mergeSettings, newGpu, parseBatArgs, readJson, shortName, validateAccount, writeJson } from './config';
import { linuxHardware, mockHardware, mockSeed, windowsHardware } from './hardware';
import { MINER_APIS, type MinerStats } from './minerApi';
import { controlProcessName, createMinerControl, decodeConsole, isUsableProcessName, parseTaskXml, startBlocker, validateControl, type Platform } from './minerControl';
import { parsePciBus, type NvGpu } from './nvsmi';
import {
  emptyLedger, migrateLedger, miningNetKrwPerHour, prlPerHour, PRICE_STALE_MS, recordEarnings, recordEnergy, recordPrice,
  rentalNetKrwPerHour, reviewAlerts, summarize, type Ledger, type Payout, type PoolStats,
} from './profit';
import {
  buildLimitsJson, isPowerTaskRegistered, readPowerLog, registerPowerTask, runPowerTask, validateWatts,
} from './powerLimit';
import { addSample, dailyClose, dailySeries, emptyHistory, historyToJson, loadHistory, parseMarketChart, seriesOf, type History } from './history';
import { linuxPower } from './powerLimitLinux';
import type { Logger } from './log';
import {
  addEnergy, addPending, addPoolIncrease, addSale, appendEvent, bootstrap, dailyCsv, emptyBook, estimateBackfillFrom, eventsCsv,
  freshPayouts, loadBook, pnlDaily, priceUnpriced, readEvents, separateLegacyBackfill, startTracking, summarizePnl, type PnlBook, type PnlEvent,
} from './pnl';
import { fetchCoingecko, fetchKryptex, fetchKryptexPool, fetchMarketChart, fetchVastStats, type VastStats } from './remote';
import { evaluateSafety, type SafetyState } from './safety';
import { matchSrbDevice } from './srbminer';
import { DISABLED_UPDATE, MAX_INTERVAL_MIN, MIN_INTERVAL_MIN } from './updater';

/** 켜기·끄기 전에 사용자에게 받아야 하는 확인 */
export type ConfirmKind = 'consent' | 'danger' | 'stop';
/** 확인을 받으면 true. 헤드리스 API 는 요청에 확인이 없으면 NeedConfirm 을 던진다 */
export type Confirm = (kind: ConfirmKind, detail: string) => Promise<boolean>;

export class NeedConfirm extends Error {
  constructor(public kind: ConfirmKind, public detail: string) {
    super(`confirmation required: ${kind}`);
  }
}

/** 처음 켤 때 받는 위험·비용 고지 (데스크톱 대화상자·원격 클라이언트·헤드리스 안내에 같은 문장) */
export const CONSENT_TEXT = [
  '· 채굴은 전기 요금이 들고, GPU 발열·팬·커넥터 수명에 부담을 줍니다. 수익은 코인 시세·난이도에 따라 손실이 될 수 있습니다.',
  '· Crypthy 는 채굴기를 내려받거나 설치하지 않습니다. 직접 구성한 채굴기(예약 작업·유닛·실행 파일)를 켜고 끌 뿐이며, 채굴기와 그 수수료(dev fee)는 채굴기 배포처의 책임입니다.',
  '· 채굴 수익은 채굴기에 설정한 지갑으로만 지급됩니다. 앱은 수수료를 떼지 않습니다.',
  '· 안전 감시는 보조 수단입니다. 위험 조건이면 채굴기를 정지하고 다시 켜지 않습니다. 하드웨어 상태는 직접 확인해야 합니다.',
].join('\n');

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
const logEvent = (ev: PnlEvent) => appendEvent(pnlEvents(), ev);
/** 전력 이벤트는 10분 단위로 묶어 기록 */
let energyBuf: { start: number; end: number; wms: number; kwh: number } | null = null;
const ENERGY_EVENT_MS = 10 * 60_000;
let priceSeries: { t: number; usd: number }[] = [];
let powerRegistered = false;
let powerLog: string | null = null;
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

function isMining(g: GpuConfig): boolean {
  if (!running) return false;
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
  const watts = gpus.reduce((s, g) => s + (g.present ? (g.powerW ?? 0) : 0), 0);
  const liveCoinPerH = hash && remote.pool ? prlPerHour(hash, remote.pool) : null;
  return {
    supported,
    symbol: coin().symbol,
    price: usd === null || remote.priceAt === null ? null : { usd, at: remote.priceAt, stale: now - remote.priceAt > PRICE_STALE_MS },
    change24hPct: remote.change24h,
    balanceCoin: remote.balance,
    paidCoin: remote.payouts.length ? remote.payouts.reduce((s, x) => s + x.amount, 0) : null,
    lifetimeCoin: supported ? ledger.lastTotal : null,
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
  logEvent({ t: energyBuf.end, type: 'energy', start: energyBuf.start, end: energyBuf.end, avgW: energyBuf.wms / span, kwh: energyBuf.kwh, krwPerKwh: settings.profit.krwPerKwh });
  energyBuf = null;
}

const priceKrw = () => (remote.prlUsd === null ? null : remote.prlUsd * settings.profit.krwPerUsd);

function pnlView(): PnlView {
  const stale = remote.priceAt !== null && Date.now() - remote.priceAt > PRICE_STALE_MS;
  const s = summarizePnl(pnl, settings.coin, Date.now(), priceKrw(), stale);
  return {
    symbol: coin().symbol,
    ...s,
    trackStart: pnl.trackStart,
    bootstrapped: pnl.bootstrapped,
    backfill: pnl.backfill && { from: pnl.backfill.from, to: pnl.backfill.to, qty: pnl.backfill.qty, watts: pnl.backfill.watts, auto: pnl.backfill.auto },
    currentWatts: Math.round(lastNv.reduce((a, g) => a + (g.powerW ?? 0), 0)),
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
  const ts = pnl.trackStart!;
  const fx = settings.profit.krwPerUsd;
  const closeKrw = Object.fromEntries(Object.entries(dailyClose(priceSeries)).map(([d, usd]) => [d, usd * fx]));
  const r = bootstrap(pnl, { coin: settings.coin, from, to: ts.at, qty: ts.total, watts, krwPerKwh: settings.profit.krwPerKwh, closeKrwByDay: closeKrw, fallbackKrw: priceKrw(), auto });
  logEvent({ t: Date.now(), type: 'bootstrap', coin: settings.coin, from, to: ts.at, qty: ts.total, watts, kwh: r.kwh, auto });
}

/**
 * 추적 시작 전 채굴분을 자동으로 소급한다(한 번만). 시작 시각은 풀 누적치 ÷ 지금 기대 채굴 속도로 추정하고
 * 가장 이른 지급보다 늦지 않게, 전력은 지금 GPU 전력 합. 해시레이트·풀 통계·전력이 모두 있을 때까지 기다린다.
 */
function autoBackfill(): void {
  const ts = pnl.trackStart;
  if (!ts || pnl.bootstrapped || !(ts.total > 0) || !kryptexPool()) return;
  const watts = Math.round(lastNv.reduce((a, g) => a + (g.powerW ?? 0), 0));
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
    daily: dailySeries(ledger, dailyClose(priceSeries), remote.prlUsd, settings.profit),
    pnl: pnlDaily(pnl, settings.coin, priceKrw()),
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
  spawnDetached: (cmd, cwd) =>
    new Promise<void>((resolve, reject) => {
      if (mockHw) return resolve(mockHw.start());
      // 셸 없이, 앱과 분리해 실행 (앱을 꺼도 채굴기는 계속). 실제로 떴는지(spawn) 실패했는지(error) 기다린다
      const child = spawn(cmd.file, cmd.args, { cwd, detached: true, stdio: 'ignore', shell: false, windowsHide: false });
      child.once('spawn', () => {
        child.unref();
        resolve();
      });
      child.once('error', (e) => reject(e));
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
  const err = await minerControl.start(settings.minerControl);
  if (err) {
    startingUntil = 0;
    return err;
  }
  startedByApp = true;
  pushAlert({ ts: Date.now(), level: 'info', code: 'miner_started', message: '채굴 켜기 (사용자)' }, false);
  env.onChange();
  return null;
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
  const parsed = parseTaskXml(xml);
  if (!parsed) return '예약 작업에서 실행 파일 동작을 찾지 못했습니다';
  if (!isUsableProcessName(path.win32.basename(parsed.exe))) {
    return `예약 작업이 ${path.win32.basename(parsed.exe)} 로 실행됩니다. 채굴기 이름을 알 수 없어 가져오지 않았습니다 — 실행 파일 칸에 채굴기 exe 경로를 직접 입력하세요 (작업 켜기·끄기는 그대로 쓸 수 있습니다)`;
  }
  return applyPatch({ minerControl: { ...c, exe: parsed.exe, args: parsed.args } });
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

  for (const g of gpuViews()) {
    if (g.present) history = addSample(history, g.id, { hash: g.hashrate, temp: g.tempC, power: g.powerW }, now);
  }

  if (lastPollAt) {
    const watts = lastNv.reduce((s, g) => s + (g.powerW ?? 0), 0);
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
      if (energyBuf.end - energyBuf.start >= ENERGY_EVENT_MS) flushEnergy();
    }
  }
  lastPollAt = now;

  // 안전 감시: nvidia-smi 우선, 없으면 채굴기 API 값
  const result = evaluateSafety(
    gpuViews().map((g) => ({ id: g.id, label: g.label, powerW: g.powerW, fanPct: g.fanPct, tempC: g.tempC, mining: g.mining })),
    safetyState, settings.safety, holdSet(), now,
  );
  safetyState = result.state;
  result.alerts.forEach((a) => pushAlert(a));
  for (const e of result.exclude) runtime.holds[e.id] = e.reason;
  if (result.exclude.length) saveRuntime();
  await enforceHolds(result.exclude, now);

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
            const prevTotal = ledger.lastTotal;
            const fresh = freshPayouts(new Set(ledger.seenPayouts), k.payouts);
            ledger = recordEarnings(ledger, k.balance, k.payouts, now);
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
  autoBackfill();
  savePnl();

  const rows = compareRows(gpuViews()).map((r) => ({ ...r, reviewRentalUsd: settings.gpus.find((g) => g.id === r.id)?.reviewRentalUsd ?? 0 }));
  for (const a of reviewAlerts(rows, remote.prlUsd, settings.profit, now)) alertOnce(a, REVIEW_REPEAT_MS);
  env.onChange();
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

export function applyPatch(p: Partial<Settings>): string | null {
  const err = validatePatch(p);
  if (err) return err;
  const coinChanged = p.coin !== undefined && p.coin !== settings.coin;
  const vastKey = (x: Settings) => `${x.profit.vastVerifiedOnly}|${x.profit.vastType}|${x.profit.vastRegions}`;
  const vastChanged = vastKey(mergeSettings(settings, p)) !== vastKey(settings);
  settings = mergeSettings(settings, p);
  refreshKnownMiners();
  if (coinChanged) {
    // 코인이 바뀌면 시세 기준가·장부 기준점을 새로 잡는다
    settings.profit.baselinePrlUsd = 0;
    ledger = emptyLedger();
    remote.prlUsd = remote.balance = remote.priceAt = null;
    remote.payouts = [];
    priceSeries = [];
  }
  saveSettings();
  env.onSettings?.(settings);
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
  if (pnl.bootstrapped && !pnl.backfill) return '이전 버전에서 적용한 소급분이라 다시 계산할 수 없습니다';
  if (!pnl.trackStart) return '풀 누적치를 아직 받지 못했습니다 (지갑·Kryptex 풀 설정 후 다시 시도)';
  if (!Number.isFinite(from) || from >= pnl.trackStart.at || from < pnl.trackStart.at - 366 * 86_400_000) return '채굴 시작 시각은 추적 시작 이전, 1년 이내여야 합니다';
  if (!(w >= 0 && w <= 20_000)) return '추정 전력(W)을 확인해 주세요';
  applyBackfill(from, w, false);
  savePnl();
  return null;
}

/** PnL 일별 집계·이벤트 CSV 를 dir 에 쓴다 */
export function exportPnlCsv(dir: string): void {
  savePnl(true);
  const stamp = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(path.join(dir, `crypthy-pnl-daily-${stamp}.csv`), dailyCsv(pnl));
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
    writeJson(file('power-limits.json'), buildLimitsJson(settings.gpus));
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
  writeJson(file('power-limits.json'), buildLimitsJson(settings.gpus));
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


// ---------- 수명 주기 ----------

const timers: NodeJS.Timeout[] = [];

/** 코어 시작: 상태를 읽고 첫 폴링 뒤 주기 작업(2초 폴링·5분 시세/풀·1분 저장)을 건다 */
export async function initCore(e: CoreEnv): Promise<void> {
  env = e;
  loadState();
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

