import type { Alert, ProfitConfig } from '../shared/types';

export interface PoolStats {
  /** 네트워크 해시레이트 (H/s) */
  netHashrate: number;
  /** 블록 보상 (PRL) */
  blockReward: number;
  blockTimeS: number;
  /** 풀 수수료 비율 (PPS+ 0.03 = 3%) */
  fee: number;
}

/** PPS 기준 기대 채굴량(PRL/h) = 내 해시 / 네트워크 해시 × 블록보상 × 시간당 블록 수 × (1 − 수수료) */
export function prlPerHour(hashrate: number, pool: PoolStats): number {
  if (pool.netHashrate <= 0 || pool.blockTimeS <= 0) return 0;
  return (hashrate / pool.netHashrate) * pool.blockReward * (3600 / pool.blockTimeS) * (1 - pool.fee);
}

export function powerCostKrwPerHour(watts: number, krwPerKwh: number): number {
  return (watts / 1000) * krwPerKwh;
}

export function miningNetKrwPerHour(
  hashrate: number,
  powerW: number,
  prlUsd: number,
  pool: PoolStats,
  cfg: Pick<ProfitConfig, 'krwPerKwh' | 'krwPerUsd'>,
): number {
  return prlPerHour(hashrate, pool) * prlUsd * cfg.krwPerUsd - powerCostKrwPerHour(powerW, cfg.krwPerKwh);
}

/** 대여 순수익(원/h) = 표시가 × 호스트 몫(75%) × 환율 − 임대 중 GPU 전력비 */
export function rentalNetKrwPerHour(
  displayUsd: number,
  cfg: Pick<ProfitConfig, 'vastHostShare' | 'rentalPowerW' | 'krwPerKwh' | 'krwPerUsd'>,
): number {
  return displayUsd * cfg.vastHostShare * cfg.krwPerUsd - powerCostKrwPerHour(cfg.rentalPowerW, cfg.krwPerKwh);
}

export interface ReviewRow {
  id: string;
  label: string;
  rentalUsd: number | null;
  reviewRentalUsd: number;
  miningKrwPerH: number | null;
  rentalKrwPerH: number | null;
}

/** 재검토 알림: GPU별 대여가 기준 이상 / 대여 순수익 > 채굴 순수익, PRL 시세 기준 대비 하락 */
export function reviewAlerts(
  rows: ReviewRow[],
  prlUsd: number | null,
  cfg: Pick<ProfitConfig, 'reviewPrlDropPct' | 'baselinePrlUsd'>,
  now: number,
): Alert[] {
  const alerts: Alert[] = [];
  for (const r of rows) {
    if (r.rentalUsd !== null && r.reviewRentalUsd > 0 && r.rentalUsd >= r.reviewRentalUsd) {
      alerts.push({ ts: now, level: 'info', code: 'review_rental_price', gpu: r.id, message: `${r.label} 대여 표시가 $${r.rentalUsd.toFixed(3)}/h ≥ $${r.reviewRentalUsd} — 채굴/대여 재검토` });
    }
    if (r.miningKrwPerH !== null && r.rentalKrwPerH !== null && r.rentalKrwPerH > r.miningKrwPerH) {
      alerts.push({ ts: now, level: 'info', code: 'review_rental_better', gpu: r.id, message: `${r.label} 대여 순수익 ${Math.round(r.rentalKrwPerH)}원/h > 채굴 ${Math.round(r.miningKrwPerH)}원/h — 재검토` });
    }
  }
  if (prlUsd !== null && cfg.baselinePrlUsd > 0) {
    const dropPct = (1 - prlUsd / cfg.baselinePrlUsd) * 100;
    if (dropPct >= cfg.reviewPrlDropPct) {
      alerts.push({ ts: now, level: 'info', code: 'review_prl', message: `PRL 시세 기준 대비 −${dropPct.toFixed(1)}% ($${prlUsd} / 기준 $${cfg.baselinePrlUsd}) — 재검토` });
    }
  }
  return alerts;
}

// ---- 일/월 누적 장부 (로컬 날짜 기준) ----

export interface DayEntry {
  prl: number;
  kwh: number;
}

export interface Ledger {
  /** 마지막으로 기록한 (미지급 잔액 + 지금까지 본 지급 합계). 줄어들어도 내리지 않는다(high-water mark) */
  lastTotal: number | null;
  /** 지금까지 본 지급액 누적 합계 */
  paidTotal: number;
  seenPayouts: string[];
  days: Record<string, DayEntry>;
}

export interface Payout {
  key: string;
  amount: number;
}

const KEEP_DAYS = 62;
const KEEP_PAYOUT_KEYS = 300;

export const emptyLedger = (): Ledger => ({ lastTotal: null, paidTotal: 0, seenPayouts: [], days: {} });

export function dateKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function day(l: Ledger, now: number): DayEntry {
  const k = dateKey(now);
  l.days[k] ??= { prl: 0, kwh: 0 };
  return l.days[k];
}

function prune(l: Ledger): void {
  const keys = Object.keys(l.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete l.days[k];
  if (l.seenPayouts.length > KEEP_PAYOUT_KEYS) l.seenPayouts = l.seenPayouts.slice(-KEEP_PAYOUT_KEYS);
}

/**
 * 풀 잔액·지급 내역 조회 1회분을 장부에 반영한다(새 장부 반환).
 * total = 미지급 잔액 + 지금까지 본 지급 합계. total 이 이전 최고치보다 커진 만큼만 채굴량으로 기록한다.
 * (지급으로 잔액이 먼저 줄고 지급 내역은 나중에 보이는 경우에도 이중 계상하지 않음)
 * 첫 조회는 기준점만 잡는다.
 */
export function recordEarnings(prev: Ledger, balance: number, payouts: Payout[], now: number): Ledger {
  const l: Ledger = structuredClone(prev);
  const seen = new Set(l.seenPayouts);
  const fresh = payouts.filter((p) => !seen.has(p.key));
  l.paidTotal += fresh.reduce((s, p) => s + p.amount, 0);
  l.seenPayouts.push(...fresh.map((p) => p.key));
  const total = balance + l.paidTotal;
  if (l.lastTotal === null) l.lastTotal = total;
  else if (total > l.lastTotal) {
    day(l, now).prl += total - l.lastTotal;
    l.lastTotal = total;
  }
  prune(l);
  return l;
}

/** 실측 GPU 전력(W)을 dtMs 동안 사용한 것으로 누적 */
export function recordEnergy(prev: Ledger, watts: number, dtMs: number, now: number): Ledger {
  if (!(watts > 0) || !(dtMs > 0)) return prev;
  const l: Ledger = structuredClone(prev);
  day(l, now).kwh += (watts * dtMs) / 3_600_000 / 1000;
  prune(l);
  return l;
}

export function summarize(l: Ledger, now: number): { todayPrl: number; monthPrl: number; todayKwh: number; monthKwh: number } {
  const today = dateKey(now);
  const month = today.slice(0, 7);
  let monthPrl = 0;
  let monthKwh = 0;
  for (const [k, v] of Object.entries(l.days)) {
    if (k.startsWith(month)) {
      monthPrl += v.prl;
      monthKwh += v.kwh;
    }
  }
  return { todayPrl: l.days[today]?.prl ?? 0, monthPrl, todayKwh: l.days[today]?.kwh ?? 0, monthKwh };
}

export function netKrw(prl: number, kwh: number, prlUsd: number, cfg: Pick<ProfitConfig, 'krwPerKwh' | 'krwPerUsd'>): number {
  return prl * prlUsd * cfg.krwPerUsd - kwh * cfg.krwPerKwh;
}
