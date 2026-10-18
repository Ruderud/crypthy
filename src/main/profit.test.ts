import { describe, expect, it } from 'vitest';
import {
  dateKey, emptyLedger, migrateLedger, miningNetKrwPerHour, netKrw, powerCostKrwPerHour, prlPerHour,
  recordEarnings, recordEnergy, recordPrice, rentalNetKrwPerHour, reviewAlerts, summarize, type ReviewRow,
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

describe('ledger v2', () => {
  const t0 = new Date(2026, 9, 17, 10, 0).getTime();
  const t1 = new Date(2026, 9, 17, 11, 0).getTime();
  const t2 = new Date(2026, 9, 17, 12, 0).getTime();
  const tomorrow = new Date(2026, 9, 18, 0, 5).getTime();
  const nextMonth = new Date(2026, 10, 1, 0, 5).getTime();
  const H = 3_600_000;

  it('first record only sets the baseline', () => {
    const l = recordEarnings(emptyLedger(), 1.5, [{ key: 'a', amount: 1 }], t0);
    expect(summarize(l, t0, 1, cfg).today.confirmedCoin).toBe(0);
    expect(l.seenPayouts).toEqual(['a']);
    expect(l.lastTotal).toBe(2.5);
  });

  it('counts balance growth plus new payouts, ignores already seen ones', () => {
    let l = recordEarnings(emptyLedger(), 1.5, [{ key: 'a', amount: 1 }], t0);
    l = recordEarnings(l, 0.7, [{ key: 'b', amount: 1 }, { key: 'a', amount: 1 }], t1);
    expect(summarize(l, t1, 1, cfg).today.confirmedCoin).toBeCloseTo(0.2, 10);
    l = recordEarnings(l, 1.0, [{ key: 'b', amount: 1 }], tomorrow);
    const s = summarize(l, tomorrow, 1, cfg);
    expect(s.today.confirmedCoin).toBeCloseTo(0.3, 10);
    expect(s.month.confirmedCoin).toBeCloseTo(0.5, 10);
    expect(summarize(l, nextMonth, 1, cfg).month.confirmedCoin).toBe(0);
  });

  it('does not double count when the payout shows up after the balance drop', () => {
    let l = recordEarnings(emptyLedger(), 1.5, [], t0);
    l = recordEarnings(l, 0.4, [], t1);
    expect(summarize(l, t1, 1, cfg).today.confirmedCoin).toBe(0);
    l = recordEarnings(l, 0.6, [{ key: 'p', amount: 1.2 }], t2);
    expect(summarize(l, t2, 1, cfg).today.confirmedCoin).toBeCloseTo(0.3, 10);
  });

  it('energy: 868W for 1h = 0.868kWh; estimate accrues alongside', () => {
    let l = emptyLedger();
    for (let i = 0; i < 1800; i++) l = recordEnergy(l, 868, 2000, t0 + i * 2000, 0.4 / 1800);
    const t = summarize(l, t1, 1.85, cfg).today;
    expect(t.kwh).toBeCloseTo(0.868, 6);
    expect(t.estCoin).toBeCloseTo(0.4, 6);
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

// RUD 실측 (2026-10-18 09:45 KST): 풀 누적 6.081 PRL(잔액 3.4336 + 지급 1.2443 + 1.4030),
// 실측 0.399 PRL/h, 시세 $1.85, GPU 합 ~865W, 350원/kWh, 1340원/$
describe('regression: measured RUD numbers (2026-10-18)', () => {
  const usd = 1.85;
  const W = 865;
  const H = 3_600_000;
  const start = new Date(2026, 9, 18, 9, 45).getTime();
  const payouts = [{ key: 'p1', amount: 1.2443 }, { key: 'p2', amount: 1.403 }];
  const pool = { netHashrate: 6.5415e19, blockReward: 2246.43, blockTimeS: 194, fee: 0.03 };
  /** 2초 폴링으로 ms 동안 전력·추정 채굴량 누적 */
  const run = (l: ReturnType<typeof emptyLedger>, from: number, ms: number, coinPerH = 0.399) => {
    for (let t = 0; t < ms; t += 2000) l = recordEnergy(l, W, 2000, from + t, (coinPerH * 2000) / H);
    return l;
  };

  it('right after start: no negative net — confirmed is "collecting", estimate is positive', () => {
    let l = recordEarnings(emptyLedger(), 3.4336, payouts, start); // 기준점 = 6.081
    expect(l.lastTotal).toBeCloseTo(6.0809, 4);
    l = run(l, start, 10 * 60_000); // 10분 동안 풀 잔액은 아직 그대로
    const t = summarize(l, start + 10 * 60_000, usd, cfg).today;
    expect(t.status).toBe('collecting');
    expect(t.confirmedNetKrw).toBeNull();
    expect(t.estNetKrw).toBeGreaterThan(0);
    // 수정 전 공식이었다면: 0 PRL − 0.144kWh×350 = 약 −50원 (음수 착시)
    expect(Math.round(0 - t.kwh * 350)).toBe(-50);
  });

  it('matched period: +0.399 PRL after 1h with 0.865 kWh → ≈ +686원/h; 3h → ok', () => {
    let l = recordEarnings(emptyLedger(), 3.4336, payouts, start);
    let total = 3.4336;
    for (let h = 1; h <= 3; h++) {
      l = run(l, start + (h - 1) * H, H);
      total += 0.399;
      l = recordEarnings(l, total, payouts, start + h * H);
    }
    const t = summarize(l, start + 3 * H, usd, cfg).today;
    expect(t.status).toBe('ok');
    expect(t.matchedHours).toBeCloseTo(3, 6);
    expect(t.matchedKwh).toBeCloseTo(2.595, 6);
    expect(t.confirmedNetKrw! / 3).toBeCloseTo(0.399 * 1.85 * 1340 - 0.865 * 350, 3); // 686.35원/h
    expect(Math.round(t.confirmedNetKrw! / 3)).toBe(686);
  });

  it('live estimate from pool stats at ~570 TH/s ≈ 0.352 PRL/h → ≈ +571원/h', () => {
    expect(prlPerHour(570e12, pool)).toBeCloseTo(0.3524, 3);
    expect(Math.round(miningNetKrwPerHour(570e12, W, usd, pool, cfg))).toBe(571);
  });

  it('payout mid-period: balance drops, payout appears later → no double count, energy stays matched', () => {
    let l = recordEarnings(emptyLedger(), 3.4336, payouts, start);
    l = run(l, start, H);
    l = recordEarnings(l, 3.4336 + 0.399, payouts, start + H);
    l = run(l, start + H, H);
    // 3.8326 + 0.399 = 4.2316 중 4.0 지급 → 잔액 0.2316, 지급 내역은 아직 없음
    l = recordEarnings(l, 0.2316, payouts, start + 2 * H);
    l = run(l, start + 2 * H, H);
    l = recordEarnings(l, 0.2316 + 0.399, [...payouts, { key: 'p3', amount: 4.0 }], start + 3 * H);
    const t = summarize(l, start + 3 * H, usd, cfg).today;
    expect(t.matchedCoin).toBeCloseTo(0.399 * 3, 6);
    expect(t.matchedKwh).toBeCloseTo(0.865 * 3, 6);
    expect(t.confirmedNetKrw!).toBeGreaterThan(0);
  });

  it('no price → no net at all (not 0원, not negative)', () => {
    let l = recordEarnings(emptyLedger(), 3.4336, payouts, start);
    l = run(l, start, 4 * H);
    l = recordEarnings(l, 3.4336 + 1.6, payouts, start + 4 * H);
    const t = summarize(l, start + 4 * H, null, cfg).today;
    expect(t.status).toBe('noPrice');
    expect(t.confirmedNetKrw).toBeNull();
    expect(t.estNetKrw).toBeNull();
  });

  it('no hashrate estimate (no miner API) → estimate is null instead of power-only negative', () => {
    let l = recordEarnings(emptyLedger(), 3.4336, payouts, start);
    l = run(l, start, H, 0);
    expect(summarize(l, start + H, usd, cfg).today.estNetKrw).toBeNull();
  });

  it('migrates a 0.3.1 ledger: keeps the cumulative baseline, moves day values out of net', () => {
    const old = { lastTotal: 6.08099, paidTotal: 2.64735, seenPayouts: ['p1', 'p2'], days: { '2026-10-18': { prl: 0.05, kwh: 8.2 }, bad: 1 } };
    const l = migrateLedger(old);
    expect(l).toMatchObject({ version: 2, lastTotal: 6.08099, paidTotal: 2.64735, seenPayouts: ['p1', 'p2'], pendingKwh: 0 });
    expect(l.days['2026-10-18']).toEqual({ prl: 0, kwh: 0, matchedKwh: 0, matchedMs: 0, estPrl: 0, legacyPrl: 0.05, legacyKwh: 8.2 });
    expect(Object.keys(l.days)).toEqual(['2026-10-18']);
    const t = summarize(l, start, usd, cfg).today;
    // 수정 전: 0.05×1.85×1340 − 8.2×350 = −2746원 → 수정 후: 순수익 없음(집계 중), 확정 채굴량은 0.05 그대로 표시
    expect(Math.round(netKrw(0.05, 8.2, usd, cfg))).toBe(-2746);
    expect(t.confirmedNetKrw).toBeNull();
    expect(t.status).toBe('collecting');
    expect(t.confirmedCoin).toBeCloseTo(0.05, 10);
    // 다시 읽어도(v2) 값 유지
    expect(migrateLedger(JSON.parse(JSON.stringify(l)))).toEqual(l);
    expect(migrateLedger(null)).toEqual(emptyLedger());
  });

  it('remembers the last good price with its time', () => {
    const l = recordPrice(emptyLedger(), 1.85, start);
    expect(l.lastPrice).toEqual({ usd: 1.85, at: start });
    expect(recordPrice(l, Number.NaN, start + 1).lastPrice).toEqual({ usd: 1.85, at: start });
  });
});
