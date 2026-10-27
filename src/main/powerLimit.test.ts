import { describe, expect, it } from 'vitest';
import { newGpu } from './config';
import { buildLimitsJson, buildRegisterCommand, followNvidiaLimits, validateWatts } from './powerLimit';

const decode = (b64: string) => Buffer.from(b64, 'base64').toString('utf16le');

const A = '00000000:01:00.0';
const B = '00000000:0D:00.0';
const live = (busId: string, powerLimitW: number | null, powerDefaultW: number | null = 600) => ({ busId, powerLimitW, powerDefaultW });

describe('followNvidiaLimits (NVIDIA is the source of truth)', () => {
  it('adopts a limit already set on the card when Crypthy first sees it', () => {
    const r = followNvidiaLimits([newGpu(A, '5090'), { ...newGpu(B, '5080'), powerLimitW: 280 }], [live(A, 480), live(B, 300, 360)], {});
    expect(r.gpus.map((g) => g.powerLimitW)).toEqual([480, 300]);
    expect(r.changed).toBe(true);
    expect(r.seen).toEqual({ [A]: 480, [B]: 300 });
  });

  it('keeps the saved target when the card is at its default (reboot or driver reset, not a user choice)', () => {
    const r = followNvidiaLimits([{ ...newGpu(A, '5090'), powerLimitW: 480 }], [live(A, 600)], {});
    expect(r.gpus[0].powerLimitW).toBe(480);
    expect(r.changed).toBe(false);
  });

  it('adopts a change made outside Crypthy while it runs (e.g. nvidia-smi -pl)', () => {
    const r = followNvidiaLimits([{ ...newGpu(A, '5090'), powerLimitW: 400 }], [live(A, 450)], { [A]: 400 });
    expect(r.gpus[0].powerLimitW).toBe(450);
    expect(r.changed).toBe(true);
  });

  it('does not overwrite a target the user typed but has not applied yet', () => {
    const r = followNvidiaLimits([{ ...newGpu(A, '5090'), powerLimitW: 400 }], [live(A, 480)], { [A]: 480 });
    expect(r.gpus[0].powerLimitW).toBe(400);
    expect(r.changed).toBe(false);
  });

  it('ignores a drop back to the default value', () => {
    const r = followNvidiaLimits([{ ...newGpu(A, '5090'), powerLimitW: 480 }], [live(A, 600)], { [A]: 480 });
    expect(r.gpus[0].powerLimitW).toBe(480);
    expect(r.changed).toBe(false);
  });

  it('without a known default, only adopts values that changed while watching', () => {
    const first = followNvidiaLimits([newGpu(A, '5090')], [live(A, 480, null)], {});
    expect(first.gpus[0].powerLimitW).toBeNull();
    const next = followNvidiaLimits(first.gpus, [live(A, 450, null)], first.seen);
    expect(next.gpus[0].powerLimitW).toBe(450);
  });

  it('leaves GPUs that are not reported untouched and ignores unreadable limits', () => {
    const gpus = [{ ...newGpu(A, '5090'), powerLimitW: 480 }, { ...newGpu(B, '5080'), powerLimitW: 300 }];
    const r = followNvidiaLimits(gpus, [live(A, null)], { [A]: 480 });
    expect(r.gpus).toEqual(gpus);
    expect(r.changed).toBe(false);
  });

  it('does not adopt a value the settings form would reject (keeps every later save working)', () => {
    const r = followNvidiaLimits([newGpu(A, 'GTX 1650')], [{ ...live(A, 60, 75), powerMinW: 50, powerMaxW: 75 }], {});
    expect(r.gpus[0].powerLimitW).toBeNull();
    expect(r.changed).toBe(false);
    expect(r.seen).toEqual({ [A]: 60 });
  });

  it('rounds fractional nvidia-smi values to whole watts', () => {
    const r = followNvidiaLimits([newGpu(A, '5090')], [live(A, 479.98)], {});
    expect(r.gpus[0].powerLimitW).toBe(480);
  });
});

describe('power limit', () => {
  it('writes bus-id keyed limits and skips GPUs without a target', () => {
    const gpus = [{ ...newGpu('00000000:01:00.0', 'A'), powerLimitW: 450 }, newGpu('00000000:10:00.0', 'B')];
    expect(buildLimitsJson(gpus)).toEqual({ limits: [{ gpu: '00000000:01:00.0', watts: 450 }] });
  });

  it('leaves out GPUs that are no longer installed (a card moved to another slot gets a new bus id)', () => {
    const gpus = [{ ...newGpu('00000000:10:00.0', 'old 5080'), powerLimitW: 280 }, { ...newGpu(B, '5080'), powerLimitW: 300 }];
    expect(buildLimitsJson(gpus, new Set([A, B]))).toEqual({ limits: [{ gpu: B, watts: 300 }] });
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
