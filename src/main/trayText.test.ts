import { describe, expect, it } from 'vitest';
import type { AppState } from '../shared/types';
import { trayTooltip } from './trayText';

const st = (p: Record<string, unknown> = {}) =>
  ({
    remote: null,
    miner: { running: true },
    gpus: [
      { present: true, mining: true, hold: null, label: 'NVIDIA GeForce RTX 5090', tempC: 66 },
      { present: true, mining: true, hold: null, label: 'NVIDIA GeForce RTX 5080', tempC: 61 },
    ],
    profit: { liveKrwPerH: 640.4 },
    pnl: { today: { netKrw: 11820, revenueKrw: 12000, unpriced: 0, estimated: false } },
    ...p,
  }) as unknown as AppState;

describe('tray tooltip', () => {
  it('shows mining state, live and today net profit, and temperatures', () => {
    expect(trayTooltip(st())).toBe('Crypthy · 채굴 중 2/2 GPU\n₩640/h · 오늘 ₩11,820\n5090 66°C / 5080 61°C');
  });

  it('marks holds, losses, estimates and remote; stays within 127 characters', () => {
    const t = trayTooltip(st({
      remote: { url: 'http://100.1.2.3:47321' },
      gpus: [{ present: true, mining: false, hold: '팬 정지', label: 'NVIDIA GeForce RTX 5090', tempC: 81 }],
      profit: { liveKrwPerH: -120 },
      pnl: { today: { netKrw: -300, revenueKrw: 10, unpriced: 0, estimated: true } },
    }));
    expect(t).toBe('Crypthy · 원격 · 위험 보류\n-₩120/h · 오늘 -₩300(추정)\n5090 81°C 보류');
    expect(trayTooltip(st({ profit: { liveKrwPerH: 500, supported: false, today: { estNetKrw: 5721 } } })).split('\n')[1]).toBe('₩500/h · 오늘 ₩5,721(추정)');
    const many = trayTooltip(st({ gpus: Array.from({ length: 12 }, (_, i) => ({ present: true, mining: true, hold: null, label: `GPU ${i} long name`, tempC: 60 })) }));
    expect(many.length).toBeLessThanOrEqual(127);
  });
});
