import { describe, expect, it } from 'vitest';
import {
  dateKey, emptyLedger, miningNetKrwPerHour, netKrw, powerCostKrwPerHour, prlPerHour,
  recordEarnings, recordEnergy, rentalNetKrwPerHour, reviewAlerts, summarize, type ReviewRow,
} from './profit';

const pool = { netHashrate: 5.8338743692275850e19, blockReward: 2248.01993096, blockTimeS: 194, fee: 0.03 };
const cfg = { krwPerKwh: 350, krwPerUsd: 1340, vastHostShare: 0.75, rentalPowerW: 250, reviewPrlDropPct: 30, baselinePrlUsd: 1.69 };

describe('hourly economics', () => {
  it('prlPerHour follows PPS formula', () => {
    // 354 TH/s, Kryptex pool/stats 예시값 기준 ≈ 0.2455 PRL/h
    expect(prlPerHour(354e12, pool)).toBeCloseTo(0.24554, 4);
    expect(prlPerHour(1e12, { ...pool, netHashrate: 0 })).toBe(0);
  });

  it('power cost: 588W × 350원 = 205.8원/h', () => {
    expect(powerCostKrwPerHour(588, 350)).toBeCloseTo(205.8, 6);
  });

  it('mining net = revenue − power', () => {
    const net = miningNetKrwPerHour(354e12, 588, 1.69, pool, cfg);
    expect(net).toBeCloseTo(prlPerHour(354e12, pool) * 1.69 * 1340 - 205.8, 6);
  });

  it('rental net = price × 75% × fx − rental power', () => {
    expect(Math.round(rentalNetKrwPerHour(0.49, cfg))).toBe(405);
    expect(Math.round(rentalNetKrwPerHour(0.7, { ...cfg, rentalPowerW: 0 }))).toBe(703);
  });
});

describe('reviewAlerts', () => {
  const row = (o: Partial<ReviewRow>): ReviewRow => ({ id: 'a', label: 'GPU A', rentalUsd: 0.6, reviewRentalUsd: 0.7, miningKrwPerH: 500, rentalKrwPerH: 400, ...o });
  it('fires on per-GPU rental price threshold (0 = off)', () => {
    expect(reviewAlerts([row({ rentalUsd: 0.7 })], 1.69, cfg, 0).map((a) => a.code)).toEqual(['review_rental_price']);
    expect(reviewAlerts([row({ rentalUsd: 0.69 })], 1.69, cfg, 0)).toEqual([]);
    expect(reviewAlerts([row({ rentalUsd: 5, reviewRentalUsd: 0 })], 1.69, cfg, 0)).toEqual([]);
  });
  it('fires when rental net beats mining net', () => {
    expect(reviewAlerts([row({ rentalKrwPerH: 501 })], 1.69, cfg, 0).map((a) => a.code)).toEqual(['review_rental_better']);
    expect(reviewAlerts([row({ miningKrwPerH: null, rentalKrwPerH: 9999 })], 1.69, cfg, 0)).toEqual([]);
  });
  it('fires on PRL −30% vs baseline', () => {
    expect(reviewAlerts([], 1.69 * 0.7, cfg, 0).map((a) => a.code)).toEqual(['review_prl']);
    expect(reviewAlerts([], 1.69 * 0.71, cfg, 0)).toEqual([]);
    expect(reviewAlerts([], 0.1, { ...cfg, baselinePrlUsd: 0 }, 0)).toEqual([]);
  });
});

describe('ledger', () => {
  const t0 = new Date(2026, 9, 17, 10, 0).getTime();
  const t1 = new Date(2026, 9, 17, 11, 0).getTime();
  const t2 = new Date(2026, 9, 17, 12, 0).getTime();
  const tomorrow = new Date(2026, 9, 18, 0, 5).getTime();
  const nextMonth = new Date(2026, 10, 1, 0, 5).getTime();

  it('first record only sets the baseline', () => {
    const l = recordEarnings(emptyLedger(), 1.5, [{ key: 'a', amount: 1 }], t0);
    expect(summarize(l, t0).todayPrl).toBe(0);
    expect(l.seenPayouts).toEqual(['a']);
    expect(l.lastTotal).toBe(2.5);
  });

  it('counts balance growth plus new payouts, ignores already seen ones', () => {
    let l = recordEarnings(emptyLedger(), 1.5, [{ key: 'a', amount: 1 }], t0);
    // 1.5 → 0.7 잔액 감소, 하지만 1.0 지급 'b' 발생 → 증가분 0.2
    l = recordEarnings(l, 0.7, [{ key: 'b', amount: 1 }, { key: 'a', amount: 1 }], t1);
    expect(summarize(l, t1).todayPrl).toBeCloseTo(0.2, 10);
    l = recordEarnings(l, 1.0, [{ key: 'b', amount: 1 }], tomorrow);
    const s = summarize(l, tomorrow);
    expect(s.todayPrl).toBeCloseTo(0.3, 10);
    expect(s.monthPrl).toBeCloseTo(0.5, 10);
    expect(summarize(l, nextMonth).monthPrl).toBe(0);
  });

  it('does not double count when the payout shows up after the balance drop', () => {
    let l = recordEarnings(emptyLedger(), 1.5, [], t0);
    // 1.2 PRL 지급으로 잔액이 0.4 로 줄었지만 지급 내역은 아직 없음 (실제 채굴 +0.1)
    l = recordEarnings(l, 0.4, [], t1);
    expect(summarize(l, t1).todayPrl).toBe(0);
    // 지급 내역이 나타남, 그 사이 +0.2 더 채굴 → 총 증가분 0.3
    l = recordEarnings(l, 0.6, [{ key: 'p', amount: 1.2 }], t2);
    expect(summarize(l, t2).todayPrl).toBeCloseTo(0.3, 10);
  });

  it('energy: 868W for 1h = 0.868kWh', () => {
    let l = emptyLedger();
    for (let i = 0; i < 1800; i++) l = recordEnergy(l, 868, 2000, t0 + i * 2000);
    expect(summarize(l, t1).todayKwh).toBeCloseTo(0.868, 6);
    expect(recordEnergy(l, 0, 2000, t1)).toBe(l);
  });

  it('prunes to 62 days', () => {
    let l = recordEarnings(emptyLedger(), 0, [], t0);
    for (let d = 0; d < 80; d++) l = recordEnergy(l, 100, 1000, t0 + d * 86_400_000);
    expect(Object.keys(l.days)).toHaveLength(62);
  });

  it('netKrw = prl×usd×fx − kWh×350', () => {
    expect(netKrw(6, 20, 1.69, cfg)).toBeCloseTo(6 * 1.69 * 1340 - 7000, 6);
  });

  it('dateKey uses local date', () => {
    expect(dateKey(new Date(2026, 0, 5, 23, 59).getTime())).toBe('2026-01-05');
  });
});
