import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, nativeImage, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Alert, AppState, CompareRow, GpuConfig, GpuId, GpuView, ProfitView, Settings, SetupView } from '../shared/types';
import { DEFAULT_SETTINGS, mergeSettings, newGpu, readJson, shortName, writeJson } from './config';
import { mockHardware, realHardware } from './hardware';
import { COIN_PRESETS, gpuIdsFor, isKryptexPool, parseBatArgs, validateMinerSettings } from './miner';
import { fetchLatestRelease, installRelease, type ReleaseInfo } from './minerSetup';
import type { NvGpu } from './nvsmi';
import {
  emptyLedger, miningNetKrwPerHour, netKrw, recordEarnings, recordEnergy, rentalNetKrwPerHour,
  reviewAlerts, summarize, type Ledger, type Payout, type PoolStats,
} from './profit';
import {
  buildLimitsJson, isPowerTaskRegistered, readPowerLog, registerPowerTask, runPowerTask, validateWatts,
} from './powerLimit';
import { fetchCoingecko, fetchKryptex, fetchVastMedian } from './remote';
import { evaluateSafety, type SafetyState } from './safety';
import { learnSrbIds, matchSrbDevice, type SrbStatus } from './srbminer';
import { startStatusServer } from './statusApi';

const APP_NAME = 'Crypthy';
const MOCK = process.env.CRYPTHY_MOCK === '1';
const POLL_MS = 2000;
const REMOTE_MS = 5 * 60_000;
const VAST_MS = 30 * 60_000;
const MAX_ALERTS = 50;
const WATCHDOG_MISSES = 3;
const MAX_RESTARTS_PER_HOUR = 5;
const ENFORCE_RETRY_MS = 15_000;
const REVIEW_REPEAT_MS = 6 * 3600_000;
const KILL_CONFIRM_MS = 4000;
const DETECT_TIMEOUT_MS = 40_000;

const hw = MOCK ? mockHardware() : realHardware;
const file = (name: string) => path.join(app.getPath('userData'), name);

interface Runtime {
  wantRunning: boolean;
  /** 앱이 마지막으로 채굴을 시작한 GPU 선택 */
  selection: GpuId[];
  /** 앱이 실행한 채굴기 PID. 실행 중인 PID 와 다르면 외부 실행으로 본다 */
  ourPid: number | null;
  currentIds: number[];
  /** 안전 감시로 제외된 GPU → 사유. 사용자가 "재허용" 하기 전까지 유지 */
  excluded: Record<GpuId, string>;
}

let settings: Settings;
let ledger: Ledger;
let runtime: Runtime;
let safetyState: SafetyState = {};
let alerts: Alert[] = [];
let lastNv: NvGpu[] = [];
let lastSrb: SrbStatus | null = null;
let pids: number[] = [];
let running = false;
let external = false;
let lastPollAt = 0;
let misses = 0;
let restarts: number[] = [];
let lastEnforceAt = 0;
/** 새 제외·매핑 변경 후 재적용이 성공할 때까지 유지 */
let pendingEnforce = false;
let enforceFailed = false;
let busy = false;
let detecting = false;
let release: ReleaseInfo | null = null;
let powerRegistered = false;
let powerLog: string | null = null;
const remote = {
  prlUsd: null as number | null,
  change24h: null as number | null,
  balance: null as number | null,
  payouts: [] as Payout[],
  pool: null as PoolStats | null,
  vastUsd: {} as Record<string, number | null>,
  updatedAt: null as number | null,
  error: null as string | null,
};

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let trayMenuKey = '';

// ---------- 상태 ----------

const excludedSet = () => new Set(Object.keys(runtime.excluded));
const saveRuntime = () => writeJson(file('runtime.json'), runtime);
const saveSettings = () => writeJson(file('settings.json'), settings);
const nvOf = (id: GpuId) => lastNv.find((n) => n.busId === id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function pushAlert(a: Alert, notify = a.level !== 'info' || a.code.startsWith('review')): void {
  alerts = [a, ...alerts].slice(0, MAX_ALERTS);
  if (notify && Notification.isSupported()) {
    new Notification({ title: a.level === 'critical' ? `${APP_NAME} 안전 경고` : APP_NAME, body: a.message }).show();
  }
}

function alertOnce(a: Alert, withinMs: number): void {
  if (!alerts.some((x) => x.code === a.code && x.gpu === a.gpu && a.ts - x.ts < withinMs)) pushAlert(a);
}

function srbDeviceOf(g: GpuConfig) {
  return lastSrb ? matchSrbDevice(lastSrb.devices, nvOf(g.id)?.bus ?? null, g.srbId) : undefined;
}

function isMining(g: GpuConfig): boolean {
  if (!running) return false;
  const dev = srbDeviceOf(g);
  if (dev) return (dev.hashrate ?? 0) > 0;
  // API 가 없으면 보수적으로: 외부 실행이거나 앱이 이 GPU 로 실행했으면 채굴 중으로 본다
  return external || (g.srbId !== null && runtime.currentIds.includes(g.srbId));
}

function gpuViews(): GpuView[] {
  return settings.gpus.map((g) => {
    const nv = nvOf(g.id);
    const dev = srbDeviceOf(g);
    return {
      id: g.id,
      label: g.label,
      index: nv?.index ?? null,
      name: nv?.name ?? dev?.model ?? g.label,
      srbId: g.srbId,
      tempC: nv?.tempC ?? dev?.tempC ?? null,
      fanPct: nv?.fanPct ?? dev?.fanPct ?? null,
      powerW: nv?.powerW ?? dev?.powerW ?? null,
      powerLimitW: nv?.powerLimitW ?? null,
      powerMinW: nv?.powerMinW ?? null,
      powerMaxW: nv?.powerMaxW ?? null,
      utilPct: nv?.utilPct ?? null,
      hashrate: running ? (dev?.hashrate ?? null) : null,
      selected: settings.selected.includes(g.id),
      mining: isMining(g),
      excluded: runtime.excluded[g.id] ?? null,
      present: !!nv,
    };
  });
}

function minerExists(): boolean {
  return MOCK ? !!settings.minerDir : !!settings.minerDir && fs.existsSync(path.win32.join(settings.minerDir, settings.minerExe));
}

function setupView(): SetupView {
  const present = settings.gpus.filter((g) => nvOf(g.id));
  return {
    minerFound: minerExists(),
    walletSet: !!settings.wallet,
    poolSet: !!settings.pool,
    gpusMapped: present.length > 0 && present.every((g) => g.srbId !== null),
    consented: settings.consentAt !== null,
  };
}

function compareRows(gpus: GpuView[]): CompareRow[] {
  const p = settings.profit;
  return settings.gpus.map((g) => {
    const v = gpus.find((x) => x.id === g.id);
    const auto = remote.vastUsd[shortName(v?.name ?? g.label)] ?? null;
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
    };
  });
}

function profitView(gpus: GpuView[]): ProfitView {
  const p = settings.profit;
  const sum = summarize(ledger, Date.now());
  const usd = remote.prlUsd;
  return {
    supported: isKryptexPool(settings.pool) && !!COIN_PRESETS[settings.coin].kryptexTicker,
    prlUsd: usd,
    prlChange24hPct: remote.change24h,
    balancePrl: remote.balance,
    paidPrl: remote.payouts.length ? remote.payouts.reduce((s, x) => s + x.amount, 0) : null,
    ...sum,
    todayNetKrw: usd === null ? null : netKrw(sum.todayPrl, sum.todayKwh, usd, p),
    monthNetKrw: usd === null ? null : netKrw(sum.monthPrl, sum.monthKwh, usd, p),
    compare: compareRows(gpus),
    updatedAt: remote.updatedAt,
    error: remote.error,
  };
}

function buildState(): AppState {
  const gpus = gpuViews();
  const present = gpus.filter((g) => g.present).length;
  return {
    ts: Date.now(),
    mock: MOCK,
    setup: setupView(),
    miner: {
      running,
      mode: !running ? null : external ? 'external' : runtime.currentIds.length >= present ? 'all' : 'partial',
      gpuIds: running ? (lastSrb?.devices.map((d) => d.id) ?? runtime.currentIds) : [],
      pool: running ? (lastSrb?.pool ?? null) : null,
      latencyMs: running ? (lastSrb?.latencyMs ?? null) : null,
      uptimeS: running ? (lastSrb?.uptimeS ?? null) : null,
      accepted: running ? (lastSrb?.accepted ?? null) : null,
      rejected: running ? (lastSrb?.rejected ?? null) : null,
      totalHashrate: running ? (lastSrb?.totalHashrate ?? null) : null,
      apiOk: lastSrb !== null,
    },
    gpus,
    alerts,
    profit: profitView(gpus),
    power: { registered: powerRegistered, lastLog: powerLog },
    settings,
  };
}

// ---------- 채굴 제어 ----------

/** 실행 전 조건: 동의, 설정 형식, 실행 파일 */
function launchBlocker(): string | null {
  if (settings.consentAt === null) return '채굴 위험·비용 고지에 먼저 동의해 주세요';
  if (!minerExists()) return `SRBMiner 실행 파일을 찾지 못했습니다 (${settings.minerDir || '폴더 미지정'})`;
  return validateMinerSettings(settings);
}

/** 모든 채굴기 프로세스를 끄고 실제로 꺼졌는지 확인한다 */
async function stopAll(): Promise<string | null> {
  // tasklist 가 실패하면(null) 꺼졌다고 가정하지 않고 일단 kill 후 다시 확인한다
  const before = await hw.minerPids(settings.minerExe).catch(() => null);
  if (before !== null && before.length === 0) return null;
  const killErr = await hw.kill(settings.minerExe);
  const deadline = Date.now() + KILL_CONFIRM_MS;
  while (Date.now() < deadline) {
    await sleep(500);
    const left = await hw.minerPids(settings.minerExe).catch(() => null);
    if (left !== null && left.length === 0) {
      runtime.ourPid = null;
      runtime.currentIds = [];
      return null;
    }
  }
  const msg = `채굴기 종료 실패${killErr ? `: ${killErr}` : ''} — 관리자 권한으로 실행된 채굴기는 앱이 끌 수 없습니다. 작업 관리자에서 직접 종료해 주세요`;
  pushAlert({ ts: Date.now(), level: 'critical', code: 'kill_failed', message: msg });
  return msg;
}

/**
 * 원하는 선택·제외 목록에 맞게 채굴기를 (재)실행하거나 정지한다.
 * failSafe: 안전 제외 때문에 호출됨 → 재실행이 불가능하면 정지라도 한다.
 */
async function applyDesired(reason: string, failSafe = false): Promise<string | null> {
  if (busy) return '다른 제어 작업이 진행 중입니다';
  busy = true;
  try {
    const ids = gpuIdsFor(runtime.selection, settings.gpus, excludedSet());
    if (!runtime.wantRunning || ids.length === 0) {
      const err = await stopAll();
      if (!err && runtime.wantRunning) {
        pushAlert({ ts: Date.now(), level: 'critical', code: 'all_excluded', message: '채굴 정지: 선택한 GPU가 모두 안전 제외됨' });
      }
      return err;
    }
    const blocker = ids.includes(null) ? 'SRBMiner id 매핑이 없는 GPU가 있습니다 (설정 → GPU 매핑 감지)' : launchBlocker();
    if (blocker) {
      if (failSafe) {
        const err = await stopAll();
        pushAlert({ ts: Date.now(), level: 'critical', code: 'failsafe_stop', message: `재실행 불가(${blocker}) → 채굴 전체 정지${err ? ' 실패' : ''}` });
      }
      return blocker;
    }
    const stopErr = await stopAll();
    if (stopErr) return stopErr;
    const launchIds = ids as number[];
    runtime.ourPid = hw.launch(settings, launchIds);
    runtime.currentIds = launchIds;
    misses = 0;
    pushAlert({ ts: Date.now(), level: 'info', code: 'miner_launch', message: `채굴기 실행 (${reason}): --gpu-id ${launchIds.join(',')}` }, false);
    return null;
  } catch (e) {
    return `채굴기 제어 실패: ${(e as Error).message}`;
  } finally {
    saveRuntime();
    busy = false;
  }
}

async function startMining(selection: GpuId[]): Promise<string | null> {
  const known = selection.filter((id) => settings.gpus.some((g) => g.id === id));
  if (known.length === 0) return '채굴할 GPU를 선택해 주세요';
  const blocker = launchBlocker();
  if (blocker) return blocker;
  settings.selected = known;
  saveSettings();
  runtime.selection = known;
  runtime.wantRunning = true;
  return applyDesired('사용자');
}

async function stopMining(): Promise<string | null> {
  runtime.wantRunning = false;
  const err = await applyDesired('정지');
  if (!err) pushAlert({ ts: Date.now(), level: 'info', code: 'miner_stop', message: '채굴 정지 (사용자)' }, false);
  return err;
}

async function clearExclusion(id: GpuId): Promise<void> {
  delete runtime.excluded[id];
  delete safetyState[id];
  saveRuntime();
  const label = settings.gpus.find((g) => g.id === id)?.label ?? id;
  pushAlert({ ts: Date.now(), level: 'info', code: 'exclusion_cleared', gpu: id, message: `${label} 채굴 재허용 (사용자)` }, false);
  if (runtime.wantRunning && !external) await applyDesired('재허용');
}

/** 모든 GPU 로 잠깐 실행해 SRBMiner API 의 PCI bus 로 id 를 학습한 뒤, 이전 상태로 돌린다 */
async function detectMapping(): Promise<string | null> {
  const blocker = launchBlocker();
  if (blocker) return blocker;
  if (busy || detecting) return '다른 제어 작업이 진행 중입니다';
  // 감지는 --gpu-id 없이 모든 GPU 로 돌기 때문에, 안전 제외된 GPU 가 있으면 하지 않는다
  if (Object.keys(runtime.excluded).length) return '안전 제외된 GPU가 있어 매핑 감지를 할 수 없습니다. SRBMiner id 를 직접 입력해 주세요';
  detecting = true;
  busy = true;
  try {
    const stopErr = await stopAll();
    if (stopErr) return stopErr;
    runtime.ourPid = hw.launch(settings, []);
    runtime.currentIds = [];
    const deadline = Date.now() + DETECT_TIMEOUT_MS;
    while (Date.now() < deadline) {
      await sleep(2000);
      // 감지 중에도 poll() 이 안전 감시를 계속한다. 새 제외가 생기면 즉시 중단
      if (Object.keys(runtime.excluded).length) break;
      const srb = await hw.minerStatus(settings.apiPort).catch(() => null);
      if (srb && srb.devices.some((d) => d.bus !== null)) {
        lastSrb = srb;
        learnMapping();
        break;
      }
    }
    const err = await stopAll();
    if (err) return err;
    const s = setupView();
    return s.gpusMapped ? null : 'SRBMiner API 에서 PCI bus 정보를 읽지 못했습니다. GPU별 SRBMiner id 를 직접 입력해 주세요';
  } finally {
    busy = false;
    detecting = false;
    saveRuntime();
    // 감지 전에 채굴 중이었으면 원래 선택으로 다시 시작
    if (runtime.wantRunning) await applyDesired('매핑 감지 후 복귀');
  }
}

/** SRBMiner API 의 bus 정보로 id 매핑을 갱신. 제외된 GPU 매핑이 바뀌면 true */
function learnMapping(): boolean {
  if (!lastSrb) return false;
  const changes = learnSrbIds(settings.gpus, (id) => nvOf(id)?.bus ?? null, lastSrb.devices);
  let excludedChanged = false;
  for (const c of changes) {
    const g = settings.gpus.find((x) => x.id === c.id)!;
    g.srbId = c.to;
    if (runtime.excluded[g.id]) excludedChanged = true;
    pushAlert(
      { ts: Date.now(), level: c.from === null ? 'info' : 'warn', code: 'srb_mapping', gpu: g.id, message: `${g.label} SRBMiner id ${c.from ?? '없음'} → ${c.to} (PCI bus 기준 자동 매핑)` },
      c.from !== null,
    );
  }
  if (changes.length) saveSettings();
  return excludedChanged;
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
  // 매핑 감지 중(busy)에도 센서·안전 평가는 계속한다. 재적용·워치독은 !busy 조건으로 건너뛴다
  const now = Date.now();
  const [nv, srb, ps] = await Promise.all([
    settle(hw.queryGpus()),
    settle(hw.minerStatus(settings.apiPort)),
    settle(hw.minerPids(settings.minerExe)),
  ]);
  lastNv = nv ?? [];
  lastSrb = srb;
  pids = ps ?? (srb ? pids : []);
  running = pids.length > 0 || srb !== null;
  external = running && (runtime.ourPid === null || !pids.includes(runtime.ourPid) || pids.length > 1);
  discoverGpus();
  if (learnMapping()) pendingEnforce = true;

  if (lastPollAt) {
    const watts = lastNv.reduce((s, g) => s + (g.powerW ?? 0), 0);
    ledger = recordEnergy(ledger, watts, Math.min(now - lastPollAt, 10_000), now);
  }
  lastPollAt = now;

  // 안전 감시: nvidia-smi 우선, 없으면 SRBMiner 값
  const views = gpuViews();
  const result = evaluateSafety(
    views.map((g) => ({ id: g.id, label: g.label, powerW: g.powerW, fanPct: g.fanPct, tempC: g.tempC, mining: g.mining })),
    safetyState, settings.safety, excludedSet(), now,
  );
  safetyState = result.state;
  result.alerts.forEach((a) => pushAlert(a));
  for (const e of result.exclude) runtime.excluded[e.id] = e.reason;
  if (result.exclude.length) {
    saveRuntime();
    pendingEnforce = true;
  }

  // 제외된 GPU 가 채굴 중일 수 있으면 다시 적용: 새 제외, 외부 실행(bat·작업 스케줄러·재부팅 후), 매핑 변경, 해시 감지
  const hasExcluded = Object.keys(runtime.excluded).length > 0;
  const leaking = views.some((g) => g.excluded && g.mining);
  if (!running || !hasExcluded) pendingEnforce = false;
  else if (!busy && ((pendingEnforce && !enforceFailed) || ((pendingEnforce || external || leaking) && now - lastEnforceAt > ENFORCE_RETRY_MS))) {
    lastEnforceAt = now;
    if (external || runtime.selection.length === 0) {
      // 외부 채굴기는 인수한다: 선택 GPU(없으면 인식된 전체)에서 제외 GPU 만 빼고 재실행
      runtime.selection = settings.selected.length ? settings.selected : settings.gpus.map((g) => g.id);
    }
    runtime.wantRunning = true;
    const err = await applyDesired('안전 제외', true);
    pendingEnforce = enforceFailed = !!err;
    if (err) alertOnce({ ts: now, level: 'critical', code: 'exclude_failed', message: `안전 제외 적용 실패: ${err}` }, 60_000);
  }

  // 워치독: 앱이 원하는데 채굴기가 꺼져 있으면 재시작 (시간당 제한)
  if (runtime.wantRunning && !running && !busy && runtime.currentIds.length) {
    misses += 1;
    restarts = restarts.filter((t) => now - t < 3600_000);
    if (misses >= WATCHDOG_MISSES && restarts.length < MAX_RESTARTS_PER_HOUR) {
      restarts.push(now);
      pushAlert({ ts: now, level: 'warn', code: 'miner_restart', message: `채굴기가 꺼져 있어 재시작합니다 (${restarts.length}/${MAX_RESTARTS_PER_HOUR}회/시간)` });
      const err = await applyDesired('워치독');
      if (err) alertOnce({ ts: now, level: 'warn', code: 'restart_failed', message: `재시작 실패: ${err}` }, 600_000);
    }
  } else if (running) {
    misses = 0;
  }

  broadcast();
}

async function refreshRemote(includeVast: boolean): Promise<void> {
  const preset = COIN_PRESETS[settings.coin];
  const errors: string[] = [];
  const now = Date.now();
  const models = [...new Set(settings.gpus.filter((g) => g.rentalUsdManual <= 0 && nvOf(g.id)).map((g) => shortName(nvOf(g.id)!.name)))];
  await Promise.all([
    preset.coingeckoId
      ? fetchCoingecko(preset.coingeckoId).then((c) => {
          if (!c) throw new Error('CoinGecko 응답 형식');
          remote.prlUsd = c.usd;
          remote.change24h = c.change24h;
          if (settings.profit.baselinePrlUsd <= 0) {
            settings.profit.baselinePrlUsd = c.usd;
            saveSettings();
          }
        }).catch((e) => errors.push(`시세: ${(e as Error).message}`))
      : null,
    preset.kryptexTicker && settings.wallet && isKryptexPool(settings.pool)
      ? fetchKryptex(preset.kryptexTicker, settings.wallet).then((k) => {
          remote.pool = k.pool ?? remote.pool;
          remote.payouts = k.payouts;
          if (k.balance !== null) {
            remote.balance = k.balance;
            ledger = recordEarnings(ledger, k.balance, k.payouts, now);
          }
        }).catch((e) => errors.push(`풀: ${(e as Error).message}`))
      : null,
    ...(includeVast
      ? models.map((m) => fetchVastMedian(m).then((v) => { remote.vastUsd[m] = v; }).catch((e) => errors.push(`Vast ${m}: ${(e as Error).message}`)))
      : []),
  ]);
  remote.updatedAt = now;
  remote.error = errors.length ? errors.join(' · ') : null;
  writeJson(file('ledger.json'), ledger);

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
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
  const status = st.miner.running ? `채굴 중 (${st.miner.mode})` : '채굴 정지';
  const temps = st.gpus.filter((g) => g.present).map((g) => `${g.label} ${g.tempC ?? '-'}°C${g.excluded ? ' 제외' : ''}`).join(' / ');
  tray.setToolTip(`${APP_NAME}\n${status}\n${temps}`.slice(0, 127));

  const key = `${status}|${st.gpus.map((g) => `${g.id}:${g.label}:${g.excluded}`).join()}`;
  if (key === trayMenuKey) return;
  trayMenuKey = key;
  const present = settings.gpus.filter((g) => nvOf(g.id));
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: status, enabled: false },
      { type: 'separator' },
      { label: '대시보드 열기', click: showWindow },
      { label: '채굴 시작: 선택한 GPU', enabled: settings.selected.length > 0, click: () => void startMining(settings.selected) },
      { label: '채굴 시작: 전체', click: () => void startMining(present.map((g) => g.id)) },
      ...present.map((g) => ({ label: `채굴 시작: ${g.label}만`, click: () => void startMining([g.id]) })),
      { label: '채굴 정지', click: () => void stopMining() },
      { type: 'separator' },
      { label: '종료 (채굴은 계속)', click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

// ---------- IPC ----------

function validatePatch(p: Partial<Settings>): string | null {
  const next = mergeSettings(settings, p);
  if (next.wallet || next.pool) {
    const err = validateMinerSettings({ ...next, minerDir: next.minerDir || 'x', wallet: next.wallet || 'placeholderwallet', pool: next.pool || 'host:1000' });
    if (err) return err;
  }
  for (const g of next.gpus) {
    const nv = nvOf(g.id);
    const err = validateWatts(g.powerLimitW, nv?.powerMinW ?? null, nv?.powerMaxW ?? null);
    if (err) return `${g.label}: ${err}`;
    if (g.srbId !== null && !(Number.isInteger(g.srbId) && g.srbId >= 0 && g.srbId < 64)) return `${g.label}: SRBMiner id 는 0~63 정수여야 합니다`;
    if (!(g.rentalUsdManual >= 0 && g.reviewRentalUsd >= 0)) return `${g.label}: 대여가 값이 올바르지 않습니다`;
    if (!g.label.trim() || g.label.length > 40) return 'GPU 이름은 1~40자여야 합니다';
  }
  const s = next.safety;
  if (!(s.fanStopPowerW > 0 && s.fanStopSeconds >= 2 && s.tempWarnC < s.tempStopC && s.tempStopC <= 95)) {
    return '안전 설정 값이 올바르지 않습니다 (경고 < 정지 ≤ 95°C, 팬 판정 ≥ 2초)';
  }
  const pr = next.profit;
  if (![pr.krwPerKwh, pr.krwPerUsd, pr.vastHostShare, pr.rentalPowerW, pr.reviewPrlDropPct, pr.baselinePrlUsd].every((v) => Number.isFinite(v) && v >= 0)) {
    return '수익 설정 값이 올바르지 않습니다';
  }
  return null;
}

function applyPatch(p: Partial<Settings>): string | null {
  const err = validatePatch(p);
  if (err) return err;
  settings = mergeSettings(settings, p);
  saveSettings();
  applyLoginItem();
  return null;
}

function registerIpc(): void {
  ipcMain.handle('state:get', () => buildState());
  ipcMain.handle('miner:start', (_e, selection: unknown) => (Array.isArray(selection) ? startMining(selection.map(String)) : '선택이 올바르지 않습니다'));
  ipcMain.handle('miner:stop', () => stopMining());
  ipcMain.handle('safety:clear', (_e, id: unknown) => clearExclusion(String(id)));
  ipcMain.handle('settings:save', (_e, patch: Partial<Settings>) => {
    // 동의 시각·선택은 전용 경로로만 바꾼다
    const { consentAt: _c, selected: _s, ...rest } = patch;
    const err = applyPatch(rest);
    if (!err) void refreshRemote(false);
    return err;
  });
  ipcMain.handle('setup:consent', () => {
    settings.consentAt = Date.now();
    saveSettings();
    return null;
  });
  ipcMain.handle('setup:pickMinerDir', async () => {
    const r = await dialog.showOpenDialog({ title: 'SRBMiner-MULTI 폴더 선택', properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return '취소됨';
    const dir = r.filePaths[0];
    if (!MOCK && !fs.existsSync(path.join(dir, settings.minerExe))) return `${settings.minerExe} 가 없는 폴더입니다`;
    return applyPatch({ minerDir: dir });
  });
  ipcMain.handle('setup:importBat', async () => {
    const r = await dialog.showOpenDialog({ title: '기존 SRBMiner 실행 bat 선택', properties: ['openFile'], filters: [{ name: 'Batch', extensions: ['bat', 'cmd'] }] });
    if (r.canceled || !r.filePaths[0]) return '취소됨';
    const parsed = parseBatArgs(fs.readFileSync(r.filePaths[0], 'utf8').slice(0, 64_000));
    if (!parsed.wallet && !parsed.pool) return 'bat 에서 --wallet / --pool 값을 찾지 못했습니다';
    const dir = path.dirname(r.filePaths[0]);
    const patch: Partial<Settings> = { ...parsed };
    if (!settings.minerDir && fs.existsSync(path.join(dir, settings.minerExe))) patch.minerDir = dir;
    return applyPatch(patch);
  });
  ipcMain.handle('miner:checkRelease', async () => {
    try {
      release = await fetchLatestRelease();
      const { md5Url: _m, ...value } = release;
      return { error: null, value };
    } catch (e) {
      return { error: (e as Error).message };
    }
  });
  ipcMain.handle('miner:download', async () => {
    if (MOCK) return 'mock 모드에서는 내려받지 않습니다';
    if (!release) return '먼저 최신 릴리스를 확인해 주세요';
    try {
      const dir = await installRelease(release, file('miners'), settings.minerExe);
      return applyPatch({ minerDir: dir });
    } catch (e) {
      return `설치 실패: ${(e as Error).message}`;
    }
  });
  ipcMain.handle('miner:detectMapping', () => detectMapping());
  ipcMain.handle('power:register', async () => {
    if (MOCK) return 'mock 모드에서는 예약 작업을 등록하지 않습니다';
    try {
      writeJson(file('power-limits.json'), buildLimitsJson(settings.gpus));
      const resources = app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources');
      await registerPowerTask(resources, file('power-limits.json'), `${process.env.USERDOMAIN}\\${process.env.USERNAME}`);
      powerRegistered = await isPowerTaskRegistered();
      await sleep(4000);
      powerLog = readPowerLog();
      return powerRegistered ? null : '등록 확인 실패';
    } catch (e) {
      return `등록 실패(UAC 취소 포함): ${(e as Error).message}`;
    }
  });
  ipcMain.handle('power:apply', async () => {
    if (MOCK) return 'mock 모드에서는 전력 제한을 적용하지 않습니다';
    writeJson(file('power-limits.json'), buildLimitsJson(settings.gpus));
    if (!powerRegistered) return '먼저 "예약 작업 등록(UAC)"을 1회 실행해 주세요';
    try {
      await runPowerTask();
      await sleep(4000);
      powerLog = readPowerLog();
      return null;
    } catch (e) {
      return `적용 실패: ${(e as Error).message}`;
    }
  });
}

function applyLoginItem(): void {
  if (process.platform === 'win32' && app.isPackaged) {
    app.setLoginItemSettings({ openAtLogin: settings.openAtLogin, args: ['--hidden'] });
  }
}

// ---------- 시작 ----------

function loadState(): void {
  settings = mergeSettings(DEFAULT_SETTINGS, readJson<Partial<Settings>>(file('settings.json'), {}));
  ledger = { ...emptyLedger(), ...readJson<Partial<Ledger>>(file('ledger.json'), {}) };
  runtime = { wantRunning: false, selection: [], ourPid: null, currentIds: [], excluded: {}, ...readJson<Partial<Runtime>>(file('runtime.json'), {}) };
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
      powerRegistered = await isPowerTaskRegistered();
      powerLog = readPowerLog();
    }

    await poll();
    if (!running && runtime.wantRunning) runtime.wantRunning = false; // 앱 밖에서 정지된 상태를 존중
    if (!running && settings.autoStartMining && settings.selected.length && !launchBlocker()) {
      const err = await startMining(settings.selected);
      if (err) pushAlert({ ts: Date.now(), level: 'warn', code: 'autostart_failed', message: `자동 시작 실패: ${err}` });
    }

    let polling = false;
    setInterval(() => {
      if (polling) return;
      polling = true;
      poll().finally(() => (polling = false));
    }, POLL_MS);
    let remoteTick = 0;
    void refreshRemote(true);
    setInterval(() => void refreshRemote(++remoteTick % (VAST_MS / REMOTE_MS) === 0), REMOTE_MS);
    setInterval(() => writeJson(file('ledger.json'), ledger), 60_000);

    if (!process.argv.includes('--hidden')) showWindow();
  });

  app.on('window-all-closed', () => {
    // 트레이 상주: 창을 닫아도 종료하지 않음
  });
  app.on('before-quit', () => {
    quitting = true;
    try {
      writeJson(file('ledger.json'), ledger);
    } catch {
      // 종료 중 저장 실패는 무시
    }
  });
}
