// Electron 셸: 창·트레이·OS 알림·대화상자·자동 업데이트. 상태와 동작은 core.ts 가 맡는다.
import { app, BrowserWindow, dialog, ipcMain, Menu, Notification, nativeImage, safeStorage, shell, Tray } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import type { Alert, AppState, ChartsView, RemoteSettingsView, Settings } from '../shared/types';
import * as core from './core';
import { setLinuxAutostart } from './autostart';
import { readJson, writeJson } from './config';
import { createFileLogger, type Logger } from './log';
import { createRemoteClient, normalizeRemoteUrl, postWithConfirm, type RemoteTarget } from './remoteClient';
import { startStatusServer } from './statusApi';
import { createNotificationKeeper, updateToast } from './updatePrompt';
import { createUpdateController, DISABLED_UPDATE, mockUpdater, type UpdaterLike } from './updater';

const APP_NAME = 'Crypthy';
const MOCK = process.env.CRYPTHY_MOCK === '1';
const IS_LINUX = process.platform === 'linux';
/** 창이 뜬 뒤 몇 초 안에 첫 확인 */
const UPDATE_FIRST_CHECK_MS = 5_000;
/** 사용자가 직접 확인한 직후에는 OS 알림 없이 배너만 */
const MANUAL_CHECK_MS = 60_000;

const file = (name: string) => path.join(app.getPath('userData'), name);
/** %APPDATA%\Crypthy\logs\main.log (업데이트·종료 과정 기록) */
let log: Logger = { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined };

let win: BrowserWindow | null = null;
let tray: Tray | null = null;
let quitting = false;
let trayKey = '';
let updater: ReturnType<typeof createUpdateController> | null = null;
let statusServer: import('node:http').Server | null = null;
/** OS 알림 참조 유지 (Windows 에서 GC 되면 클릭이 사라짐) */
const notifications = createNotificationKeeper();
let manualCheckUntil = 0;

function notify(a: Alert): void {
  if (!Notification.isSupported()) return;
  notifications.show(new Notification({ title: a.level === 'critical' ? `${APP_NAME} 안전 경고` : APP_NAME, body: a.message }), showWindow);
}

// ---------- 원격 호스트 (헤드리스 Crypthy 화면 보기) ----------
//
// 원격 연결 중에는 화면·트레이가 원격 호스트의 상태를 보여 주고, 켜기·끄기·설정 등은 원격 호스트로 보낸다.
// 토큰은 이 메인 프로세스만 갖는다(화면에 넘기지 않음). 저장은 OS 보안 저장소(safeStorage)로 암호화한다.

interface RemoteSaved {
  url: string;
  enabled: boolean;
  read: string | null;
  write: string | null;
  /** read·write 가 safeStorage 로 암호화된 base64 인지 */
  enc: boolean;
}

const REMOTE_POLL_MS = 2000;
const remoteFile = () => file('remote-client.json');
let remoteSaved: RemoteSaved = { url: '', enabled: false, read: null, write: null, enc: false };
let remote: { target: RemoteTarget; client: ReturnType<typeof createRemoteClient> } | null = null;
let remoteState: AppState | null = null;
let remoteError: string | null = null;
let remoteAt: number | null = null;
let remoteTimer: NodeJS.Timeout | null = null;
let remoteCharts: ChartsView | null = null;

const canEncrypt = () => {
  try {
    return safeStorage.isEncryptionAvailable();
  } catch {
    return false;
  }
};
const seal = (v: string | null, enc: boolean) => (v === null ? null : enc ? safeStorage.encryptString(v).toString('base64') : v);
const unseal = (v: string | null, enc: boolean) => (v === null ? null : enc ? safeStorage.decryptString(Buffer.from(v, 'base64')) : v);

function saveRemote(): void {
  writeJson(remoteFile(), remoteSaved);
  try {
    fs.chmodSync(remoteFile(), 0o600);
  } catch {
    // Windows 는 사용자 프로필 폴더 권한을 따른다
  }
}

function startRemote(target: RemoteTarget): void {
  stopRemote();
  remote = { target, client: createRemoteClient(target) };
  remoteError = null;
  const tick = async () => {
    const r = remote;
    if (!r) return;
    try {
      remoteState = await r.client.state();
      remoteAt = Date.now();
      remoteError = null;
    } catch (e) {
      remoteError = (e as Error).message;
    }
    broadcast();
  };
  void tick();
  remoteTimer = setInterval(() => void tick(), REMOTE_POLL_MS);
}

function stopRemote(): void {
  if (remoteTimer) clearInterval(remoteTimer);
  remoteTimer = null;
  remote = null;
  remoteState = null;
  remoteCharts = null;
  remoteError = null;
  remoteAt = null;
}

function loadRemote(): void {
  const raw = readJson<Partial<RemoteSaved>>(remoteFile(), {});
  remoteSaved = { url: typeof raw.url === 'string' ? raw.url : '', enabled: raw.enabled === true, read: raw.read ?? null, write: raw.write ?? null, enc: raw.enc === true };
  if (!remoteSaved.enabled || !remoteSaved.url || !remoteSaved.read) return;
  try {
    startRemote({ url: remoteSaved.url, readToken: unseal(remoteSaved.read, remoteSaved.enc)!, writeToken: unseal(remoteSaved.write, remoteSaved.enc) });
  } catch (e) {
    log.warn(`remote: cannot read saved tokens: ${(e as Error).message}`);
  }
}

/** 원격 호스트에 연결 (주소·토큰을 먼저 확인하고 저장). 빈 토큰은 저장된 값을 다시 쓴다 */
async function connectRemote(urlRaw: unknown, readRaw: unknown, writeRaw: unknown): Promise<string | null> {
  const url = normalizeRemoteUrl(String(urlRaw ?? ''));
  if (!url) return '주소는 100.x.y.z:47321 처럼 IP(또는 호스트 이름)와 포트만 입력하세요';
  const same = url === remoteSaved.url;
  const savedRead = same ? unseal(remoteSaved.read, remoteSaved.enc) : null;
  const savedWrite = same ? unseal(remoteSaved.write, remoteSaved.enc) : null;
  const readToken = String(readRaw ?? '').trim() || savedRead;
  const writeToken = String(writeRaw ?? '').trim() || savedWrite;
  if (!readToken) return '읽기 토큰을 입력하세요 (호스트에서 crypthy-headless --print-tokens)';
  const target: RemoteTarget = { url, readToken, writeToken: writeToken || null };
  try {
    await createRemoteClient(target).state();
  } catch (e) {
    return `연결 실패: ${(e as Error).message}`;
  }
  const enc = canEncrypt();
  remoteSaved = { url, enabled: true, read: seal(readToken, enc), write: seal(target.writeToken, enc), enc };
  saveRemote();
  log.info(`remote: connected to ${url} (${target.writeToken ? 'read + write' : 'read-only'})`);
  startRemote(target);
  return null;
}

function disconnectRemote(): void {
  remoteSaved.enabled = false;
  saveRemote();
  stopRemote();
  log.info('remote: back to this PC');
  broadcast();
}

const remoteSettingsView = (): RemoteSettingsView => ({
  url: remoteSaved.url,
  enabled: !!remote,
  hasRead: !!remoteSaved.read,
  hasWrite: !!remoteSaved.write,
  encrypted: remoteSaved.enc,
});

/** 화면·트레이에 보낼 상태: 원격 연결 중이면 원격 상태(업데이트·버전은 이 PC 앱 기준) */
function currentState(): AppState {
  const local = core.buildState();
  if (!remote) return { ...local, remote: null };
  const view = { url: remote.target.url, write: !!remote.target.writeToken, at: remoteAt, error: remoteError, version: remoteState?.appVersion ?? null };
  return remoteState ? { ...remoteState, update: local.update, appVersion: local.appVersion, remote: view } : { ...local, remote: view };
}

const LOCAL_ONLY = '원격 호스트에 연결된 동안에는 쓸 수 없는 기능입니다 (이 PC 로 돌아간 뒤 사용하세요)';

/** 원격 연결 중이면 원격 호스트로, 아니면 이 PC 코어로 */
function routed<A extends unknown[]>(local: (...a: A) => unknown, path: string, body: (...a: A) => Record<string, unknown>) {
  return (_e: unknown, ...a: A) => (remote ? postWithConfirm(remote.client, path, body(...a), dialogConfirm).finally(broadcast) : local(...a));
}

function broadcast(): void {
  const st = currentState();
  if (win && !win.isDestroyed() && win.isVisible()) win.webContents.send('state', st);
  updateTray(st);
}

// ---------- 대화상자 (켜기·끄기 확인) ----------

const parentWin = () => (win && !win.isDestroyed() && win.isVisible() ? win : null);
async function ask(opts: Electron.MessageBoxOptions): Promise<Electron.MessageBoxReturnValue> {
  const w = parentWin();
  return w ? dialog.showMessageBox(w, opts) : dialog.showMessageBox(opts);
}

/** 코어가 요청한 확인을 대화상자로 받는다 (원격 호스트를 조작할 때도 같은 대화상자) */
export const dialogConfirm: core.Confirm = async (kind, detail) => {
  if (kind === 'consent') {
    const r = await ask({
      type: 'warning',
      title: '채굴 위험·비용 고지',
      message: '채굴을 켜기 전에 확인해 주세요',
      detail,
      checkboxLabel: '위 내용을 이해했고 내 책임으로 채굴합니다',
      buttons: ['동의하고 켜기', '취소'],
      defaultId: 1,
      cancelId: 1,
      noLink: true,
    });
    return r.response === 0 && r.checkboxChecked;
  }
  if (kind === 'danger') {
    const r = await ask({ type: 'warning', title: '최근 위험 정지', message: '최근에 위험 조건으로 채굴기를 정지했습니다', detail, buttons: ['그래도 켜기', '취소'], defaultId: 1, cancelId: 1, noLink: true });
    return r.response === 0;
  }
  const r = await ask({ type: 'question', title: APP_NAME, message: detail, buttons: ['끄기', '취소'], defaultId: 0, cancelId: 1, noLink: true });
  return r.response === 0;
};

// ---------- 창·트레이 ----------

const iconPath = () => path.join(__dirname, '..', 'icon.png');

function showWindow(): void {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    // 숨겨져 있는 동안에는 상태를 보내지 않으므로, 다시 보일 때 바로 최신 상태를 보낸다
    win.webContents.send('state', currentState());
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
  const key = `${st.remote?.url ?? ''}|${status}|${u.status}|${u.version}|${u.prompt}|${ctl.mode}|${ctl.canStart}|${ctl.canStop}`;
  if (key === trayKey) return;
  trayKey = key;
  const updateItem =
    u.status === 'disabled'
      ? []
      : u.prompt || u.status === 'ready' || u.status === 'available'
        ? [{ label: u.status === 'ready' ? `업데이트 v${u.version} 설치 준비됨…` : `새 버전 v${u.version} 있음…`, click: focusUpdateBanner }]
        : [{ label: '업데이트 확인', click: () => { showWindow(); void checkUpdateNow(); } }];
  const control = (fn: (c: core.Confirm) => Promise<string | null>, path: string) => () =>
    void (remote ? postWithConfirm(remote.client, path, {}, dialogConfirm) : fn(dialogConfirm)).then(
      (e) => e && e !== '취소됨' && core.pushAlert({ ts: Date.now(), level: 'warn', code: 'miner_control', message: e }),
    );
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: st.remote ? `원격 ${st.remote.url.replace(/^https?:\/\//, '')} · ${status}` : status, enabled: false },
      { type: 'separator' },
      { label: '대시보드 열기', click: showWindow },
      ...(ctl.mode === 'none'
        ? []
        : [
            { label: '채굴 켜기', enabled: ctl.canStart, click: control(core.startMining, '/v1/miner/start') },
            { label: '채굴 끄기', enabled: ctl.canStop, click: control(core.stopMining, '/v1/miner/stop') },
          ]),
      ...updateItem,
      { type: 'separator' },
      { label: '종료', click: () => { quitting = true; app.quit(); } },
    ]),
  );
}

// ---------- 자동 업데이트 ----------

/** 설치형(Windows NSIS) 과 Linux AppImage 에서만 자동 업데이트 (deb·zip 은 수동). 실패해도 안전 감시와 무관 */
function startUpdater(): void {
  const mockUpdate = MOCK && process.env.CRYPTHY_MOCK_UPDATE === '1';
  const supported = process.platform === 'win32' || (IS_LINUX && !!process.env.APPIMAGE);
  if (!mockUpdate && (MOCK || !app.isPackaged || !supported)) return;
  try {
    const source: UpdaterLike = mockUpdate ? mockUpdater() : (require('electron-updater') as typeof import('electron-updater')).autoUpdater;
    source.logger = log;
    let lastStatus = '';
    updater = createUpdateController(source, {
      initialDelayMs: UPDATE_FIRST_CHECK_MS,
      intervalMin: core.currentSettings().updateIntervalMin,
      onChange: (v) => {
        if (v.status !== lastStatus) log.info(`update: ${v.status}${v.version ? ` v${v.version}` : ''}${v.error ? ` — ${v.error}` : ''}`);
        if (v.status === 'error' && lastStatus !== 'error') {
          core.alertOnce({ ts: Date.now(), level: 'info', code: 'update_error', message: `업데이트 확인 실패: ${v.error}` }, 6 * 3600_000);
        }
        lastStatus = v.status;
        broadcast();
      },
      // 새 안내가 뜰 때 OS 알림 (트레이에만 있어도 보이도록). 클릭하면 창을 연다
      onPrompt: (v) => {
        const message = v.prompt === 'ready'
          ? `v${v.version} 를 받아 두었습니다. 재시작하면 설치됩니다 — 채굴은 계속됩니다`
          : `새 버전 v${v.version} 이 있습니다. 앱에서 받기 / 나중에 를 고르세요`;
        core.pushAlert({ ts: Date.now(), level: 'info', code: v.prompt === 'ready' ? 'update_ready' : 'update_available', message }, false);
        // 창이 보이면 배너만(중복 방지). 트레이에만 있을 때 1번 알리고, 누르면 창을 열어 배너로 데려간다
        const toast = updateToast(v, { windowVisible: windowVisible(), manual: Date.now() < manualCheckUntil });
        if (toast && Notification.isSupported()) notifications.show(new Notification(toast), focusUpdateBanner);
      },
    });
  } catch (e) {
    core.pushAlert({ ts: Date.now(), level: 'info', code: 'update_error', message: `자동 업데이트 초기화 실패: ${(e as Error).message}` }, false);
  }
}

const windowVisible = () => !!win && !win.isDestroyed() && win.isVisible() && !win.isMinimized();

/** 창을 열고 맨 위의 업데이트 배너로 스크롤해 강조한다 (OS 알림·트레이에서) */
function focusUpdateBanner(): void {
  showWindow();
  const w = win;
  if (!w || w.isDestroyed()) return;
  const send = () => w.webContents.send('update:focus');
  if (w.webContents.isLoading()) w.webContents.once('did-finish-load', send);
  else send();
}

/** 사용자가 직접 확인(앱 상단·트레이): 결과는 배너로만 보여 준다 */
async function checkUpdateNow(): Promise<void> {
  if (!updater) return;
  manualCheckUntil = Date.now() + MANUAL_CHECK_MS;
  await updater.checkNow();
  broadcast();
}

/** 받아 둔 업데이트 설치 (사용자가 누를 때만). 채굴기는 앱과 별도 프로세스라 계속 돈다 */
function installUpdate(): string | null {
  if (!updater || updater.view().status !== 'ready') return '설치할 업데이트가 없습니다';
  core.saveAll(true);
  log.info('update: install requested', updater.view().version);
  prepareForInstall();
  // 정리한 다음 틱에 설치 (electron-updater 는 설치 파일을 띄운 뒤 app.quit 을 부른다)
  const u = updater;
  setImmediate(() => {
    try {
      u.install();
    } catch (e) {
      log.error('update: quitAndInstall threw', e);
      app.exit(0);
    }
  });
  return null;
}

/**
 * 설치 파일이 앱 폴더를 바꾸기 전에 이 앱이 붙잡고 있는 것을 모두 놓는다.
 * 트레이 상주 앱은 창 close·window-all-closed 를 막아 두므로 그대로 두면 종료가 늦어지고,
 * 설치 파일이 아직 살아 있는 앱을 강제 종료하면서 파일 교체가 실패할 수 있다.
 */
function prepareForInstall(): void {
  quitting = true;
  core.stopCore();
  statusServer?.close();
  statusServer = null;
  stopRemote();
  tray?.destroy();
  tray = null;
  app.removeAllListeners('window-all-closed');
  for (const w of BrowserWindow.getAllWindows()) {
    w.removeAllListeners('close');
    w.destroy();
  }
  win = null;
  log.info('update: app resources released, handing over to the installer');
}

// ---------- IPC ----------

function registerIpc(): void {
  ipcMain.handle('state:get', () => currentState());
  ipcMain.handle('charts:get', async () => {
    if (!remote) return core.chartsView();
    try {
      remoteCharts = await remote.client.charts();
    } catch (e) {
      log.warn(`remote charts: ${(e as Error).message}`);
    }
    return remoteCharts ?? { gpus: [], price: [], daily: [], pnl: [], symbol: currentState().profit.symbol };
  });
  ipcMain.handle('pnl:sale', routed((raw) => core.addSaleRecord(raw as never), '/v1/pnl/sale', (raw) => ({ sale: raw })));
  ipcMain.handle('pnl:bootstrap', routed((fromMs, watts) => core.backfillPnl(fromMs, watts), '/v1/pnl/backfill', (fromMs, watts) => ({ fromMs, watts })));
  ipcMain.handle('pnl:export', async () => {
    if (remote) return LOCAL_ONLY;
    const r = await dialog.showOpenDialog({ title: 'CSV 저장 폴더 선택', properties: ['openDirectory', 'createDirectory'] });
    if (r.canceled || !r.filePaths[0]) return '취소됨';
    core.exportPnlCsv(r.filePaths[0]);
    return null;
  });
  ipcMain.handle('pnl:openFolder', async () => {
    if (!remote) await shell.openPath(core.pnlFolder());
  });
  ipcMain.handle('safety:clearHold', routed((id) => core.clearHold(String(id)), '/v1/holds/clear', (id) => ({ id: String(id) })));
  ipcMain.handle('miner:start', routed(() => core.startMining(dialogConfirm), '/v1/miner/start', () => ({})));
  ipcMain.handle('miner:stop', routed(() => core.stopMining(dialogConfirm), '/v1/miner/stop', () => ({})));
  ipcMain.handle('miner:importTask', () => (remote ? LOCAL_ONLY : core.importMinerTask()));
  ipcMain.handle('settings:save', routed((patch) => core.saveSettingsPatch(patch as Partial<Settings>), '/v1/settings', (patch) => ({ patch })));
  ipcMain.handle('setup:importBat', async () => {
    if (remote) return LOCAL_ONLY;
    const r = await dialog.showOpenDialog({ title: '기존 채굴기 실행 bat 선택', properties: ['openFile'], filters: [{ name: 'Batch', extensions: ['bat', 'cmd'] }] });
    if (r.canceled || !r.filePaths[0]) return '취소됨';
    return core.importBatText(fs.readFileSync(r.filePaths[0], 'utf8'));
  });
  // 카탈로그에 있는 저장소·출처 링크만 기본 브라우저로 연다
  ipcMain.handle('hub:openLink', async (_e, url: unknown) => {
    if (core.isAllowedLink(url)) await shell.openExternal(url);
  });
  ipcMain.handle('update:check', () => checkUpdateNow());
  ipcMain.handle('update:download', () => updater?.download());
  ipcMain.handle('update:dismiss', () => updater?.dismiss());
  ipcMain.handle('update:install', () => installUpdate());
  ipcMain.handle('power:register', () => (remote ? LOCAL_ONLY : core.registerPowerLimits()));
  ipcMain.handle('power:apply', () => (remote ? LOCAL_ONLY : core.applyPowerLimits()));
  ipcMain.handle('remote:get', () => remoteSettingsView());
  ipcMain.handle('remote:connect', (_e, url: unknown, read: unknown, write: unknown) => connectRemote(url, read, write));
  ipcMain.handle('remote:disconnect', () => disconnectRemote());
}

function applyLoginItem(s: Settings): void {
  if (!app.isPackaged || MOCK) return;
  if (process.platform === 'win32') app.setLoginItemSettings({ openAtLogin: s.openAtLogin, args: ['--hidden'] });
  else if (IS_LINUX) {
    try {
      setLinuxAutostart(s.openAtLogin);
    } catch (e) {
      core.pushAlert({ ts: Date.now(), level: 'warn', code: 'autostart_failed', message: `자동 실행 설정 실패: ${(e as Error).message}` });
    }
  }
}

// ---------- 시작 ----------

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    app.setAppUserModelId('io.github.ruderud.crypthy');
    log = createFileLogger(file(path.join('logs', 'main.log')));
    log.info(`start v${app.getVersion()} ${process.platform} ${process.arch}${process.argv.includes('--updated') ? ' (after update)' : ''}${MOCK ? ' (mock)' : ''}`);
    process.on('uncaughtException', (e) => log.error('uncaughtException', e));
    process.on('unhandledRejection', (e) => log.error('unhandledRejection', e));
    registerIpc();

    await core.initCore({
      dataDir: app.getPath('userData'),
      version: app.getVersion(),
      resourcesDir: app.isPackaged ? process.resourcesPath : path.join(app.getAppPath(), 'resources'),
      log,
      notify,
      onChange: broadcast,
      updateView: () => updater?.view() ?? DISABLED_UPDATE,
      onSettings: (s) => {
        applyLoginItem(s);
        updater?.setIntervalMin(s.updateIntervalMin);
      },
    });
    applyLoginItem(core.currentSettings());
    loadRemote();
    tray = new Tray(nativeImage.createFromPath(iconPath()).resize({ width: 16, height: 16 }));
    tray.on('click', showWindow);
    tray.on('double-click', showWindow);
    broadcast();
    statusServer = startStatusServer(core.buildState, (e) => core.pushAlert({ ts: Date.now(), level: 'warn', code: 'status_api', message: `로컬 상태 API 시작 실패: ${e.message}` }));

    if (!process.argv.includes('--hidden')) showWindow();
    startUpdater();
  });

  app.on('window-all-closed', () => {
    // 트레이 상주: 창을 닫아도 종료하지 않음
  });
  app.on('before-quit', () => {
    quitting = true;
    log.info('quit');
    core.saveAll(true);
  });
}
