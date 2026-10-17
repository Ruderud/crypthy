import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { matchSrbDevice, parseSrbStatus } from './srbminer';

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
  it('matches by PCI bus only', () => {
    expect(matchSrbDevice(devices, 16)?.id).toBe(2);
    expect(matchSrbDevice(devices, 99)).toBeUndefined();
    expect(matchSrbDevice(devices, null)).toBeUndefined();
  });
});
