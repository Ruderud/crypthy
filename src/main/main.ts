import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, nativeImage, shell, Tray } from 'electron';
import { execFile, spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { Alert, AppState, ChartsView, CompareRow, PnlView, SaleInput, GpuConfig, GpuId, GpuView, HubView, ProfitView, Settings, SetupView, Vendor } from '../shared/types';
import { allowedLinks, knownProcessNames, loadCatalog, recommend, type Catalog } from './catalog';
import { DEFAULT_SETTINGS, isKryptexPool, mergeSettings, newGpu, parseBatArgs, readJson, shortName, validateAccount, writeJson } from './config';
import { linuxHardware, mockHardware, mockSeed, windowsHardware } from './hardware';
import { MINER_APIS, type MinerStats } from './minerApi';
import { controlProcessName, createMinerControl, decodeConsole, parseTaskXml, startBlocker, validateControl, type Platform } from './minerControl';
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
import {
  addEnergy, addPending, addPoolIncrease, addSale, appendEvent, bootstrap, dailyCsv, emptyBook, estimateBackfillFrom, eventsCsv,
  freshPayouts, loadBook, pnlDaily, priceUnpriced, readEvents, separateLegacyBackfill, startTracking, summarizePnl, type PnlBook, type PnlEvent,
} from './pnl';
import { setLinuxAutostart } from './autostart';
import { fetchCoingecko, fetchKryptex, fetchKryptexPool, fetchMarketChart, fetchVastStats, type VastStats } from './remote';
import { evaluateSafety, type SafetyState } from './safety';
import { matchSrbDevice } from './srbminer';
import { startStatusServer } from './statusApi';
import { createNotificationKeeper, updateDialogSpec } from './updatePrompt';
import { createUpdateController, DISABLED_UPDATE, MAX_INTERVAL_MIN, MIN_INTERVAL_MIN, mockUpdater, type UpdaterLike } from './updater';

const APP_NAME = 'Crypthy';
const MOCK = process.env.CRYPTHY_MOCK === '1';
const POLL_MS = 2000;
const REMOTE_MS = 5 * 60_000;
const VAST_MS = 30 * 60_000;
const MAX_ALERTS = 50;
const KILL_RETRY_MS = 15_000;
const KILL_CONFIRM_MS = 4000;
const REVIEW_REPEAT_MS = 6 * 3600_000;
/** 창이 뜬 뒤 몇 초 안에 첫 확인 */
const UPDATE_FIRST_CHECK_MS = 5_000;

const IS_LINUX = process.platform === 'linux';
const PLATFORM: Platform = IS_LINUX ? 'linux' : process.platform === 'win32' ? 'windows' : 'other';
const mockHw = MOCK ? mockHardware() : null;
const hw = mockHw ?? (IS_LINUX ? linuxHardware(() => knownMiners) : windowsHardware);
/** 전력 제한 백엔드: Windows = UAC 1회 예약 작업, Linux = pkexec 1회 systemd 서비스 + polkit */
const power = IS_LINUX
  ? linuxPower
  : { isRegistered: isPowerTaskRegistered, register: registerPowerTask, run: runPowerTask, readLog: readPowerLog };
const powerUser = () => (IS_LINUX ? os.userInfo().username : `${process.env.USERDOMAIN}\\${process.env.USERNAME}`);
const file = (name: string) => path.join(app.getPath('userData'), name);

interface Runtime {
  /** 안전 보류 GPU → 사유. 사용자가 해제하기 전까지 유지(앱 재시작·재부팅 후에도) */
  holds: Record<GpuId, string>;
  /** 채굴 켜기 전 위험·비용 고지에 동의한 시각 (처음 켤 때 1회) */
  minerConsentAt: number | null;
}

let catalog: Catalog;
let knownMiners: string[] = [];
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

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let trayKey = '';
let updater: ReturnType<typeof createUpdateController> | null = null;
/** OS 알림 참조 유지 (Windows 에서 GC 되면 클릭이 사라짐) */
const notifications = createNotificationKeeper();
let updateDialogOpen = false;
/** 사용자가 대화상자에서 "받기" 를 눌렀으면, 다 받은 뒤 설치 여부를 바로 묻는다 */
let askInstallWhenReady = false;

// ---------- 상태 ----------

const holdSet = () => new Set(Object.keys(runtime.holds));
const saveRuntime = () => writeJson(file('runtime.json'), runtime);
const saveSettings = () => writeJson(file('settings.json'), settings);
const nvOf = (id: GpuId) => lastNv.find((n) => n.busId === id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const coin = () => catalog.coins.find((c) => c.id === settings.coin) ?? catalog.coins[0];
const kryptexPool = () => (isKryptexPool(settings.pool) ? coin().pools.find((p) => p.stats === 'kryptex') : undefined);

function pushAlert(a: Alert, notify = a.level !== 'info' || a.code.startsWith('review')): void {
  alerts = [a, ...alerts].slice(0, MAX_ALERTS);
  if (notify && Notification.isSupported()) {
    notifications.show(new Notification({ title: a.level === 'critical' ? `${APP_NAME} 안전 경고` : APP_NAME, body: a.message }), showWindow);
  }
}

function alertOnce(a: Alert, withinMs: number): void {
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

function chartsView(): ChartsView {
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

function buildState(): AppState {
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
    update: updater?.view() ?? DISABLED_UPDATE,
    appVersion: app.getVersion(),
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
    const err = await killKnownMiners();
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

function clearHold(id: GpuId): void {
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
  spawnDetached: (cmd, cwd) => {
    if (mockHw) return mockHw.start();
    // 셸 없이, 앱과 분리해 실행 (앱을 꺼도 채굴기는 계속)
    const child = spawn(cmd.file, cmd.args, { cwd, detached: true, stdio: 'ignore', shell: false, windowsHide: false });
    child.on('error', (e) => pushAlert({ ts: Date.now(), level: 'warn', code: 'miner_start_failed', message: `채굴기 실행 실패: ${e.message}` }));
    child.unref();
  },
  killMiners: () => killKnownMiners(),
});

const holdLabels = () => Object.entries(runtime.holds).map(([id, r]) => `${settings.gpus.find((g) => g.id === id)?.label ?? id}(${r})`);

function controlBlocker(): string | null {
  return startBlocker({ config: settings.minerControl, platform: MOCK ? 'windows' : PLATFORM, running, holds: holdLabels(), starting: Date.now() < startingUntil });
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
  knownMiners = own && !base.some((b) => b.toLowerCase() === own.toLowerCase()) ? [...base, own] : base;
}

const parentWin = () => (win && !win.isDestroyed() && win.isVisible() ? win : null);
async function ask(opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const w = parentWin();
  return w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts);
}

/** 켜기: 조건 확인 → (처음이면) 위험·비용 고지 동의 → (최근 위험 정지가 있으면) 원인 확인 → 실행 */
async function startMining(): Promise<string | null> {
  // 최신 상태로 다시 확인 (이미 돌고 있으면 두 번째 채굴기를 띄우지 않는다)
  const procs = await hw.runningMiners(knownMiners).catch(() => null);
  if (procs?.length || (await minerApiAlive())) running = true;
  const blocked = controlBlocker();
  if (blocked) return blocked;
  if (runtime.minerConsentAt === null) {
    const r = await ask({
      type: 'warning',
      title: '채굴 위험·비용 고지',
      message: '채굴을 켜기 전에 확인해 주세요',
      detail: [
        '· 채굴은 전기 요금이 들고, GPU 발열·팬·커넥터 수명에 부담을 줍니다. 수익은 코인 시세·난이도에 따라 손실이 될 수 있습니다.',
        '· Crypthy 는 채굴기를 내려받거나 설치하지 않습니다. 직접 구성한 채굴기(예약 작업·유닛·실행 파일)를 켜고 끌 뿐이며, 채굴기와 그 수수료(dev fee)는 채굴기 배포처의 책임입니다.',
        '· 채굴 수익은 채굴기에 설정한 지갑으로만 지급됩니다. 앱은 수수료를 떼지 않습니다.',
        '· 안전 감시는 보조 수단입니다. 위험 조건이면 채굴기를 정지하고 다시 켜지 않습니다. 하드웨어 상태는 직접 확인해야 합니다.',
      ].join('\n'),
      checkboxLabel: '위 내용을 이해했고 내 책임으로 채굴합니다',
      buttons: ['동의하고 켜기', '취소'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (r.response !== 0) return '취소됨';
    if (!r.checkboxChecked) return '고지 내용에 체크해야 켤 수 있습니다';
    runtime.minerConsentAt = Date.now();
    saveRuntime();
  }
  if (lastDangerStop && Date.now() - lastDangerStop.at < DANGER_WARN_MS) {
    const r = await ask({
      type: 'warning',
      title: '최근 위험 정지',
      message: '최근에 위험 조건으로 채굴기를 정지했습니다',
      detail: `${new Date(lastDangerStop.at).toLocaleString('ko-KR')} — ${lastDangerStop.message}\n\n원인(팬·온도·전력)을 해결했는지 확인한 뒤 켜 주세요.`,
      buttons: ['그래도 켜기', '취소'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    if (r.response !== 0) return '취소됨';
  }
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
  broadcast();
  return null;
}

/** 끄기: (설정 시) 확인 1회 → 정지 명령 → 프로세스 정지 확인. 관리자 권한 채굴기는 끌 수 없으면 안내 */
async function stopMining(): Promise<string | null> {
  if (!running) return '실행 중인 채굴기가 없습니다';
  if (settings.minerControl.confirmStop) {
    const r = await ask({ type: 'question', title: APP_NAME, message: '채굴을 끌까요?', buttons: ['끄기', '취소'], defaultId: 0, cancelId: 1, noLink: true });
    if (r.response !== 0) return '취소됨';
  }
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
    broadcast();
  }
}

/** Windows 예약 작업의 실행 파일·인자를 읽어 설정에 채운다 (작업 이름은 설정에서) */
async function importMinerTask(): Promise<string | null> {
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

async function poll(): Promise<void> {
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
  else if (Date.now() > startingUntil) startedByApp = false;
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

  broadcast();
}

async function refreshRemote(includeVast: boolean): Promise<void> {
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
  broadcast();
}

// ---------- UI ----------

function broadcast(): void {
  const st = buildState();
  if (win && !win.isDestroyed() && win.isVisible()) win.webContents.send('state', st);
  updateTray(st);
}

const iconPath = () => path.join(__dirname, '..', 'icon.png');

function showWindow(): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    // 숨겨져 있는 동안에는 상태를 보내지 않으므로, 다시 보일 때 바로 최신 상태를 보낸다
    win.webContents.send('state', buildState());
    return;
  }
  win = new BrowserWindow({
    width: 1180,
    height: 900,
    minWidth: 760,
    title: APP_NAME,
    icon: iconPath(),
    autoHideMenuBar: true,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
  win.webContents.setWindowOpenHandler(({ url }) => {
    // 차트의 TradingView 출처 링크(라이선스 고지)만 기본 브라우저로 연다
    try {
      if (new URL(url).origin === 'https://www.tradingview.com') void shell.openExternal(url);
    } catch {
      // 잘못된 URL 은 무시
    }
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.on('close', (e) => {
    if (!quitting) {
      e.preventDefault();
      win?.hide();
    }
  });
}

function updateTray(st: AppState): void {
  if (!tray) return;
  const status = st.miner.running ? `채굴기 실행 중 (${st.miner.processes.join(', ') || 'API'})` : '채굴기 없음';
  const temps = st.gpus.filter((g) => g.present).map((g) => `${g.label} ${g.tempC ?? '-'}°C${g.hold ? ' 보류' : ''}`).join(' / ');
  tray.setToolTip(`${APP_NAME}\n${status}\n${temps}`.slice(0, 127));
  const u = st.update;
  const ctl = st.miner.control;
  const key = `${status}|${u.status}|${u.version}|${u.prompt}|${ctl.mode}|${ctl.canStart}|${ctl.canStop}`;
  if (key === trayKey) return;
  trayKey = key;
  const updateItem =
    u.status === 'disabled'
      ? []
      : u.prompt || u.status === 'ready' || u.status === 'available'
        ? [{ label: u.status === 'ready' ? `업데이트 v${u.version} 설치 준비됨…` : `새 버전 v${u.version} 있음…`, click: () => { showWindow(); void showUpdateDialog(); } }]
        : [{ label: '업데이트 확인', click: () => { showWindow(); void checkUpdateNow(); } }];
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: 'separator' },
      { label: '대시보드 열기', click: showWindow },
      ...(ctl.mode === 'none'
        ? []
        : [
            { label: '채굴 켜기', enabled: ctl.canStart, click: () => void startMining().then((e) => e && e !== '취소됨' && trayNotice(e)) },
            { label: '채굴 끄기', enabled: ctl.canStop, click: () => void stopMining().then((e) => e && e !== '취소됨' && trayNotice(e)) },
          ]),
      ...updateItem,
      { type: 'separator' },
      { label: '종료', click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

function trayNotice(message: string): void {
  pushAlert({ ts: Date.now(), level: 'warn', code: 'miner_control', message });
}

// ---------- IPC ----------

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

function applyPatch(p: Partial<Settings>): string | null {
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
  applyLoginItem();
  updater?.setIntervalMin(settings.updateIntervalMin);
  if (vastChanged) {
    // 필터가 바뀌면 이전 조건의 시세를 버리고 바로 다시 조회
    remote.vast = {};
    void refreshRemote(true);
  }
  return null;
}

/** 설치형(Windows NSIS) 과 Linux AppImage 에서만 자동 업데이트 (deb·zip 은 수동). 실패해도 안전 감시와 무관 */
function startUpdater(): void {
  const mockUpdate = MOCK && process.env.CRYPTHY_MOCK_UPDATE === '1';
  const supported = process.platform === 'win32' || (IS_LINUX && !!process.env.APPIMAGE);
  if (!mockUpdate && (MOCK || !app.isPackaged || !supported)) return;
  try {
    const source: UpdaterLike = mockUpdate ? mockUpdater() : (require('electron-updater') as typeof import('electron-updater')).autoUpdater;
    let lastStatus = '';
    updater = createUpdateController(source, {
      initialDelayMs: UPDATE_FIRST_CHECK_MS,
      intervalMin: settings.updateIntervalMin,
      onChange: (v) => {
        if (v.status === 'ready' && askInstallWhenReady) {
          askInstallWhenReady = false;
          void showUpdateDialog();
        }
        if (v.status === 'error' && lastStatus !== 'error') {
          alertOnce({ ts: Date.now(), level: 'info', code: 'update_error', message: `업데이트 확인 실패: ${v.error}` }, 6 * 3600_000);
        }
        lastStatus = v.status;
        broadcast();
      },
      // 새 안내가 뜰 때 OS 알림 (트레이에만 있어도 보이도록). 클릭하면 창을 연다
      onPrompt: (v) => {
        const message = v.prompt === 'ready'
          ? `v${v.version} 를 받아 두었습니다. 재시작하면 설치됩니다 — 채굴은 계속됩니다`
          : `새 버전 v${v.version} 이 있습니다. 앱에서 받기 / 나중에 를 고르세요`;
        pushAlert({ ts: Date.now(), level: 'info', code: v.prompt === 'ready' ? 'update_ready' : 'update_available', message }, false);
        if (Notification.isSupported()) {
          // 클릭하면 창을 열고 선택지(받기/나중에 또는 재시작해 설치/나중에)를 대화상자로 띄운다
          notifications.show(new Notification({ title: `${APP_NAME} 업데이트`, body: message }), () => {
            showWindow();
            void showUpdateDialog();
          });
        }
      },
    });
  } catch (e) {
    pushAlert({ ts: Date.now(), level: 'info', code: 'update_error', message: `자동 업데이트 초기화 실패: ${(e as Error).message}` }, false);
  }
}

/** 안내할 업데이트가 있으면 네이티브 대화상자로 선택지를 보여 준다 (배너가 안 보이는 상황 대비) */
async function showUpdateDialog(): Promise<void> {
  if (!updater || updateDialogOpen) return;
  const spec = updateDialogSpec(updater.view(), app.getVersion(), APP_NAME);
  if (!spec) return;
  updateDialogOpen = true;
  try {
    const opts = { type: 'info' as const, title: spec.title, message: spec.message, detail: spec.detail, buttons: spec.buttons, defaultId: 0, cancelId: 1, noLink: true };
    const r = win && !win.isDestroyed() && win.isVisible() ? await dialog.showMessageBox(win, opts) : await dialog.showMessageBox(opts);
    if (r.response !== 0) {
      updater.dismiss();
    } else if (spec.action === 'download') {
      askInstallWhenReady = true;
      void updater.download();
    } else {
      installUpdate();
    }
  } finally {
    updateDialogOpen = false;
    broadcast();
  }
}

/** 사용자가 직접 확인(앱 상단·트레이): 새 버전이 있으면 대화상자까지 띄운다 */
async function checkUpdateNow(): Promise<void> {
  if (!updater) return;
  await updater.checkNow();
  broadcast();
  await showUpdateDialog();
}

/** 받아 둔 업데이트 설치 (사용자가 누를 때만). 채굴기는 앱과 별도 프로세스라 계속 돈다 */
function installUpdate(): string | null {
  if (!updater || updater.view().status !== 'ready') return '설치할 업데이트가 없습니다';
  saveRuntime();
  writeJson(file('ledger.json'), ledger);
  writeJson(file('history.json'), historyToJson(history));
  savePnl(true);
  quitting = true;
  updater.install();
  return null;
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => buildState());
  ipcMain.handle('charts:get', () => chartsView());
  ipcMain.handle('pnl:sale', (_e, raw: SaleInput) => {
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
  });
  ipcMain.handle('pnl:bootstrap', (_e, fromMs: unknown, watts: unknown) => {
    const from = Number(fromMs);
    const w = Number(watts);
    if (pnl.bootstrapped && !pnl.backfill) return '이전 버전에서 적용한 소급분이라 다시 계산할 수 없습니다';
    if (!pnl.trackStart) return '풀 누적치를 아직 받지 못했습니다 (지갑·Kryptex 풀 설정 후 다시 시도)';
    if (!Number.isFinite(from) || from >= pnl.trackStart.at || from < pnl.trackStart.at - 366 * 86_400_000) return '채굴 시작 시각은 추적 시작 이전, 1년 이내여야 합니다';
    if (!(w >= 0 && w <= 20_000)) return '추정 전력(W)을 확인해 주세요';
    applyBackfill(from, w, false);
    savePnl();
    return null;
  });
  ipcMain.handle('pnl:export', async () => {
    const r = await dialog.showOpenDialog({ title: 'CSV 저장 폴더 선택', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return '취소됨';
    savePnl(true);
    const stamp = new Date().toISOString().slice(0, 10);
    fs.writeFileSync(path.join(r.filePaths[0], `crypthy-pnl-daily-${stamp}.csv`), dailyCsv(pnl));
    fs.writeFileSync(path.join(r.filePaths[0], `crypthy-pnl-events-${stamp}.csv`), eventsCsv(readEvents(pnlEvents())));
    return null;
  });
  ipcMain.handle('pnl:openFolder', async () => {
    fs.mkdirSync(pnlDir(), { recursive: true });
    await shell.openPath(pnlDir());
  });
  ipcMain.handle('safety:clearHold', (_e, id: unknown) => clearHold(String(id)));
  ipcMain.handle('miner:start', () => startMining());
  ipcMain.handle('miner:stop', () => stopMining());
  ipcMain.handle('miner:importTask', () => importMinerTask());
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    const err = applyPatch(patch);
    if (!err) void refreshRemote(false);
    return err;
  });
  ipcMain.handle('setup:importBat', async () => {
    const r = await dialog.showOpenDialog({ title: '기존 채굴기 실행 bat 선택', properties: ['openFile'], filters: [{ name: 'Batch', extensions: ['bat', 'cmd'] }] });
    if (r.canceled || !r.filePaths[0]) return '취소됨';
    const parsed = parseBatArgs(fs.readFileSync(r.filePaths[0], 'utf8').slice(0, 64_000));
    if (!parsed.wallet && !parsed.pool) return 'bat 에서 --wallet / --pool 값을 찾지 못했습니다';
    return applyPatch(parsed);
  });
  // 카탈로그에 있는 저장소·출처 링크만 기본 브라우저로 연다
  ipcMain.handle('hub:openLink', async (_e, url: unknown) => {
    if (typeof url === 'string' && links.has(url)) await shell.openExternal(url);
  });
  ipcMain.handle('update:check', () => checkUpdateNow());
  ipcMain.handle('update:download', () => updater?.download());
  ipcMain.handle('update:dismiss', () => updater?.dismiss());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('power:register', async () => {
    if (MOCK) return 'mock 모드에서는 예약 작업을 등록하지 않습니다';
    try {
      writeJson(file('power-limits.json'), buildLimitsJson(settings.gpus));
      const resources = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
      await power.register(resources, file('power-limits.json'), powerUser());
      powerRegistered = await power.isRegistered();
      await sleep(4000);
      powerLog = power.readLog();
      return powerRegistered ? null : '등록 확인 실패';
    } catch (e) {
      return `등록 실패(${IS_LINUX ? '인증 취소 포함' : 'UAC 취소 포함'}): ${(e as Error).message}`;
    }
  });
  ipcMain.handle('power:apply', async () => {
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
  });
}

function applyLoginItem(): void {
  if (!app.isPackaged || MOCK) return;
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: ['--hidden'] });
  else if (IS_LINUX) {
    try {
      setLinuxAutostart(settings.openAtLogin);
    } catch (e) {
      pushAlert({ ts: Date.now(), level: 'warn', code: 'autostart_failed', message: `자동 실행 설정 실패: ${(e as Error).message}` });
    }
  }
}

// ---------- 시작 ----------

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

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    app.setAppUserModelId('io.github.ruderud.crypthy');
    loadState();
    registerIpc();
    applyLoginItem();

    tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);

    startStatusServer(buildState, (e) => pushAlert({ ts: Date.now(), level: 'warn', code: 'status_api', message: `로컬 상태 API 시작 실패: ${e.message}` }));
    if (!MOCK) {
      powerRegistered = await power.isRegistered();
      powerLog = power.readLog();
    }

    void hw.gpuVendors().then((v) => { vendors = v; }).catch(() => undefined);
    await poll();
    let polling = false;
    setInterval(() => {
      if (polling) return;
      polling = true;
      poll().finally(() => (polling = false));
    }, POLL_MS);
    let remoteTick = 0;
    void refreshRemote(true);
    setInterval(() => void refreshRemote(++remoteTick % (VAST_MS / REMOTE_MS) === 0), REMOTE_MS);
    setInterval(() => {
      writeJson(file('ledger.json'), ledger);
      writeJson(file('history.json'), historyToJson(history));
      savePnl();
    }, 60_000);

    if (!process.argv.includes('--hidden')) showWindow();
    startUpdater();
  });

  app.on('window-all-closed', () => {
    // 트레이 상주: 창을 닫아도 종료하지 않음
  });
  app.on('before-quit', () => {
    quitting = true;
    try {
      writeJson(file('ledger.json'), ledger);
      writeJson(file('history.json'), historyToJson(history));
      savePnl(true);
    } catch {
      // 종료 중 저장 실패는 무시
    }
  });
}
