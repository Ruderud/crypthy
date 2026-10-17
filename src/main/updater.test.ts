import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateView } from '../shared/types';
import { clampInterval, createUpdateController, summarizeNotes } from './updater';

function fake(onCheck?: (em: EventEmitter) => void) {
  const em = new EventEmitter();
  return Object.assign(em, {
    autoDownload: true,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    checkForUpdates: vi.fn(async () => {
      onCheck?.(em);
      return null;
    }),
    downloadUpdate: vi.fn(async () => {
      em.emit('download-progress', { percent: 50 });
      em.emit('update-downloaded', { version: '0.4.0' });
      return [];
    }),
    quitAndInstall: vi.fn(),
  });
}

/** 새 버전(0.4.0)이 있는 서버 */
const withUpdate = () => fake((em) => em.emit('update-available', { version: '0.4.0', releaseNotes: '<ul><li>fix A</li><li>fix B</li></ul>' }));

function setup(u = withUpdate(), intervalMin = 60) {
  const prompts: UpdateView[] = [];
  const timers: { id: number; ms: number; fn: () => void; repeat: boolean; cleared?: boolean }[] = [];
  let id = 0;
  const c = createUpdateController(u, {
    initialDelayMs: 3000,
    intervalMin,
    onChange: () => undefined,
    onPrompt: (v) => prompts.push(v),
    setTimeout: (fn, ms) => timers.push({ id: ++id, fn, ms, repeat: false }),
    setInterval: (fn, ms) => (timers.push({ id: ++id, fn, ms, repeat: true }), id),
    clearInterval: (h) => {
      const t = timers.find((x) => x.id === h);
      if (t) t.cleared = true;
    },
    now: () => 42,
  });
  const live = () => timers.filter((t) => t.repeat && !t.cleared);
  const fire = async (t: { fn: () => void }) => {
    t.fn();
    await new Promise((r) => setTimeout(r, 0));
  };
  return { u, c, prompts, timers, live, fire };
}

describe('schedule', () => {
  it('checks shortly after launch, then every interval (default 1h); asks before downloading', async () => {
    const { u, timers, live, fire, c } = setup();
    expect(u.autoDownload).toBe(false);
    expect(u.autoInstallOnAppQuit).toBe(false);
    expect(timers[0]).toMatchObject({ ms: 3000, repeat: false });
    expect(live().map((t) => t.ms)).toEqual([3_600_000]);
    await fire(timers[0]);
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(c.view()).toMatchObject({ status: 'available', version: '0.4.0', prompt: 'available', notes: '• fix A\n• fix B' });
    expect(u.downloadUpdate).not.toHaveBeenCalled();
  });

  it('clamps the interval to 30 min – 24 h and reschedules on change', () => {
    expect([clampInterval(5), clampInterval(90.4), clampInterval(99_999), clampInterval(Number.NaN)]).toEqual([30, 90, 1440, 60]);
    const { c, live } = setup(withUpdate(), 5);
    expect(live().map((t) => t.ms)).toEqual([30 * 60_000]);
    c.setIntervalMin(120);
    expect(live().map((t) => t.ms)).toEqual([120 * 60_000]);
    expect(c.view().intervalMin).toBe(120);
  });
});

describe('prompts and "later"', () => {
  it('notifies once per version/stage per check cycle', async () => {
    const { u, timers, prompts, fire, live } = setup();
    await fire(timers[0]);
    u.emit('update-available', { version: '0.4.0' }); // 같은 주기 안에 같은 이벤트가 또 와도
    expect(prompts.map((p) => p.prompt)).toEqual(['available']);
    await fire(live()[0]); // 다음 정기 확인 → 다시 알림
    expect(prompts.map((p) => p.prompt)).toEqual(['available', 'available']);
  });

  it('"later" hides the same version until the next scheduled check', async () => {
    const { c, timers, fire, live, prompts } = setup();
    await fire(timers[0]);
    c.dismiss();
    expect(c.view().prompt).toBeNull();
    expect(c.view().status).toBe('available');
    await fire(live()[0]);
    expect(c.view().prompt).toBe('available');
    expect(prompts).toHaveLength(2);
  });

  it('a manual check shows a dismissed update again right away', async () => {
    const { c, timers, fire } = setup();
    await fire(timers[0]);
    c.dismiss();
    await c.checkNow();
    expect(c.view().prompt).toBe('available');
  });

  it('download → ready prompt, which can also be postponed; install only on request', async () => {
    const { u, c, timers, fire, live, prompts } = setup();
    await fire(timers[0]);
    await c.download();
    expect(c.view()).toMatchObject({ status: 'ready', prompt: 'ready', version: '0.4.0' });
    expect(prompts.map((p) => p.prompt)).toEqual(['available', 'ready']);
    c.dismiss();
    expect(c.view().prompt).toBeNull();
    expect(u.quitAndInstall).not.toHaveBeenCalled();
    await fire(live()[0]); // 정기 확인: 받아 둔 업데이트는 다시 받지 않고 안내만 다시
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1);
    expect(c.view().prompt).toBe('ready');
    expect(c.install()).toBe(true);
    expect(u.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('no update → no prompt; errors become state, never throw', async () => {
    const quiet = setup(fake((em) => em.emit('update-not-available', {})));
    await quiet.fire(quiet.timers[0]);
    expect(quiet.c.view()).toMatchObject({ status: 'idle', prompt: null });
    expect(quiet.prompts).toEqual([]);

    const broken = fake();
    broken.checkForUpdates = vi.fn(async () => {
      throw new Error('net::ERR_INTERNET_DISCONNECTED');
    });
    const b = setup(broken);
    await b.fire(b.timers[0]);
    expect(b.c.view()).toMatchObject({ status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED', prompt: null });
  });
});

describe('summarizeNotes', () => {
  it('turns HTML or note arrays into short text', () => {
    expect(summarizeNotes('<h2>Changes</h2><p>a &amp; b</p>')).toBe('Changes\na & b');
    expect(summarizeNotes([{ version: '1', note: '<li>x</li>' }])).toBe('• x');
    expect(summarizeNotes('')).toBeNull();
    expect(summarizeNotes('x'.repeat(1000))!.length).toBe(600);
  });
});
