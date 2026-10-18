// 누적 손익(PnL) 장부.
//
// 저장 방식
//  - events.jsonl: append-only 이벤트 로그(한 줄 = 한 이벤트). 깨진 줄은 읽을 때 건너뛰고, 쓰기 실패는 다음 줄부터 계속.
//    용량 상한(EVENTS_MAX_BYTES)을 넘으면 events.1.jsonl 로 한 번 회전한다(원시 기록만 회전).
//  - daily.json: 코인·날짜별 일별 집계. 기간 제한 없이 유지하며 PnL 계산은 이 집계를 기준으로 한다.
//
// 계산 정의
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
  | { t: number; type: 'mined'; coin: string; qty: number; krwPerCoin: number | null }
  | { t: number; type: 'energy'; start: number; end: number; avgW: number; kwh: number; krwPerKwh: number }
  | { t: number; type: 'price'; coin: string; usd: number; krwPerUsd: number }
  | { t: number; type: 'sale'; coin: string; qty: number; proceedsKrw: number; feeKrw: number; venue: string; note: string }
  | { t: number; type: 'bootstrap'; coin: string; from: number; to: number; qty: number; watts: number; kwh: number };

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

export interface PnlBook {
  version: 1;
  days: Record<string, PnlDay>;
  /** 추적 시작 시점의 풀 누적치(이전 채굴분 = 소급 대상) */
  trackStart: { at: number; total: number } | null;
  bootstrapped: boolean;
}

export const emptyBook = (): PnlBook => ({ version: 1, days: {}, trackStart: null, bootstrapped: false });

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

export function loadBook(raw: unknown): PnlBook {
  const b = emptyBook();
  if (!raw || typeof raw !== 'object') return b;
  const r = raw as Partial<PnlBook>;
  if (r.trackStart && Number.isFinite(r.trackStart.at) && Number.isFinite(r.trackStart.total)) b.trackStart = { at: r.trackStart.at, total: r.trackStart.total };
  b.bootstrapped = r.bootstrapped === true;
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

/** 시세가 생기면 아직 평가하지 못한 채굴량을 그 시세로 평가하고 "추정" 표시 */
export function priceUnpriced(b: PnlBook, coin: string, krwPerCoin: number): void {
  if (!(krwPerCoin > 0)) return;
  for (const d of Object.values(b.days)) {
    if (d.coin !== coin || d.unpriced <= 0) continue;
    d.revenueKrw += d.unpriced * krwPerCoin;
    d.unpriced = 0;
    d.est.revenue = true;
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
 */
export function bootstrap(
  b: PnlBook,
  o: { coin: string; from: number; to: number; qty: number; watts: number; krwPerKwh: number; closeKrwByDay: Record<string, number>; fallbackKrw: number | null },
): { days: number; kwh: number } {
  if (!(o.to > o.from) || !(o.qty > 0)) return { days: 0, kwh: 0 };
  const total = o.to - o.from;
  let kwhSum = 0;
  let days = 0;
  let cur = o.from;
  while (cur < o.to) {
    const d0 = new Date(cur);
    const next = Math.min(o.to, new Date(d0.getFullYear(), d0.getMonth(), d0.getDate() + 1).getTime());
    const span = next - cur;
    const key = dateKey(cur);
    const d = day(b, o.coin, key);
    const qty = (o.qty * span) / total;
    const price = o.closeKrwByDay[key] ?? o.fallbackKrw;
    d.mined += qty;
    if (price !== null && price > 0) d.revenueKrw += qty * price;
    else d.unpriced += qty;
    const kwh = o.watts > 0 ? (o.watts * span) / 3_600_000 / 1000 : 0;
    d.energyKwh += kwh;
    d.energyCostKrw += kwh * o.krwPerKwh;
    d.est = { mined: true, revenue: true, energy: o.watts > 0 ? true : d.est.energy };
    kwhSum += kwh;
    days++;
    cur = next;
  }
  b.bootstrapped = true;
  return { days, kwh: kwhSum };
}

export interface PeriodPnl {
  mined: number;
  revenueKrw: number;
  energyCostKrw: number;
  /** 채굴 시점 가치 기준 순익 = 매출 − 전력비 */
  netKrw: number;
  estimated: boolean;
}

export interface PnlSummary {
  today: PeriodPnl;
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

function period(days: PnlDay[]): PeriodPnl {
  const s = (f: (d: PnlDay) => number) => days.reduce((a, d) => a + f(d), 0);
  const revenueKrw = s((d) => d.revenueKrw);
  const energyCostKrw = s((d) => d.energyCostKrw);
  return {
    mined: s((d) => d.mined),
    revenueKrw,
    energyCostKrw,
    netKrw: revenueKrw - energyCostKrw,
    estimated: days.some((d) => d.est.mined || d.est.revenue || d.est.energy || d.unpriced > 0),
  };
}

/** 오늘·최근 7일·30일(오늘 포함)·전체, 그리고 보유량 기준 실현/미실현/총 PnL */
export function summarizePnl(b: PnlBook, coin: string, now: number, priceKrw: number | null, priceEstimated = false): PnlSummary {
  const all = Object.values(b.days).filter((d) => d.coin === coin);
  const since = (n: number) => dateKey(new Date(new Date(now).getFullYear(), new Date(now).getMonth(), new Date(now).getDate() - (n - 1)).getTime());
  const today = dateKey(now);
  const inRange = (from: string) => all.filter((d) => d.day >= from && d.day <= today);
  const p = period(all);
  const soldQty = all.reduce((a, d) => a + d.soldQty, 0);
  const realizedKrw = all.reduce((a, d) => a + d.proceedsKrw - d.feeKrw, 0);
  const holdings = p.mined - soldQty;
  const unrealizedKrw = priceKrw !== null && priceKrw > 0 ? Math.max(0, holdings) * priceKrw : null;
  return {
    today: period(inRange(today)),
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

/** 차트용: 일별 순익(채굴 시점 가치 − 전력비) 막대 + 누적 라인 */
export function pnlDaily(b: PnlBook, coin: string): { day: string; netKrw: number; cumulativeKrw: number; estimated: boolean }[] {
  let cum = 0;
  return Object.values(b.days)
    .filter((d) => d.coin === coin)
    .sort((a, z) => a.day.localeCompare(z.day))
    .map((d) => {
      const net = d.revenueKrw - d.energyCostKrw;
      cum += net;
      return { day: d.day, netKrw: Math.round(net), cumulativeKrw: Math.round(cum), estimated: d.est.mined || d.est.revenue || d.est.energy || d.unpriced > 0 };
    });
}

// ---- CSV ----

const csvCell = (v: unknown) => {
  const s = v === null || v === undefined ? '' : String(v);
  // 수식 주입 방지: = + - @ 로 시작하는 텍스트는 ' 를 붙인다 (숫자는 그대로)
  const safe = typeof v === 'string' && /^[=+\-@]/.test(s) ? `'${s}` : s;
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
};

export function dailyCsv(b: PnlBook): string {
  const head = ['coin', 'day', 'mined', 'revenue_krw', 'unpriced', 'energy_kwh', 'energy_cost_krw', 'net_krw', 'sold_qty', 'proceeds_krw', 'fee_krw', 'estimated'];
  const rows = Object.values(b.days)
    .sort((a, z) => (a.coin + a.day).localeCompare(z.coin + z.day))
    .map((d) => [d.coin, d.day, d.mined.toFixed(8), Math.round(d.revenueKrw), d.unpriced.toFixed(8), d.energyKwh.toFixed(3), Math.round(d.energyCostKrw), Math.round(d.revenueKrw - d.energyCostKrw), d.soldQty.toFixed(8), Math.round(d.proceedsKrw), Math.round(d.feeKrw), d.est.mined || d.est.revenue || d.est.energy ? 'yes' : 'no']);
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
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
      case 'bootstrap': return [iso, e.type, e.coin, e.qty, '', `estimated ${new Date(e.from).toISOString()}~${new Date(e.to).toISOString()} ${e.watts}W ${e.kwh.toFixed(3)}kWh`];
    }
  });
  return [head, ...rows].map((r) => r.map(csvCell).join(',')).join('\n') + '\n';
}
