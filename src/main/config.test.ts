import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, mergeSettings, newGpu, shortName } from './config';

describe('defaults', () => {
  it('ship no personal values', () => {
    expect(DEFAULT_SETTINGS.wallet).toBe('');
    expect(DEFAULT_SETTINGS.pool).toBe('');
    expect(DEFAULT_SETTINGS.minerDir).toBe('');
    expect(DEFAULT_SETTINGS.gpus).toEqual([]);
    expect(DEFAULT_SETTINGS.consentAt).toBeNull();
    expect(DEFAULT_SETTINGS.autoStartMining).toBe(false);
    expect(DEFAULT_SETTINGS.openAtLogin).toBe(false);
  });
});

describe('mergeSettings', () => {
  it('merges nested objects and GPUs by id, adding new GPUs', () => {
    const base = { ...DEFAULT_SETTINGS, gpus: [newGpu('a', 'A')] };
    const m = mergeSettings(base, { safety: { ...base.safety, tempStopC: 83 }, gpus: [{ ...newGpu('a', 'A2'), srbId: 3 }, newGpu('b', 'B')] });
    expect(m.safety).toEqual({ ...DEFAULT_SETTINGS.safety, tempStopC: 83 });
    expect(m.gpus.map((g) => [g.id, g.label, g.srbId])).toEqual([['a', 'A2', 3], ['b', 'B', null]]);
    expect(m.profit).toEqual(DEFAULT_SETTINGS.profit);
  });
});

describe('shortName', () => {
  it('strips vendor prefixes', () => {
    expect(shortName('NVIDIA GeForce RTX 5090')).toBe('RTX 5090');
    expect(shortName('NVIDIA RTX A6000')).toBe('RTX A6000');
  });
});
