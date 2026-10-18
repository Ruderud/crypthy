// 누적 손익(PnL) 장부.
//
// 저장 방식
//  - events.jsonl: append-only 이벤트 로그(한 줄 = 한 이벤트). 깨진 줄은 읽을 때 건너뛰고, 쓰기 실패는 다음 줄부터 계속.
//    용량 상한(EVENTS_MAX_BYTES)을 넘으면 events.1.jsonl 로 한 번 회전한다(원시 기록만 회전).
//  - daily.json: 코인·날짜별 일별 집계. 기간 제한 없이 유지하며 PnL 계산은 이 집계를 기준으로 한다.
//
// 계산 정의
//  - 채굴량 = 풀 확정 증가분(직전 증가 이후 시간 비율로 날짜에 나눔) + 소급분(추적 시작 전, 추정) + 풀에 아직 반영 안 된 실시간 추정분
//  - 채굴 매출 = Σ(채굴 증가분 × 그 시점 시세(원)). 시세가 없으면 수량만 기록했다가 다음 시세로 평가하고 "추정" 표시
//  - 전력비 = Σ(실측 GPU 전력량 × 그 시점 전기 단가)
//  - 실현 손익 = Σ(매도 대금 − 수수료)   (사용자가 직접 입력한 매도 기록 기준, 없으면 0)
//  - 미실현 손익 = 보유량(채굴 − 매도) × 현재가
//  - 총 PnL = 실현 + 미실현 − 전력비
import fs from 'node:fs';
import path from 'node:path';
import { dateKey } from './profit';

export const EVENTS_MAX_BYTES = 5 * 1024 * 1024;

export type PnlEvent =
  | { t: number; type: 'pool'; coin: string; total: number }
  | { t: number; type: 'payout'; coin: string; key: string; amount: number; at: number | null }
  | { t: number; type: 'mined'; coin: string; qty: number; krwPerCoin: number | null; from?: number }
  | { t: number; type: 'energy'; start: number; end: number; avgW: number; kwh: number; krwPerKwh: number }
  | { t: number; type: 'price'; coin: string; usd: number; krwPerUsd: number }
  | { t: number; type: 'sale'; coin: string; qty: number; proceedsKrw: number; feeKrw: number; venue: string; note: string }
  | { t: number; type: 'bootstrap'; coin: string; from: number; to: number; qty: number; watts: number; kwh: number; auto?: boolean };

const EVENT_TYPES = new Set(['pool', 'payout', 'mined', 'energy', 'price', 'sale', 'bootstrap']);

/** 한 줄 추가. 상한을 넘으면 먼저 .1 로 회전. 실패해도 예외를 던지지 않는다(다음 이벤트에서 다시 시도) */
export function appendEvent(file: string, ev: PnlEvent, maxBytes = EVENTS_MAX_BYTES): boolean {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const line = `${JSON.stringify(ev)}\n`;
    let size = 0;
    try {
      size = fs.statSync(file).size;
    } catch {
      size = 0;
    }
    if (size > 0 && size + line.length > maxBytes) fs.renameSync(file, rotated(file));
    fs.appendFileSync(file, line);
    return true;
  } catch {
    return false;
  }
}

export const rotated = (file: string) => file.replace(/\.jsonl$/, '.1.jsonl');

/** 회전된 파일(.1) → 현재 파일 순으로 읽고, 형식이 맞지 않는 줄은 건너뛴다 */
export function readEvents(file: string): PnlEvent[] {
  const out: PnlEvent[] = [];
  for (const f of [rotated(file), file]) {
    let text = '';
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      try {
        const ev = JSON.parse(line) as PnlEvent;
        if (ev && typeof ev === 'object' && EVENT_TYPES.has(ev.type) && Number.isFinite(ev.t)) out.push(ev);
      } catch {
        // 쓰다가 끊긴 줄 등은 무시
      }
    }
  }
  return out;
}

/** 처음 보는 지급만 이벤트로 (txid 등 key 기준 중복 방지) */
export function freshPayouts(seen: ReadonlySet<string>, payouts: { key: string; amount: number; at?: number | null }[]) {
  const out: { key: string; amount: number; at: number | null }[] = [];
  const local = new Set(seen);
  for (const p of payouts) {
    if (local.has(p.key)) continue;
    local.add(p.key);
    out.push({ key: p.key, amount: p.amount, at: p.at ?? null });
  }
  return out;
}

// ---- 일별 장부 ----

export interface PnlDay {
  coin: string;
  day: string;
  /** 채굴량 */
  mined: number;
  /** 채굴 시점 시세로 평가한 매출(원) */
  revenueKrw: number;
  /** 시세가 없어 아직 평가하지 못한 채굴량 */
  unpriced: number;
  energyKwh: number;
  energyCostKrw: number;
  soldQty: number;
  proceedsKrw: number;
  feeKrw: number;
  /** 추정값이 섞였는지 (소급 복원·나중 시세 평가·추정 전력) */
  est: { mined: boolean; revenue: boolean; energy: boolean };
}

/** 소급분의 하루 몫 (days 와 따로 두어 다시 계산할 때 이전 몫을 그대로 빼낸다) */
export interface BackfillDay {
  mined: number;
  revenueKrw: number;
  unpriced: number;
  energyKwh: number;
  energyCostKrw: number;
}

export interface Backfill {
  coin: string;
  from: number;
  to: number;
  qty: number;
  watts: number;
  /** 앱이 자동으로 추정한 값인지 (사용자가 고쳐 다시 계산하면 false) */
  auto: boolean;
  days: Record<string, BackfillDay>;
}

export interface PnlBook {
  version: 1;
  days: Record<string, PnlDay>;
  /** 추적 시작 시점의 풀 누적치(이전 채굴분 = 소급 대상) */
  trackStart: { at: number; total: number } | null;
  /** 소급을 적용했는지. 0.3.4 에서 days 에 합쳐 적용한 경우 backfill 은 null 일 수 있다 */
  bootstrapped: boolean;
  backfill: Backfill | null;
  /** 마지막 풀 증가(또는 추적 시작) 시각. 다음 증가분을 이때부터 지금까지 시간 비율로 날짜에 나눈다 */
  lastMinedAt: number | null;
  /** 풀에 아직 반영되지 않은 실시간 추정 채굴량 (`coin|day` → 수량). 풀 증가가 확인되면 비운다 */
  pending: Record<string, number>;
}

export const emptyBook = (): PnlBook => ({ version: 1, days: {}, trackStart: null, bootstrapped: false, backfill: null, lastMinedAt: null, pending: {} });

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function loadBook(raw: unknown): PnlBook {
  const b = emptyBook();
  if (!raw || typeof raw !== 'object') return b;
  const r = raw as Partial<PnlBook>;
  if (r.trackStart && Number.isFinite(r.trackStart.at) && Number.isFinite(r.trackStart.total)) b.trackStart = { at: r.trackStart.at, total: r.trackStart.total };
  b.bootstrapped = r.bootstrapped === true;
  if (Number.isFinite(r.lastMinedAt)) b.lastMinedAt = r.lastMinedAt as number;
  for (const [k, v] of Object.entries(r.pending ?? {})) if (/^[^|]+\|\d{4}-\d{2}-\d{2}$/.test(k) && num(v) > 0) b.pending[k] = num(v);
  const f = r.backfill;
  if (f && typeof f.coin === 'string' && Number.isFinite(f.from) && Number.isFinite(f.to) && f.days && typeof f.days === 'object') {
    const days: Record<string, BackfillDay> = {};
    for (const [k, d] of Object.entries(f.days)) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(k) || !d || typeof d !== 'object') continue;
      days[k] = { mined: num(d.mined), revenueKrw: num(d.revenueKrw), unpriced: num(d.unpriced), energyKwh: num(d.energyKwh), energyCostKrw: num(d.energyCostKrw) };
    }
    b.backfill = { coin: f.coin, from: f.from, to: f.to, qty: num(f.qty), watts: num(f.watts), auto: f.auto === true, days };
    b.bootstrapped = true;
  }
  for (const [k, d] of Object.entries(r.days ?? {})) {
    if (!d || typeof d !== 'object' || typeof d.coin !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(String(d.day))) continue;
    b.days[k] = {
      coin: d.coin, day: d.day, mined: num(d.mined), revenueKrw: num(d.revenueKrw), unpriced: num(d.unpriced),
      energyKwh: num(d.energyKwh), energyCostKrw: num(d.energyCostKrw), soldQty: num(d.soldQty), proceedsKrw: num(d.proceedsKrw), feeKrw: num(d.feeKrw),
      est: { mined: !!d.est?.mined, revenue: !!d.est?.revenue, energy: !!d.est?.energy },
    };
  }
  return b;
}

function day(b: PnlBook, coin: string, dayKey: string): PnlDay {
  const k = `${coin}|${dayKey}`;
  b.days[k] ??= {
    coin, day: dayKey, mined: 0, revenueKrw: 0, unpriced: 0, energyKwh: 0, energyCostKrw: 0, soldQty: 0, proceedsKrw: 0, feeKrw: 0,
    est: { mined: false, revenue: false, energy: false },
  };
  return b.days[k];
}

export function addMined(b: PnlBook, coin: string, at: number, qty: number, krwPerCoin: number | null): void {
  if (!(qty > 0)) return;
  const d = day(b, coin, dateKey(at));
  d.mined += qty;
  if (krwPerCoin !== null && krwPerCoin > 0) d.revenueKrw += qty * krwPerCoin;
  else d.unpriced += qty;
}

/** from~to 를 로컬 날짜 경계(자정)로 자른 조각들 */
export function splitByDay(from: number, to: number): { key: string; start: number; span: number }[] {
  const out: { key: string; start: number; span: number }[] = [];
  let cur = from;
  while (cur < to) {
    const d0 = new Date(cur);
    const next = Math.min(to, new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1).getTime());
    out.push({ key: dateKey(cur), start: cur, span: next - cur });
    cur = next;
  }
  return out;
}

/** 풀 누적치를 처음 받은 시점을 추적 시작으로 잡는다. 그 이전 채굴분은 소급 대상이고, 쌓아 둔 실시간 추정분은 비운다 */
export function startTracking(b: PnlBook, coin: string, at: number, total: number): void {
  if (b.trackStart) return;
  b.trackStart = { at, total };
  b.lastMinedAt = at;
  clearPending(b, coin);
}

/**
 * 풀 확정 증가분. 직전 증가(또는 추적 시작) 이후 지금까지 시간 비율로 날짜에 나눈다(자정에 걸치면 두 날로).
 * 확정분이 들어오면 그동안의 실시간 추정분은 비운다(이중 계상 방지).
 */
export function addPoolIncrease(b: PnlBook, coin: string, now: number, qty: number, krwPerCoin: number | null): void {
  const from = b.lastMinedAt !== null && b.lastMinedAt < now ? b.lastMinedAt : now;
  b.lastMinedAt = now;
  clearPending(b, coin);
  if (!(qty > 0)) return;
  if (from === now) return addMined(b, coin, now, qty, krwPerCoin);
  const total = now - from;
  for (const p of splitByDay(from, now)) addMined(b, coin, p.start, (qty * p.span) / total, krwPerCoin);
}

/** 풀에 아직 반영되지 않은 실시간 추정 채굴량(해시레이트 × 풀 통계). 추적 중일 때만 쌓는다 */
export function addPending(b: PnlBook, coin: string, at: number, qty: number): void {
  if (!b.trackStart || !(qty > 0) || !Number.isFinite(qty)) return;
  const k = `${coin}|${dateKey(at)}`;
  b.pending[k] = (b.pending[k] ?? 0) + qty;
}

function clearPending(b: PnlBook, coin: string): void {
  for (const k of Object.keys(b.pending)) if (k.startsWith(`${coin}|`)) delete b.pending[k];
}

/** 시세가 생기면 아직 평가하지 못한 채굴량을 그 시세로 평가하고 "추정" 표시 */
export function priceUnpriced(b: PnlBook, coin: string, krwPerCoin: number): void {
  if (!(krwPerCoin > 0)) return;
  for (const d of Object.values(b.days)) {
    if (d.coin !== coin || d.unpriced <= 0) continue;
    d.revenueKrw += d.unpriced * krwPerCoin;
    d.unpriced = 0;
    d.est.revenue = true;
  }
  if (b.backfill?.coin !== coin) return;
  for (const d of Object.values(b.backfill.days)) {
    d.revenueKrw += d.unpriced * krwPerCoin;
    d.unpriced = 0;
  }
}

export function addEnergy(b: PnlBook, coin: string, at: number, kwh: number, krwPerKwh: number): void {
  if (!(kwh > 0)) return;
  const d = day(b, coin, dateKey(at));
  d.energyKwh += kwh;
  d.energyCostKrw += kwh * krwPerKwh;
}

export function addSale(b: PnlBook, coin: string, at: number, qty: number, proceedsKrw: number, feeKrw: number): void {
  const d = day(b, coin, dateKey(at));
  d.soldQty += qty;
  d.proceedsKrw += proceedsKrw;
  d.feeKrw += feeKrw;
}

/**
 * 소급 복원: 추적 시작 이전 채굴분(qty)을 from~to 사이에 시간 비율로 나누고,
 * 전력비는 watts × 시간으로 추정한다. 매출은 그날 종가(원), 없으면 fallback 으로 평가. 모두 "추정" 표시.
 * 일별 장부와 따로 저장하므로 다시 계산하면 이전 소급분을 바꿔 끼운다(이중 계상 없음).
 */
export function bootstrap(
  b: PnlBook,
  o: { coin: string; from: number; to: number; qty: number; watts: number; krwPerKwh: number; closeKrwByDay: Record<string, number>; fallbackKrw: number | null; auto?: boolean },
): { days: number; kwh: number } {
  if (!(o.to > o.from) || !(o.qty > 0)) return { days: 0, kwh: 0 };
  const total = o.to - o.from;
  const days: Record<string, BackfillDay> = {};
  let kwhSum = 0;
  for (const p of splitByDay(o.from, o.to)) {
    const qty = (o.qty * p.span) / total;
    const price = o.closeKrwByDay[p.key] ?? o.fallbackKrw;
    const kwh = o.watts > 0 ? (o.watts * p.span) / 3_600_000 / 1000 : 0;
    days[p.key] = {
      mined: qty,
      revenueKrw: price !== null && price > 0 ? qty * price : 0,
      unpriced: price !== null && price > 0 ? 0 : qty,
      energyKwh: kwh,
      energyCostKrw: kwh * o.krwPerKwh,
    };
    kwhSum += kwh;
  }
  b.backfill = { coin: o.coin, from: o.from, to: o.to, qty: o.qty, watts: o.watts, auto: o.auto === true, days };
  b.bootstrapped = true;
  return { days: Object.keys(days).length, kwh: kwhSum };
}

/**
 * 0.3.4 에서 일별 장부(days)에 합쳐 적용한 소급분을 따로 떼어 낸다(그래야 다시 계산할 수 있다).
 * 수량·전력량은 같은 방식으로 다시 나눠 정확히 빼고, 매출·전력비는 그날 값에서 비율로 뺀다.
 */
export function separateLegacyBackfill(b: PnlBook, ev: { coin: string; from: number; to: number; qty: number; watts: number }): boolean {
  if (b.backfill || !b.bootstrapped || !(ev.to > ev.from) || !(ev.qty > 0)) return false;
  const total = ev.to - ev.from;
  const days: Record<string, BackfillDay> = {};
  for (const p of splitByDay(ev.from, ev.to)) {
    const d = b.days[`${ev.coin}|${p.key}`];
    if (!d) continue;
    const share = (x: number, part: number, whole: number) => (whole > 0 ? (x * Math.min(part, whole)) / whole : 0);
    const qty = Math.min(d.mined, (ev.qty * p.span) / total);
    const kwh = Math.min(d.energyKwh, ev.watts > 0 ? (ev.watts * p.span) / 3_600_000 / 1000 : 0);
    const pricedQty = d.mined - d.unpriced;
    const unpriced = Math.min(d.unpriced, qty);
    const bd: BackfillDay = {
      mined: qty,
      revenueKrw: share(d.revenueKrw, qty - unpriced, pricedQty),
      unpriced,
      energyKwh: kwh,
      energyCostKrw: share(d.energyCostKrw, kwh, d.energyKwh),
    };
    d.mined -= bd.mined;
    d.revenueKrw -= bd.revenueKrw;
    d.unpriced -= bd.unpriced;
    d.energyKwh -= bd.energyKwh;
    d.energyCostKrw -= bd.energyCostKrw;
    days[p.key] = bd;
  }
  b.backfill = { coin: ev.coin, from: ev.from, to: ev.to, qty: ev.qty, watts: ev.watts, auto: false, days };
  return true;
}

/**
 * 자동 소급용 채굴 시작 시각 추정: 풀 누적치 ÷ 지금 기대 채굴 속도만큼 거슬러 올라간다.
 * 가장 이른 지급보다 늦을 수는 없고(지급 전에 이미 채굴 중), 1년보다 앞서지 않는다. 속도를 모르면 null.
 */
export function estimateBackfillFrom(o: { to: number; qty: number; coinPerHour: number | null; earliestPayoutAt: number | null }): number | null {
  if (!(o.qty > 0) || !(o.coinPerHour !== null && o.coinPerHour > 0)) return null;
  let from = o.to - (o.qty / o.coinPerHour) * 3_600_000;
  if (o.earliestPayoutAt !== null && o.earliestPayoutAt < o.to) from = Math.min(from, o.earliestPayoutAt);
  return Math.round(Math.max(from, o.to - 366 * 86_400_000));
}

export interface PeriodPnl {
  /** 확정 + 소급 + 실시간 추정 */
  mined: number;
  /** 풀 확정 증가분 */
  confirmed: number;
  /** 추적 시작 전 소급분 (추정) */
  backfill: number;
  /** 풀에 아직 반영되지 않은 실시간 추정분 (현재가로 평가) */
  pending: number;
  revenueKrw: number;
  /** 시세가 없어 매출에 넣지 못한 수량 */
  unpriced: number;
  energyCostKrw: number;
  /** 채굴 시점 가치 기준 순익 = 매출 − 전력비 */
  netKrw: number;
  estimated: boolean;
}

export interface PnlSummary {
  today: PeriodPnl;
  /** 이번 달(로컬 달력) */
  month: PeriodPnl;
  d7: PeriodPnl;
  d30: PeriodPnl;
  all: PeriodPnl;
  holdings: number;
  soldQty: number;
  realizedKrw: number;
  /** 현재가가 없으면 null */
  unrealizedKrw: number | null;
  totalPnlKrw: number | null;
  estimated: boolean;
}

interface Row {
  day: string;
  confirmed: number;
  backfill: number;
  pending: number;
  revenueKrw: number;
  unpriced: number;
  energyKwh: number;
  energyCostKrw: number;
  soldQty: number;
  proceedsKrw: number;
  feeKrw: number;
  estimated: boolean;
}

/**
 * 날짜별로 확정(days) + 소급(backfill) + 실시간 추정(pending)을 합친다.
 * pendingKrw 가 undefined 면 실시간 추정분은 넣지 않는다(CSV 등 기록용). null 이면 수량만(시세 없음).
 */
function rows(b: PnlBook, coin: string, pendingKrw?: number | null): Row[] {
  const out = new Map<string, Row>();
  const row = (day: string) => {
    let r = out.get(day);
    if (!r) {
      r = { day, confirmed: 0, backfill: 0, pending: 0, revenueKrw: 0, unpriced: 0, energyKwh: 0, energyCostKrw: 0, soldQty: 0, proceedsKrw: 0, feeKrw: 0, estimated: false };
      out.set(day, r);
    }
    return r;
  };
  for (const d of Object.values(b.days)) {
    if (d.coin !== coin) continue;
    const r = row(d.day);
    r.confirmed += d.mined;
    r.revenueKrw += d.revenueKrw;
    r.unpriced += d.unpriced;
    r.energyKwh += d.energyKwh;
    r.energyCostKrw += d.energyCostKrw;
    r.soldQty += d.soldQty;
    r.proceedsKrw += d.proceedsKrw;
    r.feeKrw += d.feeKrw;
    r.estimated ||= d.est.mined || d.est.revenue || d.est.energy || d.unpriced > 0;
  }
  if (b.backfill?.coin === coin) {
    for (const [day, d] of Object.entries(b.backfill.days)) {
      const r = row(day);
      r.backfill += d.mined;
      r.revenueKrw += d.revenueKrw;
      r.unpriced += d.unpriced;
      r.energyKwh += d.energyKwh;
      r.energyCostKrw += d.energyCostKrw;
      r.estimated = true;
    }
  }
  if (pendingKrw !== undefined) {
    for (const [k, qty] of Object.entries(b.pending)) {
      const [c, day] = k.split('|');
      if (c !== coin || !(qty > 0)) continue;
      const r = row(day);
      r.pending += qty;
      if (pendingKrw !== null && pendingKrw > 0) r.revenueKrw += qty * pendingKrw;
      else r.unpriced += qty;
      r.estimated = true;
    }
  }
  return [...out.values()].sort((a, z) => a.day.localeCompare(z.day));
}

function period(days: Row[]): PeriodPnl {
  const s = (f: (d: Row) => number) => days.reduce((a, d) => a + f(d), 0);
  const confirmed = s((d) => d.confirmed);
  const backfill = s((d) => d.backfill);
  const pending = s((d) => d.pending);
  const revenueKrw = s((d) => d.revenueKrw);
  const energyCostKrw = s((d) => d.energyCostKrw);
  return {
    mined: confirmed + backfill + pending,
    confirmed,
    backfill,
    pending,
    revenueKrw,
    unpriced: s((d) => d.unpriced),
    energyCostKrw,
    netKrw: revenueKrw - energyCostKrw,
    estimated: days.some((d) => d.estimated),
  };
}

/** 오늘·이번 달·최근 7일·30일(오늘 포함)·전체, 그리고 보유량 기준 실현/미실현/총 PnL */
export function summarizePnl(b: PnlBook, coin: string, now: number, priceKrw: number | null, priceEstimated = false): PnlSummary {
  const all = rows(b, coin, priceKrw);
  const since = (n: number) => dateKey(new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() - (n - 1)).getTime());
  const today = dateKey(now);
  const inRange = (from: string) => all.filter((d) => d.day >= from && d.day <= today);
  const p = period(all);
  const soldQty = all.reduce((a, d) => a + d.soldQty, 0);
  const realizedKrw = all.reduce((a, d) => a + d.proceedsKrw - d.feeKrw, 0);
  // 보유량은 풀에 들어온 몫(확정 + 소급)만. 실시간 추정분은 아직 풀에 없다
  const holdings = p.confirmed + p.backfill - soldQty;
  const unrealizedKrw = priceKrw !== null && priceKrw > 0 ? Math.max(0, holdings) * priceKrw : null;
  return {
    today: period(inRange(today)),
    month: period(inRange(`${today.slice(0, 7)}-01`)),
    d7: period(inRange(since(7))),
    d30: period(inRange(since(30))),
    all: p,
    holdings,
    soldQty,
    realizedKrw,
    unrealizedKrw,
    totalPnlKrw: unrealizedKrw === null ? null : realizedKrw + unrealizedKrw - p.energyCostKrw,
    estimated: p.estimated || priceEstimated,
  };
}

/** 차트용: 일별 순익(채굴 시점 가치 − 전력비) 막대 + 누적 라인. 오늘 막대에는 실시간 추정분(현재가)도 넣는다 */
export function pnlDaily(b: PnlBook, coin: string, priceKrw: number | null = null): { day: string; netKrw: number; cumulativeKrw: number; estimated: boolean }[] {
  let cum = 0;
  return rows(b, coin, priceKrw).map((d) => {
    const net = d.revenueKrw - d.energyCostKrw;
    cum += net;
    return { day: d.day, netKrw: Math.round(net), cumulativeKrw: Math.round(cum), estimated: d.estimated };
  });
}

// ---- CSV ----

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // 수식 주입 방지: = + - @ 로 시작하는 텍스트는 ' 를 붙인다 (숫자는 그대로)
  const safe = typeof v === 'string' && /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

/** 일별 장부 CSV (확정 + 소급, 실시간 추정분은 빼고). mined 열은 확정 + 소급 */
export function dailyCsv(b: PnlBook): string {
  const head = ['coin', 'day', 'mined', 'revenue_krw', 'unpriced', 'energy_kwh', 'energy_cost_krw', 'net_krw', 'sold_qty', 'proceeds_krw', 'fee_krw', 'estimated', 'backfill'];
  const coins = [...new Set([...Object.values(b.days).map((d) => d.coin), ...(b.backfill ? [b.backfill.coin] : [])])].sort();
  const out = coins.flatMap((coin) =>
    rows(b, coin).map((d) => [coin, d.day, (d.confirmed + d.backfill).toFixed(8), Math.round(d.revenueKrw), d.unpriced.toFixed(8), d.energyKwh.toFixed(3), Math.round(d.energyCostKrw), Math.round(d.revenueKrw - d.energyCostKrw), d.soldQty.toFixed(8), Math.round(d.proceedsKrw), Math.round(d.feeKrw), d.estimated ? 'yes' : 'no', d.backfill.toFixed(8)]),
  );
  return [head, ...out].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}

export function eventsCsv(events: PnlEvent[]): string {
  const head = ['time_iso', 'type', 'coin', 'qty_or_total', 'krw', 'detail'];
  const rows = events.map((e) => {
    const iso = new Date(e.t).toISOString();
    switch (e.type) {
      case 'pool': return [iso, e.type, e.coin, e.total, '', ''];
      case 'payout': return [iso, e.type, e.coin, e.amount, '', e.at ? `paid ${new Date(e.at).toISOString()}` : ''];
      case 'mined': return [iso, e.type, e.coin, e.qty, e.krwPerCoin ?? '', 'krw per coin'];
      case 'energy': return [iso, e.type, '', e.kwh, Math.round(e.kwh * e.krwPerKwh), `${new Date(e.start).toISOString()}~${new Date(e.end).toISOString()} avg ${Math.round(e.avgW)}W`];
      case 'price': return [iso, e.type, e.coin, '', Math.round(e.usd * e.krwPerUsd * 100) / 100, `usd ${e.usd} fx ${e.krwPerUsd}`];
      case 'sale': return [iso, e.type, e.coin, e.qty, e.proceedsKrw - e.feeKrw, `${e.venue} ${e.note}`.trim()];
      case 'bootstrap': return [iso, e.type, e.coin, e.qty, '', `${e.auto ? 'auto ' : ''}estimated ${new Date(e.from).toISOString()}~${new Date(e.to).toISOString()} ${e.watts}W ${e.kwh.toFixed(3)}kWh`];
    }
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
