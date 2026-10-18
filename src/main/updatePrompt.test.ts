import { EventEmitter } from 'node:events';
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateView } from '../shared/types';
import { DISABLED_UPDATE } from './updater';
import { createNotificationKeeper, updateToast } from './updatePrompt';

const fakeNotification = () => Object.assign(new EventEmitter(), { show: vi.fn() });
const view = (o: Partial<UpdateView>): UpdateView => ({ ...DISABLED_UPDATE, status: 'idle', ...o });

describe('notification keeper', () => {
  it('keeps a reference until the notification is clicked, then runs the click handler', () => {
    const k = createNotificationKeeper();
    const n = fakeNotification();
    const onClick = vi.fn();
    k.show(n, onClick);
    expect(n.show).toHaveBeenCalled();
    expect(k.size()).toBe(1); // GC 로 click 이 사라지지 않도록 참조 유지
    n.emit('click');
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(k.size()).toBe(0);
  });

  it('releases closed or failed notifications', () => {
    const k = createNotificationKeeper();
    const a = fakeNotification();
    const b = fakeNotification();
    k.show(a, vi.fn());
    k.show(b, vi.fn());
    a.emit('close');
    b.emit('failed');
    expect(k.size()).toBe(0);
  });
});

describe('update toast (banner is the only place with choices)', () => {
  const avail = view({ status: 'available', version: '0.3.8' });
  const ready = view({ status: 'ready', version: '0.3.8' });

  it('window visible: no toast, the banner alone shows the notice', () => {
    expect(updateToast(avail, { windowVisible: true, manual: false })).toBeNull();
    expect(updateToast(ready, { windowVisible: true, manual: false })).toBeNull();
  });

  it('only in the tray (window hidden): one toast pointing to the in-app notice', () => {
    expect(updateToast(avail, { windowVisible: false, manual: false })?.body).toContain('받기 / 나중에');
    expect(updateToast(ready, { windowVisible: false, manual: false })?.body).toContain('재시작해 설치');
  });

  it('manual check: banner only, no toast', () => {
    expect(updateToast(avail, { windowVisible: false, manual: true })).toBeNull();
  });

  it('nothing to announce while idle, checking, downloading or on error', () => {
    for (const status of ['idle', 'checking', 'downloading', 'error', 'disabled'] as const) expect(updateToast(view({ status }), { windowVisible: false, manual: false })).toBeNull();
  });

  it('no native update dialog remains in the main process', () => {
    const main = fs.readFileSync(path.join(__dirname, 'main.ts'), 'utf8');
    expect(main).not.toMatch(/showUpdateDialog|updateDialogSpec/);
  });
});
