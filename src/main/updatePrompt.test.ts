import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import type { UpdateView } from '../shared/types';
import { DISABLED_UPDATE } from './updater';
import { createNotificationKeeper, updateDialogSpec } from './updatePrompt';

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

describe('update dialog', () => {
  it('offers download / later for an available update, with notes', () => {
    const s = updateDialogSpec(view({ status: 'available', version: '0.3.5', notes: '• fix banner' }), '0.3.4');
    expect(s).toMatchObject({ action: 'download', buttons: ['받기', '나중에'] });
    expect(s!.message).toContain('v0.3.5');
    expect(s!.detail).toContain('• fix banner');
  });

  it('offers restart to install for a downloaded update and says mining continues', () => {
    const s = updateDialogSpec(view({ status: 'ready', version: '0.3.5' }), '0.3.4');
    expect(s).toMatchObject({ action: 'install', buttons: ['지금 재시작해 설치', '나중에'] });
    expect(s!.detail).toContain('채굴은 계속');
  });

  it('nothing to ask while idle, checking, downloading or on error', () => {
    for (const status of ['idle', 'checking', 'downloading', 'error', 'disabled'] as const) expect(updateDialogSpec(view({ status }), '0.3.4')).toBeNull();
  });
});
