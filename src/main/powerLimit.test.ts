import { describe, expect, it } from 'vitest';
import { newGpu } from './config';
import { buildLimitsJson, buildRegisterCommand, validateWatts } from './powerLimit';

const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf16le');

describe('power limit', () => {
  it('writes bus-id keyed limits and skips GPUs without a target', () => {
    const gpus = [{ ...newGpu('00000000:01:00.0', 'A'), powerLimitW: 450 }, newGpu('00000000:10:00.0', 'B')];
    expect(buildLimitsJson(gpus)).toEqual({ limits: [{ gpu: '00000000:01:00.0', watts: 450 }] });
  });

  it('validates watts against GPU min/max', () => {
    expect(validateWatts(280)).toBeNull();
    expect(validateWatts(null)).toBeNull();
    expect(validateWatts(280, 250, 400)).toBeNull();
    expect(validateWatts(240, 250, 400)).toMatch(/250~400/);
    for (const bad of [99, 1001, 280.5, '280']) expect(validateWatts(bad)).not.toBeNull();
  });

  it('wraps register script in RunAs with escaped single quotes', () => {
    const args = buildRegisterCommand("C:\\Program Files\\App\\ps\\register-power-task.ps1", "C:\\Users\\o'neil\\cfg.json", 'PC\\user');
    expect(args.slice(0, 3)).toEqual(['-NoProfile', '-NonInteractive', '-EncodedCommand']);
    const outer = decode(args[3]);
    expect(outer).toContain('-Verb RunAs');
    const inner = decode(/'-EncodedCommand','([^']+)'/.exec(outer)![1]);
    expect(inner).toBe("& 'C:\\Program Files\\App\\ps\\register-power-task.ps1' -ConfigPath 'C:\\Users\\o''neil\\cfg.json' -User 'PC\\user'");
  });

  it('refuses double quotes, newlines and unicode single quotes in paths', () => {
    for (const bad of ['a"b', 'a\nb', 'C:\\Users\\o\u2019neil']) expect(() => buildRegisterCommand(bad, 'c', 'd')).toThrow();
  });
});
