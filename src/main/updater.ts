// 자동 업데이트 (electron-updater, GitHub Releases).
// - 시작 후 잠시 뒤 + 주기적으로 확인, 새 버전은 백그라운드 다운로드(latest.yml 의 sha512 로 무결성 검증)
// - 설치는 사용자가 누를 때만 (강제 재시작 없음). 앱 종료 시 자동 설치도 끔
// - 업데이트 실패는 상태로만 알리고 채굴·안전 감시에는 영향을 주지 않는다
import type { UpdateView } from '../shared/types';

/** electron-updater 의 autoUpdater 중 여기서 쓰는 부분 (테스트에서 가짜로 대체) */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown> | null;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateOptions {
  initialDelayMs: number;
  intervalMs: number;
  onChange(view: UpdateView): void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  setInterval?: (fn: () => void, ms: number) => unknown;
  now?: () => number;
}

export const DISABLED_UPDATE: UpdateView = { status: 'disabled', version: null, progressPct: null, error: null, checkedAt: null };

export function createUpdateController(u: UpdaterLike, opts: UpdateOptions) {
  const now = opts.now ?? Date.now;
  let view: UpdateView = { status: 'idle', version: null, progressPct: null, error: null, checkedAt: null };
  const set = (patch: Partial<UpdateView>) => {
    view = { ...view, ...patch };
    opts.onChange(view);
  };

  u.autoDownload = true;
  u.autoInstallOnAppQuit = false;
  u.allowPrerelease = false;

  u.on('checking-for-update', () => set({ status: 'checking', error: null }));
  u.on('update-available', (info: { version?: string }) => set({ status: 'downloading', version: info?.version ?? null, progressPct: 0 }));
  u.on('update-not-available', () => set({ status: 'idle', checkedAt: now() }));
  u.on('download-progress', (p: { percent?: number }) => set({ status: 'downloading', progressPct: Math.round(p?.percent ?? 0) }));
  u.on('update-downloaded', (info: { version?: string }) => set({ status: 'ready', version: info?.version ?? view.version, progressPct: 100, checkedAt: now() }));
  u.on('error', (e: Error) => set({ status: 'error', error: String(e?.message ?? e).slice(0, 200), checkedAt: now() }));

  async function check(): Promise<void> {
    // 이미 받아 둔 업데이트가 있으면 다시 확인하지 않는다
    if (view.status === 'ready' || view.status === 'downloading') return;
    try {
      await u.checkForUpdates();
    } catch (e) {
      set({ status: 'error', error: String((e as Error)?.message ?? e).slice(0, 200), checkedAt: now() });
    }
  }

  (opts.setTimeout ?? setTimeout)(() => void check(), opts.initialDelayMs);
  (opts.setInterval ?? setInterval)(() => void check(), opts.intervalMs);

  return {
    view: () => view,
    check,
    /** 받아 둔 업데이트를 조용히 설치하고 앱을 다시 실행 (채굴기 프로세스는 앱과 분리되어 계속 돈다) */
    install(): boolean {
      if (view.status !== 'ready') return false;
      u.quitAndInstall(true, true);
      return true;
    },
  };
}
