import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateView } from '../shared/types';
import { createUpdateController } from './updater';

function fake(checkImpl: () => Promise<unknown> | null = () => Promise.resolve(null)) {
  const em = new EventEmitter();
  return Object.assign(em, {
    autoDownload: false,
    autoInstallOnAppQuit: true,
    allowPrerelease: true,
    checkForUpdates: vi.fn(checkImpl),
    quitAndInstall: vi.fn(),
  });
}

function setup(u = fake()) {
  const views: UpdateView[] = [];
  const timers: { ms: number; fn: () => void; repeat: boolean }[] = [];
  const c = createUpdateController(u, {
    initialDelayMs: 30_000,
    intervalMs: 6 * 3600_000,
    onChange: (v) => views.push(v),
    setTimeout: (fn, ms) => timers.push({ fn, ms, repeat: false }),
    setInterval: (fn, ms) => timers.push({ fn, ms, repeat: true }),
    now: () => 42,
  });
  return { u, c, views, timers };
}

describe('update controller', () => {
  it('configures download-only behaviour (no install on quit, no prerelease)', () => {
    const { u, timers } = setup();
    expect(u.autoDownload).toBe(true);
    expect(u.autoInstallOnAppQuit).toBe(false);
    expect(u.allowPrerelease).toBe(false);
    expect(timers.map((t) => [t.ms, t.repeat])).toEqual([[30_000, false], [6 * 3600_000, true]]);
  });

  it('tracks check → download → ready and installs only when ready', () => {
    const { u, c } = setup();
    expect(c.install()).toBe(false);
    u.emit('checking-for-update');
    u.emit('update-available', { version: '0.2.0' });
    u.emit('download-progress', { percent: 41.6 });
    expect(c.view()).toMatchObject({ status: 'downloading', version: '0.2.0', progressPct: 42 });
    u.emit('update-downloaded', { version: '0.2.0' });
    expect(c.view()).toMatchObject({ status: 'ready', version: '0.2.0' });
    expect(c.install()).toBe(true);
    expect(u.quitAndInstall).toHaveBeenCalledWith(true, true);
  });

  it('turns errors into state instead of throwing', async () => {
    const { c } = setup(fake(() => Promise.reject(new Error('net::ERR_INTERNET_DISCONNECTED'))));
    await expect(c.check()).resolves.toBeUndefined();
    expect(c.view()).toMatchObject({ status: 'error', error: 'net::ERR_INTERNET_DISCONNECTED', checkedAt: 42 });
  });

  it('does not re-check while an update is downloading or ready', async () => {
    const { u, c } = setup();
    u.emit('update-downloaded', { version: '0.2.0' });
    await c.check();
    expect(u.checkForUpdates).not.toHaveBeenCalled();
  });

  it('scheduled timers call check', async () => {
    const { u, timers } = setup();
    timers[0].fn();
    await Promise.resolve();
    expect(u.checkForUpdates).toHaveBeenCalledTimes(1);
  });
});
