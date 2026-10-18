import type { Alert, PeriodView, ProfitConfig } from '../shared/types';

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

// ---- 일/월 누적 장부 (로컬 날짜 기준, v2) ----
//
// 순수익이 음수로 보이던 원인: 풀 확정 채굴량은 잔액이 블록·정산 단위로 띄엄띄엄 늘 때만 기록되는데,
// 전력량은 앱을 켠 순간부터 초 단위로 쌓였다. 그래서 앱 시작 직후·자정 직후에는 전력만 먼저 잡혔다.
// v2 는 두 지표를 나눈다.
//  - 확정(confirmed): 풀 누적(잔액 + 지급)이 늘어난 만큼의 채굴량과, 그 증가가 일어나기까지 쓴 전력(matched)을 짝지어 기록
//  - 추정(estimate): 실측 해시레이트 × 풀 통계 기대 채굴량을, 전력과 같은 시간 동안 누적

export interface DayEntry {
  /** 풀 확정 채굴량 (기준점 이후 증가분) */
  prl: number;
  /** 이 PC GPU 전력량 (전체) */
  kwh: number;
  /** prl 증가와 같은 구간의 전력량·시간 */
  matchedKwh: number;
  matchedMs: number;
  /** 해시레이트 기반 추정 채굴량 (kwh 와 같은 시간에 누적) */
  estPrl: number;
  /** v2 이전 장부에서 옮긴 값. 전력 구간을 맞출 수 없어 순수익 계산에는 쓰지 않는다 */
  legacyPrl?: number;
  legacyKwh?: number;
}

export interface Ledger {
  version: 2;
  /** 마지막으로 기록한 (미지급 잔액 + 지금까지 본 지급 합계). 줄어들어도 내리지 않는다(high-water mark) */
  lastTotal: number | null;
  /** 지금까지 본 지급액 누적 합계 */
  paidTotal: number;
  seenPayouts: string[];
  days: Record<string, DayEntry>;
  /** 마지막 확정 증가 이후 쓴 전력 (다음 증가 때 그 증가분과 짝지음) */
  pendingKwh: number;
  pendingMs: number;
  /** 마지막으로 받은 정상 시세 (시세 조회 실패 시 시각과 함께 사용) */
  lastPrice: { usd: number; at: number } | null;
}

export interface Payout {
  key: string;
  amount: number;
}

const KEEP_DAYS = 62;
const KEEP_PAYOUT_KEYS = 300;
/** 확정 순수익은 짝지은 구간이 이 시간 이상일 때만 보여 준다 (짧은 구간은 정산 간격 때문에 들쭉날쭉) */
export const MIN_MATCHED_MS = 3 * 3_600_000;
/** 이 시간보다 오래된 시세는 "지난 시세" 로 표시 */
export const PRICE_STALE_MS = 30 * 60_000;

export const emptyLedger = (): Ledger => ({
  version: 2, lastTotal: null, paidTotal: 0, seenPayouts: [], days: {}, pendingKwh: 0, pendingMs: 0, lastPrice: null,
});

const emptyDay = (): DayEntry => ({ prl: 0, kwh: 0, matchedKwh: 0, matchedMs: 0, estPrl: 0 });
const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * 저장된 장부를 v2 로 읽는다. v1(0.3.1 이하)의 일별 prl·kwh 는 구간이 맞지 않아 음수를 만들던 값이라
 * legacyPrl·legacyKwh 로 옮기고 순수익 계산에서 뺀다. 풀 누적 기준점(lastTotal·paidTotal)은 유지한다.
 */
export function migrateLedger(raw: unknown): Ledger {
  const l = emptyLedger();
  if (!raw || typeof raw !== 'object') return l;
  const r = raw as Partial<Ledger> & { version?: number };
  l.lastTotal = typeof r.lastTotal === 'number' && Number.isFinite(r.lastTotal) ? r.lastTotal : null;
  l.paidTotal = num(r.paidTotal);
  l.seenPayouts = Array.isArray(r.seenPayouts) ? r.seenPayouts.filter((k) => typeof k === 'string') : [];
  if (r.lastPrice && Number.isFinite(r.lastPrice.usd) && Number.isFinite(r.lastPrice.at)) l.lastPrice = { usd: r.lastPrice.usd, at: r.lastPrice.at };
  const days = r.days && typeof r.days === 'object' ? r.days : {};
  for (const [k, v] of Object.entries(days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !v || typeof v !== 'object') continue;
    const d = v as Partial<DayEntry>;
    if (r.version === 2) {
      l.days[k] = { prl: num(d.prl), kwh: num(d.kwh), matchedKwh: num(d.matchedKwh), matchedMs: num(d.matchedMs), estPrl: num(d.estPrl) };
      if (d.legacyPrl || d.legacyKwh) Object.assign(l.days[k], { legacyPrl: num(d.legacyPrl), legacyKwh: num(d.legacyKwh) });
    } else {
      l.days[k] = { ...emptyDay(), legacyPrl: num(d.prl), legacyKwh: num(d.kwh) };
    }
  }
  if (r.version === 2) {
    l.pendingKwh = num(r.pendingKwh);
    l.pendingMs = num(r.pendingMs);
  }
  return l;
}

export function dateKey(ms: number): string {
  const d = new Date(ms);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function day(l: Ledger, now: number): DayEntry {
  const k = dateKey(now);
  l.days[k] ??= emptyDay();
  return l.days[k];
}

function prune(l: Ledger): void {
  const keys = Object.keys(l.days).sort();
  for (const k of keys.slice(0, Math.max(0, keys.length - KEEP_DAYS))) delete l.days[k];
  if (l.seenPayouts.length > KEEP_PAYOUT_KEYS) l.seenPayouts = l.seenPayouts.slice(-KEEP_PAYOUT_KEYS);
}

/**
 * 풀 잔액·지급 내역 조회 1회분을 장부에 반영한다(새 장부 반환).
 * total = 미지급 잔액 + 지금까지 본 지급 합계. total 이 이전 최고치보다 커진 만큼만 확정 채굴량으로 기록하고,
 * 그동안 쌓인 대기 전력(pending)을 같은 날짜에 짝지어 옮긴다.
 * (지급으로 잔액이 먼저 줄고 지급 내역은 나중에 보이는 경우에도 이중 계상하지 않음)
 * 첫 조회는 기준점만 잡고, 그 이전 전력은 버린다(짝지을 채굴량이 없으므로).
 */
export function recordEarnings(prev: Ledger, balance: number, payouts: Payout[], now: number): Ledger {
  const l: Ledger = structuredClone(prev);
  const seen = new Set(l.seenPayouts);
  const fresh = payouts.filter((p) => !seen.has(p.key));
  l.paidTotal += fresh.reduce((s, p) => s + p.amount, 0);
  l.seenPayouts.push(...fresh.map((p) => p.key));
  const total = balance + l.paidTotal;
  if (l.lastTotal === null) {
    l.lastTotal = total;
    l.pendingKwh = 0;
    l.pendingMs = 0;
  } else if (total > l.lastTotal) {
    const d = day(l, now);
    d.prl += total - l.lastTotal;
    d.matchedKwh += l.pendingKwh;
    d.matchedMs += l.pendingMs;
    l.pendingKwh = 0;
    l.pendingMs = 0;
    l.lastTotal = total;
  }
  prune(l);
  return l;
}

/** 실측 GPU 전력(W)을 dtMs 동안 사용한 것으로 누적. estPrl 은 같은 시간의 해시레이트 기반 추정 채굴량 */
export function recordEnergy(prev: Ledger, watts: number, dtMs: number, now: number, estPrl = 0): Ledger {
  if (!(watts > 0) || !(dtMs > 0)) return prev;
  const l: Ledger = structuredClone(prev);
  const kwh = (watts * dtMs) / 3_600_000 / 1000;
  const d = day(l, now);
  d.kwh += kwh;
  if (estPrl > 0 && Number.isFinite(estPrl)) d.estPrl += estPrl;
  // 확정 집계가 시작된 뒤(기준점이 있을 때)만 짝지을 전력으로 모은다
  if (l.lastTotal !== null) {
    l.pendingKwh += kwh;
    l.pendingMs += dtMs;
  }
  prune(l);
  return l;
}

export function recordPrice(prev: Ledger, usd: number, now: number): Ledger {
  return Number.isFinite(usd) && usd > 0 ? { ...prev, lastPrice: { usd, at: now } } : prev;
}

export type PeriodSummary = PeriodView;

function summarizeDays(entries: DayEntry[], usd: number | null, cfg: Pick<ProfitConfig, 'krwPerKwh' | 'krwPerUsd'>): PeriodSummary {
  const sum = (f: (d: DayEntry) => number) => entries.reduce((s, d) => s + f(d), 0);
  const matchedCoin = sum((d) => d.prl);
  const matchedKwh = sum((d) => d.matchedKwh);
  const matchedMs = sum((d) => d.matchedMs);
  const estCoin = sum((d) => d.estPrl);
  const kwh = sum((d) => d.kwh);
  const status = usd === null ? 'noPrice' : matchedMs < MIN_MATCHED_MS ? 'collecting' : 'ok';
  return {
    confirmedCoin: matchedCoin + sum((d) => d.legacyPrl ?? 0),
    matchedCoin,
    matchedKwh,
    matchedHours: matchedMs / 3_600_000,
    confirmedNetKrw: status === 'ok' ? netKrw(matchedCoin, matchedKwh, usd as number, cfg) : null,
    estCoin,
    kwh,
    // 해시레이트 추정이 없으면(통계 API·풀 통계 없음) 전력비만으로 음수를 만들지 않는다
    estNetKrw: usd !== null && estCoin > 0 ? netKrw(estCoin, kwh, usd, cfg) : null,
    status,
  };
}

export function summarize(l: Ledger, now: number, usd: number | null, cfg: Pick<ProfitConfig, 'krwPerKwh' | 'krwPerUsd'>): { today: PeriodSummary; month: PeriodSummary } {
  const today = dateKey(now);
  const month = today.slice(0, 7);
  const monthDays = Object.entries(l.days).filter(([k]) => k.startsWith(month)).map(([, v]) => v);
  return { today: summarizeDays(l.days[today] ? [l.days[today]] : [], usd, cfg), month: summarizeDays(monthDays, usd, cfg) };
}

export function netKrw(prl: number, kwh: number, prlUsd: number, cfg: Pick<ProfitConfig, 'krwPerKwh' | 'krwPerUsd'>): number {
  return prl * prlUsd * cfg.krwPerUsd - kwh * cfg.krwPerKwh;
}
