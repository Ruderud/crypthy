import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { parseNvsmiCsv, parsePciBus } from './nvsmi';

describe('parseNvsmiCsv', () => {
  it('parses dual GPU output (CRLF)', () => {
    const gpus = parseNvsmiCsv(readFileSync(path.join(__dirname, 'fixtures/nvsmi.csv'), 'utf8'));
    expect(gpus).toHaveLength(2);
    expect(gpus[0]).toEqual({
      index: 0, name: 'NVIDIA GeForce RTX 5090', busId: '00000000:01:00.0', bus: 1,
      tempC: 63, fanPct: 72, powerW: 588.12, powerLimitW: 600, powerMinW: 400, powerMaxW: 600, utilPct: 100,
    });
    expect(gpus[1]).toMatchObject({ busId: '00000000:10:00.0', bus: 16, powerLimitW: 280, powerMaxW: 400 });
  });

  it('maps [N/A] / [Not Supported] to null and skips junk lines', () => {
    const gpus = parseNvsmiCsv('0, RTX, 00000000:01:00.0, 40, [N/A], [Not Supported], 600.00, [N/A], [N/A], 0\n\ngarbage\n1, X, notabus, 1, 1, 1, 1, 1, 1, 1\n');
    expect(gpus).toHaveLength(1);
    expect(gpus[0].fanPct).toBeNull();
    expect(gpus[0].powerW).toBeNull();
    expect(gpus[0].powerMinW).toBeNull();
  });

  it('parsePciBus handles hex bus ids', () => {
    expect(parsePciBus('00000000:10:00.0')).toBe(16);
    expect(parsePciBus('0000:01:00.0')).toBe(1);
    expect(parsePciBus('bad')).toBeNull();
  });
});
