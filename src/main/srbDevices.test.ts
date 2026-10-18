import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseSrbStatus } from './srbminer';
import { mapFromApi, mapFromListed, mergeMap, parseListDevices, resolveGpuIds, srbCacheKey } from './srbDevices';

// RUD: nvidia-smi 0 = RTX 5090 (bus 01 = 1), 1 = RTX 5080 (bus 10 = 16)
const NV_BUSES = [1, 16];

describe('SRBMiner device numbers ↔ cards', () => {
  it('learns the mapping from the stats API (real RUD response: 5090 = id 1, 5080 = id 2)', () => {
    const st = parseSrbStatus(JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/srbminer-api.json'), 'utf8')));
    const map = mapFromApi(st.devices);
    expect(map).toEqual([{ srbId: 1, bus: 1 }, { srbId: 2, bus: 16 }]);
    // 5090 을 끄고 5080 만 → --gpu-id 2 (nvidia-smi 번호 1 이 아니다)
    expect(resolveGpuIds([16], map)).toEqual({ ids: [2] });
  });

  it('reads --list-devices in several shapes (bus as PCI id, hex or decimal)', () => {
    const shapes = [
      'GPU0 : AMD Radeon(TM) Graphics [BUS: 0e] [CU: 2]\nGPU1 : NVIDIA GeForce RTX 5090 [BUS: 01] [MEM: 31.84 GB]\nGPU2 : NVIDIA GeForce RTX 5080 [BUS: 10] [MEM: 15.92 GB]',
      '[1] NVIDIA GeForce RTX 5090 | PCI 0000:01:00.0\n[2] NVIDIA GeForce RTX 5080 | PCI 0000:10:00.0',
      'id: 1 name: RTX 5090 bus_id: 1\nid: 2 name: RTX 5080 bus_id: 16',
      '\x1b[32mGPU1\x1b[0m RTX 5090 BUS 01:00.0\nGPU2 RTX 5080 BUS 10:00.0',
    ];
    for (const text of shapes) {
      expect(mapFromListed(parseListDevices(text), NV_BUSES), text).toEqual([{ srbId: 1, bus: 1 }, { srbId: 2, bus: 16 }]);
    }
  });

  it('ignores lines without a device number or bus, and unknown devices', () => {
    const listed = parseListDevices('SRBMiner-MULTI 3.x\nDetected 3 devices\nGPU0 : AMD iGPU [BUS: 0e]\nnothing here');
    expect(listed).toEqual([{ srbId: 0, buses: [14], line: 'GPU0 : AMD iGPU [BUS: 0e]' }]);
    expect(mapFromListed(listed, NV_BUSES)).toEqual([]);
    expect(parseListDevices('')).toEqual([]);
  });

  it('fails clearly when a chosen card has no SRBMiner number', () => {
    expect(resolveGpuIds([16], [{ srbId: 1, bus: 1 }])).toEqual({ error: 'bus 16 카드의 SRBMiner 장치 번호를 모릅니다' });
  });

  it('cache key changes with the miner, the cards or the driver', () => {
    const cards = [{ busId: '00000000:01:00.0', uuid: 'GPU-a', driver: '580.1' }, { busId: '00000000:10:00.0', uuid: 'GPU-b', driver: '580.1' }];
    const k = srbCacheKey('C:\\Mining\\SRBMiner-MULTI.exe', cards);
    expect(srbCacheKey('c:\\mining\\srbminer-multi.exe', [...cards].reverse())).toBe(k);
    expect(srbCacheKey('C:\\Mining\\SRBMiner-MULTI.exe', cards.map((c) => ({ ...c, driver: '581.0' })))).not.toBe(k);
    expect(srbCacheKey('C:\\Mining\\SRBMiner-MULTI.exe', cards.slice(0, 1))).not.toBe(k);
  });

  it('merging keeps one entry per card and per number', () => {
    expect(mergeMap([{ srbId: 1, bus: 1 }, { srbId: 2, bus: 16 }], [{ srbId: 3, bus: 16 }])).toEqual([{ srbId: 1, bus: 1 }, { srbId: 3, bus: 16 }]);
  });
});
