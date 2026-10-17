// 자동 업데이트 (electron-updater, GitHub Releases).
// - 앱 시작 직후 1회 + 설정한 주기(기본 1시간)마다 확인. 수동 확인도 가능
// - 새 버전을 찾으면 바로 안내(받기/나중에). 받아 두면 다시 안내(재시작해 설치/나중에)
// - "나중에" 는 같은 버전·같은 단계 안내를 다음 정기 확인까지 숨긴다 (수동 확인하면 바로 다시 보임)
// - 설치(재시작)는 사용자가 누를 때만. 앱 종료 시 자동 설치·강제 재시작 없음
// - 실패는 상태로만 알리고 안전 감시에는 영향을 주지 않는다
import type { UpdateView } from '../shared/types';

/** electron-updater 의 autoUpdater 중 여기서 쓰는 부분 (테스트에서 가짜로 대체) */
export interface UpdaterLike {
  autoDownload: boolean;
  autoInstallOnAppQuit: boolean;
  allowPrerelease: boolean;
  on(event: string, listener: (...args: any[]) => void): unknown;
  checkForUpdates(): Promise<unknown> | null;
  downloadUpdate(): Promise<unknown>;
  quitAndInstall(isSilent?: boolean, isForceRunAfter?: boolean): void;
}

export interface UpdateOptions {
  initialDelayMs: number;
  intervalMin: number;
  onChange(view: UpdateView): void;
  /** 안내가 새로 떠야 할 때 (OS 알림용). 같은 버전·단계는 정기 확인 주기마다 최대 1번 */
  onPrompt?(view: UpdateView): void;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  setInterval?: (fn: () => void, ms: number) => unknown;
  clearInterval?: (handle: unknown) => void;
  now?: () => number;
}

export const MIN_INTERVAL_MIN = 30;
export const MAX_INTERVAL_MIN = 24 * 60;
export const clampInterval = (min: number) =>
  Number.isFinite(min) ? Math.min(MAX_INTERVAL_MIN, Math.max(MIN_INTERVAL_MIN, Math.round(min))) : 60;

export const DISABLED_UPDATE: UpdateView = {
  status: 'disabled', version: null, notes: null, progressPct: null, error: null, checkedAt: null, prompt: null, intervalMin: 60,
};

/** 릴리스 노트(HTML 문자열 또는 [{version, note}]) → 짧은 텍스트 */
export function summarizeNotes(notes: unknown, max = 600): string | null {
  const raw = Array.isArray(notes) ? notes.map((n) => (n && typeof n === 'object' ? String((n as { note?: unknown }).note ?? '') : '')).join('\n') : typeof notes === 'string' ? notes : '';
  const text = raw
    .replace(/<\/(p|li|h\d|div)>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '• ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .split('\n').map((l) => l.trim()).filter(Boolean).join('\n');
  if (!text) return null;
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function createUpdateController(u: UpdaterLike, opts: UpdateOptions) {
  const now = opts.now ?? Date.now;
  const setT = opts.setTimeout ?? setTimeout;
  const setI = opts.setInterval ?? setInterval;
  const clearI = opts.clearInterval ?? ((h: unknown) => clearInterval(h as NodeJS.Timeout));
  let intervalMin = clampInterval(opts.intervalMin);
  let view: UpdateView = { ...DISABLED_UPDATE, status: 'idle', intervalMin };
  /** "나중에" 누른 안내 (버전·단계) */
  let dismissed: string | null = null;
  /** 이번 정기 주기에 이미 OS 알림을 보낸 안내 */
  let notified: string | null = null;

  const key = (v: UpdateView) => (v.prompt ? `${v.prompt}:${v.version}` : null);

  function set(patch: Partial<UpdateView>) {
    const next = { ...view, ...patch, intervalMin };
    const want = next.status === 'available' || next.status === 'ready' ? next.status : null;
    next.prompt = want && `${want}:${next.version}` !== dismissed ? want : null;
    view = next;
    opts.onChange(view);
    const k = key(view);
    if (k && k !== notified) {
      notified = k;
      opts.onPrompt?.(view);
    }
  }

  u.autoDownload = false; // 받기 전에 사용자에게 먼저 알린다
  u.autoInstallOnAppQuit = false;
  u.allowPrerelease = false;

  u.on('checking-for-update', () => set({ status: view.status === 'ready' ? 'ready' : 'checking', error: null }));
  u.on('update-available', (info: { version?: string; releaseNotes?: unknown }) => {
    if (view.status === 'ready' || view.status === 'downloading') return;
    set({ status: 'available', version: info?.version ?? null, notes: summarizeNotes(info?.releaseNotes), progressPct: null, checkedAt: now() });
  });
  u.on('update-not-available', () => set({ status: 'idle', version: null, notes: null, checkedAt: now() }));
  u.on('download-progress', (p: { percent?: number }) => set({ status: 'downloading', progressPct: Math.round(p?.percent ?? 0) }));
  u.on('update-downloaded', (info: { version?: string; releaseNotes?: unknown }) =>
    set({ status: 'ready', version: info?.version ?? view.version, notes: summarizeNotes(info?.releaseNotes) ?? view.notes, progressPct: 100, checkedAt: now() }),
  );
  u.on('error', (e: Error) => set({ status: view.status === 'ready' ? 'ready' : 'error', error: String(e?.message ?? e).slice(0, 200), checkedAt: now() }));

  async function check(): Promise<void> {
    if (view.status === 'ready' || view.status === 'downloading') {
      set({}); // 받아 둔 업데이트는 다시 확인하지 않고 안내만 갱신
      return;
    }
    try {
      await u.checkForUpdates();
    } catch (e) {
      set({ status: 'error', error: String((e as Error)?.message ?? e).slice(0, 200), checkedAt: now() });
    }
  }

  /** 정기 확인: "나중에" 숨김과 알림 기록을 풀고 다시 확인 → 같은 버전도 다시 안내 */
  function tick(): Promise<void> {
    dismissed = null;
    notified = null;
    return check();
  }

  let timer: unknown = null;
  function schedule() {
    if (timer !== null) clearI(timer);
    timer = setI(() => void tick(), intervalMin * 60_000);
  }
  setT(() => void tick(), opts.initialDelayMs);
  schedule();

  return {
    view: () => view,
    /** 수동 확인 (사용자가 버튼을 누름): 숨김을 풀고 바로 확인 */
    checkNow: tick,
    async download(): Promise<void> {
      if (view.status !== 'available') return;
      set({ status: 'downloading', progressPct: 0 });
      try {
        await u.downloadUpdate();
      } catch (e) {
        set({ status: 'error', error: String((e as Error)?.message ?? e).slice(0, 200) });
      }
    },
    /** "나중에": 지금 안내 중인 버전·단계를 다음 정기 확인까지 숨긴다 */
    dismiss(): void {
      const k = key(view);
      if (k) {
        dismissed = k;
        set({});
      }
    },
    setIntervalMin(min: number): void {
      const next = clampInterval(min);
      if (next === intervalMin) return;
      intervalMin = next;
      schedule();
      set({});
    },
    /** 받아 둔 업데이트를 조용히 설치하고 앱을 다시 실행 (채굴기 프로세스는 앱과 분리되어 계속 돈다) */
    install(): boolean {
      if (view.status !== 'ready') return false;
      u.quitAndInstall(true, true);
      return true;
    },
  };
}

/** 모의 모드 전용(CRYPTHY_MOCK_UPDATE=1): 0.9.9 업데이트가 있는 가짜 서버 */
export function mockUpdater(): UpdaterLike {
  // eslint 없이 쓰는 최소 이벤트 구현
  const listeners = new Map<string, ((...a: any[]) => void)[]>();
  const emit = (ev: string, ...a: any[]) => (listeners.get(ev) ?? []).forEach((l) => l(...a));
  return {
    autoDownload: false,
    autoInstallOnAppQuit: false,
    allowPrerelease: false,
    on(ev, l) {
      listeners.set(ev, [...(listeners.get(ev) ?? []), l]);
      return this;
    },
    async checkForUpdates() {
      emit('checking-for-update');
      emit('update-available', { version: '0.9.9', releaseNotes: '<ul><li>모의 업데이트: 차트 개선</li><li>안전 감시 문구 수정</li></ul>' });
      return null;
    },
    async downloadUpdate() {
      for (const p of [20, 55, 90]) {
        await new Promise((r) => setTimeout(r, 300));
        emit('download-progress', { percent: p });
      }
      emit('update-downloaded', { version: '0.9.9' });
      return [];
    },
    quitAndInstall() {
      emit('error', new Error('mock: 설치는 실제 빌드에서만 동작합니다'));
    },
  };
}
