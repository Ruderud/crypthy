import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addEnergy, addMined, addPending, addPoolIncrease, addSale, appendEvent, bootstrap, dailyCsv, emptyBook, estimateBackfillFrom, eventsCsv,
  freshPayouts, loadBook, pnlDaily, priceUnpriced, readEvents, rotated, separateLegacyBackfill, startTracking, summarizePnl,
} from './pnl';

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crypthy-pnl-'));
const H = 3_600_000;
const KRW = 1.85 * 1340; // 2,479원/PRL

describe('event log', () => {
  it('appends one JSON line per event and skips corrupt lines on read', () => {
    const dir = tmp();
    const f = path.join(dir, 'events.jsonl');
    appendEvent(f, { t: 1, type: 'price', coin: 'pearl', usd: 1.85, krwPerUsd: 1340 });
    fs.appendFileSync(f, '{"t":2,"type":"pool","coin":"pearl","tot'); // 쓰다가 끊긴 줄
    fs.appendFileSync(f, '\nnot json\n{"t":3,"type":"unknown"}\n');
    appendEvent(f, { t: 4, type: 'pool', coin: 'pearl', total: 6.081 });
    expect(readEvents(f).map((e) => e.t)).toEqual([1, 4]);
    fs.rmSync(dir, { recursive: true });
  });

  it('rotates once to .1 when the size cap is reached and keeps reading both', () => {
    const dir = tmp();
    const f = path.join(dir, 'events.jsonl');
    for (let i = 0; i < 20; i++) appendEvent(f, { t: i, type: 'pool', coin: 'pearl', total: i }, 400);
    expect(fs.existsSync(rotated(f))).toBe(true);
    expect(fs.statSync(f).size).toBeLessThanOrEqual(400);
    const ts = readEvents(f).map((e) => e.t);
    expect(ts.at(-1)).toBe(19);
    expect(ts).toEqual([...ts].sort((a, b) => a - b));
    fs.rmSync(dir, { recursive: true });
  });

  it('never throws when the file cannot be written', () => {
    // 일반 파일을 디렉터리처럼 쓰면 모든 OS 에서 쓰기에 실패한다
    const dir = tmp();
    const notADir = path.join(dir, 'file');
    fs.writeFileSync(notADir, 'x');
    expect(appendEvent(path.join(notADir, 'pnl', 'events.jsonl'), { t: 1, type: 'pool', coin: 'p', total: 1 })).toBe(false);
    fs.rmSync(dir, { recursive: true });
  });
});

describe('payout de-duplication', () => {
  it('emits each payout key once (txid), even if repeated in the same response', () => {
    const seen = new Set(['a']);
    expect(freshPayouts(seen, [{ key: 'a', amount: 1 }, { key: 'b', amount: 2, at: 5 }, { key: 'b', amount: 2, at: 5 }])).toEqual([{ key: 'b', amount: 2, at: 5 }]);
  });
});

describe('PnL book', () => {
  const now = new Date(2026, 9, 18, 9, 45).getTime();

  it('values mined coin at mining-time price; unpriced coin is valued later and marked estimated', () => {
    const b = emptyBook();
    addMined(b, 'pearl', now - H, 0.4, KRW);
    addMined(b, 'pearl', now, 0.1, null);
    let s = summarizePnl(b, 'pearl', now, KRW);
    expect(s.today.revenueKrw).toBeCloseTo(0.4 * KRW, 6);
    expect(s.today.estimated).toBe(true); // 미평가분이 남아 있음
    priceUnpriced(b, 'pearl', 2500);
    s = summarizePnl(b, 'pearl', now, KRW);
    expect(s.today.revenueKrw).toBeCloseTo(0.4 * KRW + 0.1 * 2500, 6);
    expect(s.today.estimated).toBe(true);
  });

  it('realized vs unrealized: no sales → everything unrealized; sales reduce holdings', () => {
    const b = emptyBook();
    addMined(b, 'pearl', now, 6.081, KRW);
    addEnergy(b, 'pearl', now, 13.148, 350);
    let s = summarizePnl(b, 'pearl', now, KRW);
    expect(s.realizedKrw).toBe(0);
    expect(s.holdings).toBeCloseTo(6.081, 9);
    expect(Math.round(s.unrealizedKrw!)).toBe(Math.round(6.081 * KRW));
    expect(Math.round(s.totalPnlKrw!)).toBe(Math.round(6.081 * KRW - 13.148 * 350));
    addSale(b, 'pearl', now, 2, 2 * 2600, 20);
    s = summarizePnl(b, 'pearl', now, KRW);
    expect(s.holdings).toBeCloseTo(4.081, 9);
    expect(s.realizedKrw).toBe(5180);
    expect(Math.round(s.totalPnlKrw!)).toBe(Math.round(5180 + 4.081 * KRW - 13.148 * 350));
  });

  it('no current price → unrealized/total are null (never 0)', () => {
    const b = emptyBook();
    addMined(b, 'pearl', now, 1, KRW);
    const s = summarizePnl(b, 'pearl', now, null);
    expect(s.unrealizedKrw).toBeNull();
    expect(s.totalPnlKrw).toBeNull();
  });

  it('periods: today / 7 days / 30 days / all', () => {
    const b = emptyBook();
    const dayAgo = (n: number) => new Date(2026, 9, 18 - n, 12).getTime();
    for (const n of [0, 3, 6, 7, 29, 40]) addMined(b, 'pearl', dayAgo(n), 1, 1000);
    const s = summarizePnl(b, 'pearl', now, 1000);
    expect([s.today.mined, s.d7.mined, s.d30.mined, s.all.mined]).toEqual([1, 3, 5, 6]);
  });

  it('daily series is sorted with a running cumulative total', () => {
    const b = emptyBook();
    addMined(b, 'pearl', new Date(2026, 9, 17, 12).getTime(), 1, 1000);
    addEnergy(b, 'pearl', new Date(2026, 9, 17, 12).getTime(), 1, 300);
    addMined(b, 'pearl', new Date(2026, 9, 18, 12).getTime(), 2, 1000);
    expect(pnlDaily(b, 'pearl').map((d) => [d.day, d.netKrw, d.cumulativeKrw])).toEqual([
      ['2026-10-17', 700, 700],
      ['2026-10-18', 2000, 2700],
    ]);
  });
});

// RUD 실측: 추적 시작(2026-10-18 09:45) 시점 풀 누적 6.081 PRL, 채굴 시작 15.2시간 전, GPU 합 865W, $1.85 × 1340원
describe('bootstrap (backfill before tracking started)', () => {
  const to = new Date(2026, 9, 18, 9, 45).getTime();
  const from = to - 15.2 * H;

  it('spreads coins by time across local days, estimates energy from watts, marks everything estimated', () => {
    const b = emptyBook();
    const r = bootstrap(b, { coin: 'pearl', from, to, qty: 6.081, watts: 865, krwPerKwh: 350, closeKrwByDay: {}, fallbackKrw: KRW });
    expect(r.days).toBe(2);
    expect(r.kwh).toBeCloseTo(13.148, 3);
    const days = pnlDaily(b, 'pearl');
    expect(days.map((d) => d.day)).toEqual(['2026-10-17', '2026-10-18']);
    expect(days.every((d) => d.estimated)).toBe(true);
    const s = summarizePnl(b, 'pearl', to, KRW);
    expect(s.all.mined).toBeCloseTo(6.081, 9);
    // 매출 6.081 × 2,479 = 15,075원, 전력 13.148kWh × 350 = 4,602원 → 순익 약 +10,473원
    expect(Math.round(s.all.revenueKrw)).toBe(15075);
    expect(Math.round(s.all.energyCostKrw)).toBe(4602);
    expect(Math.round(s.totalPnlKrw!)).toBe(10473);
    expect(s.estimated).toBe(true);
    expect(b.bootstrapped).toBe(true);
  });

  it('uses daily closes when available', () => {
    const b = emptyBook();
    bootstrap(b, { coin: 'pearl', from, to, qty: 6.081, watts: 0, krwPerKwh: 350, closeKrwByDay: { '2026-10-17': 2000, '2026-10-18': 2500 }, fallbackKrw: null });
    const d = b.backfill!.days;
    expect(d['2026-10-17'].revenueKrw / d['2026-10-17'].mined).toBeCloseTo(2000, 6);
    expect(d['2026-10-18'].revenueKrw / d['2026-10-18'].mined).toBeCloseTo(2500, 6);
    expect(d['2026-10-17'].energyKwh).toBe(0);
    expect(b.days).toEqual({}); // 소급분은 일별 장부와 따로 둔다
  });
});

// RUD 실기(v0.3.6 피드백): 10/17 15:07 채굴 시작, 지급 10/18 01:07 1.2443 · 08:07 1.4030, 잔액 3.4336 @ 10/18 09:45 → 풀 누적 6.0809 PRL.
// 865W, $1.85 × 1340원 = 2,479원/PRL, 350원/kWh. 앱은 09:45 에 처음 풀 누적치를 받았다.
describe('today / this month profit (auto backfill, live estimate, midnight split)', () => {
  const at = (d: number, h: number, m = 0) => new Date(2026, 9, d, h, m).getTime();
  const start = at(17, 15, 7);
  const track = at(18, 9, 45);
  const total = 1.2443 + 1.403 + 3.4336;
  const hours = (track - start) / H; // 18.63h
  const payouts = [at(18, 1, 7), at(18, 8, 7)];

  const tracked = () => {
    const b = emptyBook();
    startTracking(b, 'pearl', track, total);
    return b;
  };
  const autoBackfill = (b: ReturnType<typeof emptyBook>, coinPerHour: number) => {
    const from = estimateBackfillFrom({ to: track, qty: total, coinPerHour, earliestPayoutAt: Math.min(...payouts) });
    bootstrap(b, { coin: 'pearl', from: from!, to: track, qty: total, watts: 865, krwPerKwh: 350, closeKrwByDay: {}, fallbackKrw: KRW, auto: true });
    return from;
  };

  it('estimates the mining start from pool total ÷ expected rate, never after the earliest payout', () => {
    expect(estimateBackfillFrom({ to: track, qty: total, coinPerHour: total / hours, earliestPayoutAt: payouts[0] })).toBe(start);
    // 속도를 크게 잡아도 첫 지급(01:07)보다 늦지는 않는다
    expect(estimateBackfillFrom({ to: track, qty: total, coinPerHour: 2, earliestPayoutAt: payouts[0] })).toBe(payouts[0]);
    expect(estimateBackfillFrom({ to: track, qty: total, coinPerHour: null, earliestPayoutAt: payouts[0] })).toBeNull();
    expect(estimateBackfillFrom({ to: track, qty: total, coinPerHour: 1e-9, earliestPayoutAt: null })).toBe(track - 366 * 86_400_000);
  });

  it('this month includes the 6.08 PRL mined before the app saw the pool; today gets its time share', () => {
    const b = tracked();
    expect(autoBackfill(b, total / hours)).toBe(start);
    const s = summarizePnl(b, 'pearl', track, KRW);
    expect(s.month.mined).toBeCloseTo(6.0809, 9);
    expect(s.month.backfill).toBeCloseTo(6.0809, 9);
    // 이번 달: 매출 6.0809 × 2,479 = 15,075원, 전력 0.865kW × 18.63h × 350 = 5,641원 → +9,433원
    expect(Math.round(s.month.revenueKrw)).toBe(15075);
    expect(Math.round(s.month.energyCostKrw)).toBe(5641);
    expect(Math.round(s.month.netKrw)).toBe(9433);
    // 오늘(00:00~09:45 = 9.75h 몫): 3.1818 PRL → 7,888원 − 2,952원 = +4,936원
    expect(s.today.mined).toBeCloseTo((total * 9.75) / hours, 9);
    expect(Math.round(s.today.netKrw)).toBe(4936);
    expect(s.today.estimated).toBe(true);
    expect(s.holdings).toBeCloseTo(6.0809, 9);
  });

  it('live estimate counts until the pool confirms it, then is replaced (no double count)', () => {
    const b = tracked();
    autoBackfill(b, total / hours);
    const base = summarizePnl(b, 'pearl', track, KRW).today;
    for (let m = 1; m <= 60; m++) addPending(b, 'pearl', track + m * 60_000, 0.33 / 60);
    addEnergy(b, 'pearl', track + H, 0.865, 350);
    let s = summarizePnl(b, 'pearl', track + H, KRW);
    expect(s.today.pending).toBeCloseTo(0.33, 9);
    expect(s.today.mined).toBeCloseTo(base.mined + 0.33, 9);
    expect(Math.round(s.today.netKrw - base.netKrw)).toBe(Math.round(0.33 * KRW - 0.865 * 350));
    expect(s.holdings).toBeCloseTo(6.0809, 9); // 아직 풀에 없는 몫은 보유량에 넣지 않는다
    addPoolIncrease(b, 'pearl', track + H, 0.31, KRW);
    s = summarizePnl(b, 'pearl', track + H, KRW);
    expect(s.today.pending).toBe(0);
    expect(s.today.confirmed).toBeCloseTo(0.31, 9);
    expect(s.today.mined).toBeCloseTo(base.mined + 0.31, 9);
  });

  it('splits a pool increase that spans midnight by time', () => {
    const b = tracked();
    addPoolIncrease(b, 'pearl', at(18, 23), 0, KRW); // 마지막 증가 23:00
    addPoolIncrease(b, 'pearl', at(19, 1), 0.6, KRW); // 01:00 에 0.6 증가 → 1시간씩
    const d = pnlDaily(b, 'pearl', KRW);
    expect(d.map((x) => x.day)).toEqual(['2026-10-18', '2026-10-19']);
    expect(summarizePnl(b, 'pearl', at(19, 1), KRW).today.confirmed).toBeCloseTo(0.3, 9);
    expect(summarizePnl(b, 'pearl', at(18, 23, 59), KRW).today.confirmed).toBeCloseTo(0.3, 9);
  });

  it('recalculating the backfill by hand replaces the previous one', () => {
    const b = tracked();
    autoBackfill(b, total / hours);
    bootstrap(b, { coin: 'pearl', from: at(17, 21), to: track, qty: total, watts: 700, krwPerKwh: 350, closeKrwByDay: {}, fallbackKrw: KRW });
    const s = summarizePnl(b, 'pearl', track, KRW);
    expect(s.all.mined).toBeCloseTo(6.0809, 9);
    expect(s.all.energyCostKrw).toBeCloseTo(0.7 * ((track - at(17, 21)) / H) * 350, 6);
    expect(b.backfill!.auto).toBe(false);
  });

  it('a 0.3.4 backfill merged into the daily book is separated so it can be recalculated', () => {
    const b = tracked();
    addMined(b, 'pearl', at(18, 11), 0.5, KRW); // 추적 시작 후 확정분
    const legacy = emptyBook();
    bootstrap(legacy, { coin: 'pearl', from: start, to: track, qty: total, watts: 865, krwPerKwh: 350, closeKrwByDay: {}, fallbackKrw: KRW });
    for (const [day, d] of Object.entries(legacy.backfill!.days)) {
      const t = new Date(`${day}T06:00:00`).getTime();
      addMined(b, 'pearl', t, d.mined, KRW);
      addEnergy(b, 'pearl', t, d.energyKwh, 350);
    }
    b.bootstrapped = true;
    const before = summarizePnl(b, 'pearl', track, KRW).all;
    expect(separateLegacyBackfill(b, { coin: 'pearl', from: start, to: track, qty: total, watts: 865 })).toBe(true);
    const after = summarizePnl(b, 'pearl', track, KRW).all;
    expect(after.confirmed).toBeCloseTo(0.5, 9);
    expect(after.backfill).toBeCloseTo(total, 9);
    expect(after.netKrw).toBeCloseTo(before.netKrw, 6);
    bootstrap(b, { coin: 'pearl', from: start, to: track, qty: total, watts: 865, krwPerKwh: 350, closeKrwByDay: {}, fallbackKrw: KRW });
    expect(summarizePnl(b, 'pearl', track, KRW).all.mined).toBeCloseTo(total + 0.5, 9);
  });
});

describe('persistence and export', () => {
  it('loadBook drops junk and round-trips', () => {
    const b = emptyBook();
    addMined(b, 'pearl', Date.now(), 1, 1000);
    startTracking(b, 'pearl', new Date(2026, 9, 18, 9, 45).getTime(), 6.081);
    bootstrap(b, { coin: 'pearl', from: new Date(2026, 9, 17, 15, 7).getTime(), to: b.trackStart!.at, qty: 6.081, watts: 865, krwPerKwh: 350, closeKrwByDay: {}, fallbackKrw: 2479, auto: true });
    addPending(b, 'pearl', new Date(2026, 9, 18, 10).getTime(), 0.1);
    expect(loadBook(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(loadBook({ days: { x: { coin: 1 }, y: null } })).toEqual(emptyBook());
  });

  it('CSV escapes quotes/commas and neutralizes formula-like text', () => {
    const csv = eventsCsv([{ t: 0, type: 'sale', coin: 'pearl', qty: 1, proceedsKrw: 2500, feeKrw: 5, venue: '=HYPERLINK("x")', note: 'a,b' }]);
    expect(csv.split('\n')[1]).toBe(`1970-01-01T00:00:00.000Z,sale,pearl,1,2495,"'=HYPERLINK(""x"") a,b"`);
    const b = emptyBook();
    addMined(b, 'pearl', new Date(2026, 9, 18, 12).getTime(), 1, 1000);
    expect(dailyCsv(b).split('\n')[1]).toBe('pearl,2026-10-18,1.00000000,1000,0.00000000,0.000,0,1000,0.00000000,0,0,no,0.00000000');
  });
});
