import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { checkBook, DEFAULT_AUTOSELL, floorPrice, nextRunAt, quotePrice, runAutoSell, validateAutoSell, type AutoSellConfig, type SellClient } from './autosell';
import { ExchangeError, type Depth, type MarketInfo, type Order } from './safetrade';
import { claimAutoSellDay } from './shared';

const PRL: MarketInfo = { id: 'prlusdt', amountPrecision: 4, pricePrecision: 2, minAmount: 2, minPrice: 0.01, state: 'enabled' };
// 2026-10-19 실측 호가 (매도 1.97 / 매수 1.96, 24시간 평균 1.88)
const BOOK: Depth = { asks: [[1.97, 2971], [1.98, 10578]], bids: [[1.96, 2505], [1.95, 20306]] };

/**
 * 모의 거래소: 주문마다 fill(price, amount) 로 그 대기 시간 동안 체결될 양을 정한다.
 */
function exchange(o: { prl?: number; book?: Depth; avg?: number; fill?: (price: number, amount: number, n: number) => number; failCreate?: ExchangeError }) {
  const log: string[] = [];
  const orders = new Map<number, Order>();
  let seq = 0;
  const client: SellClient = {
    market: async () => PRL,
    depth: async () => o.book ?? BOOK,
    ticker: async () => ({ avgPrice: o.avg ?? 1.88, last: 1.96 }),
    balances: async () => ({ prl: { available: o.prl ?? 100, locked: 0 }, usdt: { available: 5, locked: 0 } }),
    async sellLimit(_m, amount, price) {
      if (o.failCreate) {
        orders.set(++seq, { id: seq, market: 'prlusdt', side: 'sell', type: 'limit', state: 'wait', price, originAmount: amount, filledAmount: 0, avgPrice: 0 });
        log.push(`create? ${amount}@${price}`);
        throw o.failCreate;
      }
      const id = ++seq;
      const filled = Math.min(amount, o.fill ? o.fill(price, amount, id) : amount);
      orders.set(id, { id, market: 'prlusdt', side: 'sell', type: 'limit', state: filled >= amount ? 'done' : 'wait', price, originAmount: amount, filledAmount: filled, avgPrice: filled ? price : 0 });
      log.push(`sell ${amount}@${price}`);
      return { ...orders.get(id)! };
    },
    order: async (id) => ({ ...orders.get(id)! }),
    async cancel(id) {
      const x = orders.get(id)!;
      if (x.state === 'wait') x.state = 'cancel';
      log.push(`cancel ${id}`);
    },
    fills: async (_m, id) => {
      const x = orders.get(id)!;
      return x.filledAmount ? [{ amount: x.filledAmount, price: x.price, total: x.filledAmount * x.price, fee: x.filledAmount * x.price * 0.001, feeCurrency: 'usdt' }] : [];
    },
    openSells: async () => [...orders.values()].filter((x) => x.state === 'wait'),
  };
  return { client, log, orders };
}

const cfg = (p: Partial<AutoSellConfig> = {}): AutoSellConfig => ({ ...DEFAULT_AUTOSELL, enabled: true, dryRun: false, ...p });
const deps = (client: SellClient, p: { ref?: number | null; soldToday?: number } = {}) => ({
  client,
  sleep: async () => undefined,
  now: () => Date.UTC(2026, 9, 19, 1),
  refPriceUsd: () => (p.ref === undefined ? 1.9 : p.ref),
  soldTodayPrl: p.soldToday ?? 0,
  day: '2026-10-19',
});

describe('auto sell: price and floor', () => {
  it('quotes one tick below the best ask, never below the floor', () => {
    expect(quotePrice(1.97, 1.8, 2)).toBe(1.96);
    expect(quotePrice(1.97, 1.97, 2)).toBe(1.97);
    // 하한가 = max(최저가, 기준가 × (1 − 5%)) = max(0, 1.9 × 0.95 = 1.805) → 1.81 (올림)
    expect(floorPrice(cfg(), 1.9, 2)).toBe(1.81);
    expect(floorPrice(cfg({ floorUsd: 2.1 }), 1.9, 2)).toBe(2.1);
  });

  it('dry-run only plans: no order is placed', async () => {
    const ex = exchange({});
    const r = await runAutoSell(cfg({ dryRun: true, orderMaxUsd: 50 }), deps(ex.client));
    expect(r).toMatchObject({ status: 'planned', plan: { price: 1.96, amount: 25.5102 }, floorUsd: 1.81, refUsd: 1.9 });
    expect(ex.log).toEqual([]);
  });

  it('reference price is the higher of the 24h average and CoinGecko; none → no sale', async () => {
    expect((await runAutoSell(cfg({ dryRun: true }), deps(exchange({ avg: 2.2 }).client, { ref: 1.9 }))).refUsd).toBe(2.2);
    const none = await runAutoSell(cfg(), deps(exchange({ avg: Number.NaN }).client, { ref: null }));
    expect(none).toMatchObject({ status: 'skipped', reason: expect.stringContaining('기준가') });
  });

  it('never sells below the floor, even when the market is lower', async () => {
    const ex = exchange({ book: { asks: [[1.5, 5000]], bids: [[1.49, 5000]] }, fill: (price) => (price < 1.81 ? 999 : 0) });
    const r = await runAutoSell(cfg({ maxReprices: 3 }), deps(ex.client));
    expect(ex.log.filter((l) => l.startsWith('sell')).every((l) => Number(l.split('@')[1]) >= 1.81)).toBe(true);
    expect(r.soldPrl).toBe(0);
    expect(r.status).toBe('nothing');
  });
});

describe('auto sell: abnormal order book → no sale that day', () => {
  it('wide spread, thin bids, empty or crossed book', async () => {
    const cases: [Depth, RegExp][] = [
      [{ asks: [[2.2, 100]], bids: [[1.96, 5000]] }, /스프레드/],
      [{ asks: [[1.97, 100]], bids: [[1.96, 10]] }, /깊이/],
      [{ asks: [], bids: [[1.96, 5000]] }, /비어/],
      [{ asks: [[1.95, 100]], bids: [[1.96, 5000]] }, /꼬였/],
    ];
    for (const [book, why] of cases) {
      const ex = exchange({ book });
      const r = await runAutoSell(cfg(), deps(ex.client));
      expect(r.status).toBe('skipped');
      expect(r.reason).toMatch(why);
      expect(ex.log).toEqual([]);
    }
    expect('skip' in checkBook(BOOK, cfg())).toBe(false);
  });

  it('a book that turns bad mid-run stops further orders but records what was sold, with proceeds and fees', async () => {
    const ex = exchange({ prl: 60 });
    let calls = 0;
    ex.client.depth = async () => (++calls === 1 ? BOOK : { asks: [[2.5, 100]], bids: [[1.96, 5000]] });
    const r = await runAutoSell(cfg({ orderMaxUsd: 20 }), deps(ex.client));
    expect(r.status).toBe('partial');
    expect(r.reason).toMatch(/스프레드/);
    expect(r.soldPrl).toBeCloseTo(10.2040, 4);
    expect(r.proceedsUsdt).toBeCloseTo(10.204 * 1.96, 3);
    expect(r.feeUsdt).toBeGreaterThan(0);
  });
});

describe('auto sell: orders', () => {
  it('splits by the per-order cap and sells everything above the floor', async () => {
    const ex = exchange({ prl: 60 });
    const r = await runAutoSell(cfg({ orderMaxUsd: 50, dailyMaxPrl: 50 }), deps(ex.client));
    expect(r.status).toBe('sold');
    expect(r.soldPrl).toBeCloseTo(50, 6);
    expect(r.orders.every((o) => o.price * o.amount <= 50 + 1e-9)).toBe(true);
    expect(r.orders.every((o) => o.price === 1.96)).toBe(true); // 다 체결되면 값을 내리지 않는다
    expect(r.proceedsUsdt).toBeCloseTo(50 * 1.96, 4);
    expect(r.feeUsdt).toBeCloseTo(50 * 1.96 * 0.001, 6);
  });

  it('partial fill → cancel → reprice one step lower → filled', async () => {
    let n = 0;
    const ex = exchange({ prl: 20, fill: (_p, amount) => (++n === 1 ? amount / 2 : amount) });
    const r = await runAutoSell(cfg({ orderMaxUsd: 100 }), deps(ex.client));
    expect(ex.log).toEqual(['sell 20@1.96', 'cancel 1', 'sell 10@1.95']);
    expect(r).toMatchObject({ status: 'sold', soldPrl: 20 });
    expect(r.orders.map((o) => [o.price, o.filled])).toEqual([[1.96, 10], [1.95, 10]]);
  });

  it('stops after the reprice limit with a partial result', async () => {
    const ex = exchange({ prl: 20, fill: () => 0 });
    const r = await runAutoSell(cfg({ orderMaxUsd: 100, maxReprices: 2 }), deps(ex.client));
    expect(ex.log.filter((l) => l.startsWith('sell'))).toHaveLength(3);
    expect(r.status).toBe('nothing');
  });

  it('keeps the reserve and the daily limit', async () => {
    const ex = exchange({ prl: 30 });
    expect((await runAutoSell(cfg({ reservePrl: 10, orderMaxUsd: 1000 }), deps(ex.client))).soldPrl).toBeCloseTo(20, 6);
    const ex2 = exchange({ prl: 100 });
    expect((await runAutoSell(cfg({ dailyMaxPrl: 50, orderMaxUsd: 1000 }), deps(ex2.client, { soldToday: 45 }))).soldPrl).toBeCloseTo(5, 6);
    const ex3 = exchange({ prl: 100 });
    expect((await runAutoSell(cfg({ dailyMaxPrl: 50, orderMaxUsd: 1000 }), deps(ex3.client, { soldToday: 49 }))).status).toBe('nothing');
    expect(ex3.log).toEqual([]);
  });

  it('an unknown-result order error (5xx) cancels the order it may have placed and stops', async () => {
    const ex = exchange({ failCreate: new ExchangeError('SafeTrade 502: bad gateway', 502) });
    const r = await runAutoSell(cfg(), deps(ex.client));
    expect(r.status).toBe('error');
    expect(ex.log).toEqual(['create? 25.5102@1.96', 'cancel 1']);
  });
});

describe('auto sell: safety stops', () => {
  it('never sells another asset even if the exchange returns a different market', async () => {
    const ex = exchange({});
    ex.client.market = async () => ({ ...PRL, id: 'btcusdt' });
    const r = await runAutoSell(cfg(), deps(ex.client));
    expect(r.status).toBe('skipped');
    expect(ex.log).toEqual([]);
  });

  it('stops before the next order when auto-sell is switched off, and reports progress per order', async () => {
    const ex = exchange({ prl: 60 });
    const progress: number[] = [];
    let n = 0;
    const r = await runAutoSell(cfg({ orderMaxUsd: 20 }), { ...deps(ex.client), shouldStop: () => ++n > 2, onProgress: (p) => progress.push(p.soldPrl) });
    expect(ex.log.filter((l) => l.startsWith('sell'))).toHaveLength(2);
    expect(progress.length).toBe(2);
    expect(progress[1]).toBeCloseTo(r.soldPrl, 6);
    expect(r.reason).toMatch(/꺼서 멈췄/);
  });
});

describe('auto sell: settings and once-per-day across machines', () => {
  it('validates the settings', () => {
    expect(validateAutoSell(DEFAULT_AUTOSELL)).toBeNull();
    // PRL 마켓만, 타입·상한, 실제 매도에는 최저가 필수
    expect(validateAutoSell({ ...DEFAULT_AUTOSELL, market: 'btcusdt' })).toMatch(/prlusdt/);
    expect(validateAutoSell({ ...DEFAULT_AUTOSELL, time: ['10:00'] as unknown as string })).not.toBeNull();
    expect(validateAutoSell({ ...DEFAULT_AUTOSELL, dailyMaxPrl: '50' as unknown as number })).not.toBeNull();
    expect(validateAutoSell({ ...DEFAULT_AUTOSELL, orderMaxUsd: 1e9 })).not.toBeNull();
    expect(validateAutoSell({ ...DEFAULT_AUTOSELL, enabled: true, dryRun: false })).toMatch(/최저가/);
    expect(validateAutoSell({ ...DEFAULT_AUTOSELL, enabled: true, dryRun: false, floorUsd: 1.5 })).toBeNull();
    expect(validateAutoSell({ ...DEFAULT_AUTOSELL, time: '25:00' })).not.toBeNull();
    expect(validateAutoSell({ ...DEFAULT_AUTOSELL, maxDropPct: 0 })).not.toBeNull();
    expect(validateAutoSell({ ...DEFAULT_AUTOSELL, orderMaxUsd: 0 })).not.toBeNull();
  });

  it('runs once a day at the set time', () => {
    const at = (h: number, m = 0, day = 19) => new Date(2026, 9, day, h, m).getTime();
    expect(nextRunAt('10:00', false, at(9))).toBe(at(10)); // 아직 시각 전
    expect(nextRunAt('10:00', false, at(15))).toBe(at(15)); // 지났고 오늘 아직 → 지금
    expect(nextRunAt('10:00', true, at(15))).toBe(at(10, 0, 20)); // 오늘 했으면 내일
    expect(nextRunAt('10:00', true, new Date(2026, 9, 31, 12).getTime())).toBe(new Date(2026, 10, 1, 10).getTime()); // 월말
    expect(nextRunAt('10:00', true, at(9))).toBe(at(10, 0, 20)); // 시각 전에 손으로 이미 했어도 내일
  });

  it('only the first machine gets the day (Windows vs Ubuntu headless)', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'crypthy-claim-'));
    expect(claimAutoSellDay(root, '2026-10-19', 'windows-aaaaaa')).toEqual({ ok: true });
    expect(claimAutoSellDay(root, '2026-10-19', 'linux-bbbbbb')).toEqual({ ok: false, by: 'windows-aaaaaa' });
    expect(claimAutoSellDay(root, '2026-10-20', 'linux-bbbbbb')).toEqual({ ok: true });
    fs.rmSync(root, { recursive: true });
  });
});
