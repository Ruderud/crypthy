import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  addEnergy, addMined, addSale, appendEvent, bootstrap, dailyCsv, emptyBook, eventsCsv, freshPayouts, loadBook, pnlDaily,
  priceUnpriced, readEvents, rotated, summarizePnl,
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
    const d = Object.values(b.days).sort((a, z) => a.day.localeCompare(z.day));
    expect(d[0].revenueKrw / d[0].mined).toBeCloseTo(2000, 6);
    expect(d[1].revenueKrw / d[1].mined).toBeCloseTo(2500, 6);
    expect(d[0].energyKwh).toBe(0);
  });
});

describe('persistence and export', () => {
  it('loadBook drops junk and round-trips', () => {
    const b = emptyBook();
    addMined(b, 'pearl', Date.now(), 1, 1000);
    b.trackStart = { at: 1, total: 6.081 };
    expect(loadBook(JSON.parse(JSON.stringify(b)))).toEqual(b);
    expect(loadBook({ days: { x: { coin: 1 }, y: null } })).toEqual(emptyBook());
  });

  it('CSV escapes quotes/commas and neutralizes formula-like text', () => {
    const csv = eventsCsv([{ t: 0, type: 'sale', coin: 'pearl', qty: 1, proceedsKrw: 2500, feeKrw: 5, venue: '=HYPERLINK("x")', note: 'a,b' }]);
    expect(csv.split('\n')[1]).toBe(`1970-01-01T00:00:00.000Z,sale,pearl,1,2495,"'=HYPERLINK(""x"") a,b"`);
    const b = emptyBook();
    addMined(b, 'pearl', new Date(2026, 9, 18, 12).getTime(), 1, 1000);
    expect(dailyCsv(b).split('\n')[1]).toBe('pearl,2026-10-18,1.00000000,1000,0.00000000,0.000,0,1000,0.00000000,0,0,no');
  });
});
