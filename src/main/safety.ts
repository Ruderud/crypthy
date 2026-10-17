import type { Alert, GpuId, SafetyConfig } from '../shared/types';

export interface SafetySample {
  id: GpuId;
  label: string;
  powerW: number | null;
  fanPct: number | null;
  tempC: number | null;
  /** 현재 채굴에 쓰이는 GPU인지 (센서 끊김 규칙에만 사용) */
  mining: boolean;
}

export interface GpuSafetyState {
  fanZeroSince: number | null;
  tempWarned: boolean;
  /** 온도 값이 없는 연속 샘플 수 (온도 규칙이 최종 안전장치라 온도만 끊겨도 센다) */
  blindCount: number;
}

export type SafetyState = Record<GpuId, GpuSafetyState>;

export interface SafetyResult {
  state: SafetyState;
  /** 채굴에서 제외할 GPU (이미 제외된 GPU는 다시 내보내지 않음) */
  exclude: { id: GpuId; reason: string }[];
  alerts: Alert[];
}

const WARN_HYSTERESIS_C = 3;
/** 2초 폴링 × 5 = 약 10초 동안 온도 값이 없으면 채굴 중인 GPU를 제외 */
export const BLIND_SAMPLES = 5;

/**
 * 순수 함수: 샘플 1회분을 평가한다.
 * - 전력 > fanStopPowerW 이고 팬 0% 가 fanStopSeconds 이상 → 제외 + critical
 *   (값이 비는 샘플은 타이머를 유지만 하고, 팬 > 0 또는 전력 ≤ 기준이 확인될 때만 리셋)
 * - 온도 ≥ tempStopC → 제외 + critical
 * - 온도 ≥ tempWarnC → warn (tempWarnC − 3°C 아래로 내려가면 재무장)
 * - 채굴 중인데 온도 값이 BLIND_SAMPLES 회 연속 없음 → 제외 + critical (감시 불가 상태로 채굴하지 않음)
 */
export function evaluateSafety(
  samples: SafetySample[],
  prev: SafetyState,
  cfg: SafetyConfig,
  excluded: ReadonlySet<GpuId>,
  now: number,
): SafetyResult {
  const state: SafetyState = {};
  const exclude: SafetyResult['exclude'] = [];
  const alerts: Alert[] = [];

  for (const s of samples) {
    const p = prev[s.id] ?? { fanZeroSince: null, tempWarned: false, blindCount: 0 };
    const g: GpuSafetyState = { ...p };
    const out = (code: string, reason: string) => {
      if (excluded.has(s.id) || exclude.some((e) => e.id === s.id)) return;
      exclude.push({ id: s.id, reason });
      alerts.push({ ts: now, level: 'critical', code, gpu: s.id, message: `${s.label} 위험 감지: ${reason}` });
    };

    // 팬 정지
    const fanZeroHot = s.fanPct === 0 && s.powerW !== null && s.powerW > cfg.fanStopPowerW;
    const fanOk = (s.fanPct !== null && s.fanPct > 0) || (s.powerW !== null && s.powerW <= cfg.fanStopPowerW);
    if (fanZeroHot) g.fanZeroSince = p.fanZeroSince ?? now;
    else if (fanOk) g.fanZeroSince = null;
    if (fanZeroHot && g.fanZeroSince !== null && now - g.fanZeroSince >= cfg.fanStopSeconds * 1000) {
      out('fan_stopped', `팬 0% · ${Math.round(s.powerW ?? 0)}W 상태 ${cfg.fanStopSeconds}초 이상`);
    }

    // 온도
    if (s.tempC !== null) {
      if (s.tempC >= cfg.tempStopC) out('temp_stop', `온도 ${s.tempC}°C ≥ ${cfg.tempStopC}°C`);
      if (s.tempC >= cfg.tempWarnC && !g.tempWarned) {
        g.tempWarned = true;
        alerts.push({ ts: now, level: 'warn', code: 'temp_warn', gpu: s.id, message: `${s.label} 온도 ${s.tempC}°C (경고 ${cfg.tempWarnC}°C)` });
      } else if (s.tempC < cfg.tempWarnC - WARN_HYSTERESIS_C) {
        g.tempWarned = false;
      }
    }

    // 센서 끊김
    const blind = s.tempC === null;
    g.blindCount = blind ? p.blindCount + 1 : 0;
    if (blind && s.mining && g.blindCount >= BLIND_SAMPLES) out('telemetry_lost', `온도 값 ${BLIND_SAMPLES}회 연속 없음`);

    state[s.id] = g;
  }
  return { state, exclude, alerts };
}
