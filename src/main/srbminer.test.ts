import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { learnSrbIds, matchSrbDevice, parseSrbStatus } from './srbminer';

const fixture = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/srbminer-api.json'), 'utf8'));

describe('parseSrbStatus', () => {
  it('parses pool, shares, per-device hashrate', () => {
    const s = parseSrbStatus(fixture);
    expect(s).toMatchObject({ uptimeS: 5321, algorithm: 'pearlhash', pool: 'prl-hk.kryptex.network:8048', latencyMs: 38, accepted: 410, rejected: 2, totalHashrate: 580e12 });
    expect(s.devices.map((d) => [d.id, d.bus, d.hashrate, d.fanPct, d.powerW])).toEqual([
      [1, 1, 354e12, 72, 588],
      [2, 16, 226e12, 65, 279],
    ]);
  });

  it('tolerates empty / unexpected payloads', () => {
    for (const bad of [null, 'x', [], {}, { algorithms: 'x', gpu_devices: [1, null] }]) {
      const s = parseSrbStatus(bad);
      expect(s.devices).toEqual([]);
      expect(s.accepted).toBeNull();
    }
  });
});

describe('matchSrbDevice', () => {
  const { devices } = parseSrbStatus(fixture);
  it('uses PCI bus when the API reports it, ignoring a wrong srbId', () => {
    expect(matchSrbDevice(devices, 16, 1)?.id).toBe(2);
    expect(matchSrbDevice(devices, 99, 1)).toBeUndefined();
  });
  it('falls back to srbId only when the API has no bus info', () => {
    const noBus = devices.map((d) => ({ ...d, bus: null }));
    expect(matchSrbDevice(noBus, 16, 1)?.id).toBe(1);
    expect(matchSrbDevice(noBus, null, null)).toBeUndefined();
  });
});

describe('learnSrbIds', () => {
  const { devices } = parseSrbStatus(fixture);
  const bus: Record<string, number> = { a: 1, b: 16, c: 42 };
  it('maps by bus and reports only changes', () => {
    const gpus = [{ id: 'a', srbId: null }, { id: 'b', srbId: 0 }, { id: 'c', srbId: 5 }];
    expect(learnSrbIds(gpus, (id) => bus[id] ?? null, devices)).toEqual([
      { id: 'a', from: null, to: 1 },
      { id: 'b', from: 0, to: 2 },
    ]);
    expect(learnSrbIds([{ id: 'a', srbId: 1 }], (id) => bus[id] ?? null, devices)).toEqual([]);
  });
});
