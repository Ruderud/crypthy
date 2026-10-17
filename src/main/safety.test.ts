import { describe, expect, it } from 'vitest';
import { BLIND_SAMPLES, evaluateSafety, type SafetySample, type SafetyState } from './safety';

const cfg = { fanStopPowerW: 100, fanStopSeconds: 10, tempWarnC: 80, tempStopC: 85 };
const none = new Set<string>();
const s = (o: Partial<SafetySample>): SafetySample => ({ id: 'gpuB', label: 'GPU B', powerW: 280, fanPct: 60, tempC: 68, mining: true, ...o });

/** 2초 간격으로 샘플 함수를 평가 */
function runFor(sample: (t: number) => SafetySample, seconds: number, excluded = none) {
  let state: SafetyState = {};
  const out = [];
  for (let t = 0; t <= seconds * 1000; t += 2000) {
    const r = evaluateSafety([sample(t)], state, cfg, excluded, t);
    state = r.state;
    out.push(r);
  }
  return out;
}

describe('fan stop rule', () => {
  it('excludes GPU after fan 0% with >100W for 10s, not before', () => {
    const rs = runFor(() => s({ fanPct: 0 }), 10);
    expect(rs.slice(0, -1).every((r) => r.exclude.length === 0)).toBe(true);
    const last = rs.at(-1)!;
    expect(last.exclude).toEqual([{ id: 'gpuB', reason: expect.stringContaining('팬 0%') }]);
    expect(last.alerts[0]).toMatchObject({ level: 'critical', code: 'fan_stopped', gpu: 'gpuB' });
  });

  it('resets the timer only when fan spins again', () => {
    let state: SafetyState = {};
    state = evaluateSafety([s({ fanPct: 0 })], state, cfg, none, 0).state;
    state = evaluateSafety([s({ fanPct: 30 })], state, cfg, none, 6000).state;
    const r = evaluateSafety([s({ fanPct: 0 })], state, cfg, none, 11_000);
    expect(r.exclude).toEqual([]);
    expect(r.state.gpuB.fanZeroSince).toBe(11_000);
  });

  it('keeps the timer across missing samples (nvidia-smi timeout / N/A)', () => {
    // 4초에 값이 비어도 0초부터 센 타이머가 유지되어 10초에 제외
    const rs = runFor((t) => (t === 4000 ? s({ fanPct: null, powerW: null }) : s({ fanPct: 0 })), 10);
    expect(rs.at(-1)!.exclude.map((e) => e.id)).toEqual(['gpuB']);
  });

  it('ignores fan 0% at low power (idle zero-RPM mode) and null fan', () => {
    expect(runFor(() => s({ fanPct: 0, powerW: 40 }), 30).every((r) => r.exclude.length === 0)).toBe(true);
    expect(runFor(() => s({ fanPct: null }), 30).every((r) => r.exclude.length === 0)).toBe(true);
  });

  it('does not re-emit for an already excluded GPU', () => {
    const rs = runFor(() => s({ fanPct: 0, tempC: 90 }), 20, new Set(['gpuB']));
    expect(rs.every((r) => r.exclude.length === 0 && r.alerts.every((a) => a.code === 'temp_warn'))).toBe(true);
  });
});

describe('temperature rules', () => {
  it('warns once at 80°C and re-arms below 77°C', () => {
    let state: SafetyState = {};
    const at = (tempC: number, t: number) => {
      const r = evaluateSafety([s({ tempC })], state, cfg, none, t);
      state = r.state;
      return r.alerts.map((a) => a.code);
    };
    expect(at(80, 0)).toEqual(['temp_warn']);
    expect(at(81, 2000)).toEqual([]);
    expect(at(78, 4000)).toEqual([]);
    expect(at(80, 6000)).toEqual([]);
    expect(at(76, 8000)).toEqual([]);
    expect(at(80, 10_000)).toEqual(['temp_warn']);
  });

  it('excludes at 85°C', () => {
    const r = evaluateSafety([s({ id: 'gpuA', tempC: 85 })], {}, cfg, none, 0);
    expect(r.exclude).toEqual([{ id: 'gpuA', reason: expect.stringContaining('85°C') }]);
    expect(r.alerts.map((a) => a.code).sort()).toEqual(['temp_stop', 'temp_warn']);
  });

  it('emits a single exclusion when fan and temp trip together', () => {
    const state: SafetyState = evaluateSafety([s({ fanPct: 0, tempC: 70 })], {}, cfg, none, 0).state;
    const r = evaluateSafety([s({ fanPct: 0, tempC: 86 })], state, cfg, none, 10_000);
    expect(r.exclude).toHaveLength(1);
  });

  it('evaluates GPUs independently', () => {
    const r = evaluateSafety([s({ id: 'gpuA', tempC: 64 }), s({ id: 'gpuB', tempC: 90 })], {}, cfg, none, 0);
    expect(r.exclude.map((e) => e.id)).toEqual(['gpuB']);
  });
});

describe('telemetry lost', () => {
  const blind = (mining: boolean) => () => s({ tempC: null, fanPct: null, powerW: null, mining });

  it(`excludes a mining GPU after ${BLIND_SAMPLES} samples with no sensor values`, () => {
    const rs = runFor(blind(true), (BLIND_SAMPLES - 1) * 2);
    expect(rs.slice(0, -1).every((r) => r.exclude.length === 0)).toBe(true);
    expect(rs.at(-1)!.alerts[0]).toMatchObject({ code: 'telemetry_lost', level: 'critical' });
  });

  it('counts temperature-only loss (fan/power still reported)', () => {
    const rs = runFor(() => s({ tempC: null }), (BLIND_SAMPLES - 1) * 2);
    expect(rs.at(-1)!.exclude.map((e) => e.id)).toEqual(['gpuB']);
  });

  it('ignores idle GPUs and resets when values come back', () => {
    expect(runFor(blind(false), 30).every((r) => r.exclude.length === 0)).toBe(true);
    const rs = runFor((t) => (t === 4000 ? s({}) : blind(true)()), (BLIND_SAMPLES - 1) * 2);
    expect(rs.every((r) => r.exclude.length === 0)).toBe(true);
  });
});
