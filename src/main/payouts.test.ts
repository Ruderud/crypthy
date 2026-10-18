// 0.5.0 이하 누적 채굴량 과다(같은 지급을 두 번 셈) 회귀 테스트.
// 수치는 2026-10-19 실측 지급 금액을 쓴다 (지급 + 풀 잔고 = 풀 진실값).
import { describe, expect, it } from 'vitest';
import { addMined, adjustMined, findPayoutDuplicates, mergeEvents, replayEvents, summarizePnl, type PnlEvent } from './pnl';
import { correctPayouts, DRIFT_SETTLE_MS, emptyLedger, migrateLedger, recordEarnings, settleDrift, type Payout } from './profit';
import { adoptPoolState, poolStateOf } from './shared';
import { parseKryptexPayouts } from './remote';

const P1 = 1.24433328;
const P2 = 1.40301829;
const at = (h: number, m = 0, d = 18) => new Date(2026, 9, d, h, m).getTime();
const kx = (rows: { date: number; amount: number; status: string; txid: string | null }[]) =>
  parseKryptexPayouts({ count: rows.length, results: rows.map((r) => ({ ...r, date: String(r.date / 1000), amount: String(r.amount) })) });

describe('pool total = payouts + pool balance', () => {
  it('a payout seen while paying and again when finished is counted once', () => {
    let l = recordEarnings(emptyLedger(), 1.2, [], at(1));
    // 지급 생성: 잔고가 비고 지급 목록에 "지급 중"
    l = recordEarnings(l, 0.0, kx([{ date: at(1, 7), amount: P1, status: 'PENDING', txid: null }]), at(1, 10));
    // 전송 완료: txid 가 생겨도 같은 지급
    l = recordEarnings(l, 0.1, kx([{ date: at(1, 7), amount: P1, status: 'FINISHED', txid: '0x1' }]), at(1, 40));
    expect(l.paidTotal).toBeCloseTo(P1, 8);
    expect(l.lastTotal).toBeCloseTo(P1 + 0.1, 8);
  });

  it('balance reset right after a payout: a short dip does nothing, a lasting gap lowers the cumulative to the pool total', () => {
    let l = recordEarnings(emptyLedger(), 1.2, [], at(1));
    // 지급 목록이 잔고보다 먼저 바뀐 순간: 잠깐 1.2 + P1 로 부풀려진 합계가 high-water 로 남는다
    l = recordEarnings(l, 1.2, kx([{ date: at(1, 7), amount: P1, status: 'PENDING', txid: null }]), at(1, 8));
    const inflated = l.lastTotal!;
    // 5분마다 조회: 잠깐(1시간 미만)은 그대로
    const list = kx([{ date: at(1, 7), amount: P1, status: 'FINISHED', txid: '0x1' }]);
    for (let m = 10; m <= 55; m += 5) l = recordEarnings(l, 0.02, list, at(1, m));
    expect(settleDrift(l, at(1, 55)).gap).toBe(0);
    for (let m = 60; m <= 70; m += 5) l = recordEarnings(l, 0.05, list, at(1, m));
    const s = settleDrift(l, at(2, 10));
    expect(s.gap).toBeCloseTo(inflated - (P1 + 0.05), 8);
    expect(s.ledger.lastTotal).toBeCloseTo(P1 + 0.05, 8);
    // 다시 늘면 진실값 기준으로 이어서 센다
    const next = recordEarnings(s.ledger, 0.15, list, at(3));
    expect(next.lastTotal).toBeCloseTo(P1 + 0.15, 8);
    expect(DRIFT_SETTLE_MS).toBe(3_600_000);
  });

  it('a dip, then hours off (other OS), then another dip is not one long gap', () => {
    let l = recordEarnings(emptyLedger(), 1.2, [], at(1));
    l = recordEarnings(l, 0.5, [], at(1, 5)); // 잠깐 낮음, 그리고 꺼짐
    l = recordEarnings(l, 0.6, [], at(6)); // 몇 시간 뒤 다시 낮음
    expect(settleDrift(l, at(6)).gap).toBe(0);
  });

  it('a payout whose time changes between paying and finished is still counted once', () => {
    let l = recordEarnings(emptyLedger(), 0.5, [], at(1));
    l = recordEarnings(l, 0, kx([{ date: at(1, 7), amount: P1, status: 'PENDING', txid: null }]), at(1, 10));
    l = recordEarnings(l, 0, kx([{ date: at(1, 9), amount: P1, status: 'FINISHED', txid: '0x1' }]), at(1, 15));
    expect(l.paidTotal).toBeCloseTo(P1, 8);
  });

  it('with the full list the payout total follows the list (a paying payout that fails drops out)', () => {
    let l = recordEarnings(emptyLedger(), 0.2, [], at(1), true);
    l = recordEarnings(l, 0, kx([{ date: at(1, 7), amount: P1, status: 'PENDING', txid: null }]), at(1, 10), true);
    expect(l.paidTotal).toBeCloseTo(P1, 8);
    l = recordEarnings(l, P1 + 0.01, [], at(1, 15), true); // 실패해서 잔고로 돌아옴
    expect(l.paidTotal).toBe(0);
    expect(l.lastTotal).toBeCloseTo(P1 + 0.01, 8);
  });

  it('failed or cancelled payouts are not payouts (the coins go back to the balance)', () => {
    expect(kx([{ date: at(1), amount: P1, status: 'FAILED', txid: null }, { date: at(2), amount: P2, status: 'CANCELLED', txid: null }])).toEqual([]);
  });

  it('migrates an old ledger that counted a payout twice (old txid keys) to the pool total', () => {
    // 0.5.0 장부: 지급 중 키(시각:금액)와 txid 키로 P1 을 두 번
    const old = { ...emptyLedger(), payoutKeys: undefined, lastTotal: 0.5 + P1 * 2 + P2, paidTotal: P1 * 2 + P2, seenPayouts: [`${at(1, 7) / 1000}:${P1}`, '0x1', '0x2'] };
    const list: Payout[] = kx([
      { date: at(1, 7), amount: P1, status: 'FINISHED', txid: '0x1' },
      { date: at(8, 7), amount: P2, status: 'FINISHED', txid: '0x2' },
    ]);
    const r = correctPayouts(old, 0.5, list, true, P1, at(12));
    expect(r.excess).toBeCloseTo(P1, 8);
    expect(r.ledger.lastTotal).toBeCloseTo(0.5 + P1 + P2, 8);
    expect(r.ledger.paidTotal).toBeCloseTo(P1 + P2, 8);
    // 이후 같은 목록을 다시 받아도 늘지 않는다
    expect(recordEarnings(r.ledger, 0.5, list, at(12)).lastTotal).toBeCloseTo(0.5 + P1 + P2, 8);
    // 한 번만
    expect(correctPayouts(r.ledger, 0.5, list, true, P1, at(13)).excess).toBe(0);
    expect(r.ledger.legacyOffset).toBeCloseTo(P1, 8);
    // 목록이 일부뿐이면 이벤트에서 찾은 중복만 뺀다
    const partial = correctPayouts(old, 0.5, list.slice(1), false, P1, at(12));
    expect(partial.ledger.lastTotal).toBeCloseTo(0.5 + P1 + P2, 8);
  });

  it('an existing 0.5.0 ledger file is marked for the one-time correction, a new one is not', () => {
    expect(migrateLedger({ version: 2, lastTotal: 13, paidTotal: 11, seenPayouts: ['0x1'], days: {} }).payoutKeys).toBeUndefined();
    expect(migrateLedger(null).payoutKeys).toBe(2);
    expect(migrateLedger({ version: 2, lastTotal: 10.59, paidTotal: 8.8, seenPayouts: [], days: {}, payoutKeys: 2 }).payoutKeys).toBe(2);
  });

  it('a corrected ledger does not take an inflated pool state from an older version on the other OS', () => {
    const fixed = { ...emptyLedger(), lastTotal: 10.59, paidTotal: 8.81, payoutKeys: 2, correctedAt: at(12), legacyOffset: 2.41 };
    // 구버전 기준점은 바로잡은 양만큼 낮춰 본다: 그 사이 구버전이 0.2 더 캤으면 그만큼만 받아들인다
    const oldState = poolStateOf({ ...emptyLedger(), payoutKeys: undefined, lastTotal: 13.2, paidTotal: 11.2 }, 'pearl', null, 9, 'linux-aaaaaa');
    expect(adoptPoolState(fixed, oldState).lastTotal).toBeCloseTo(10.79, 8);
    const newState = poolStateOf({ ...fixed, lastTotal: 10.7 }, 'pearl', null, 10, 'linux-aaaaaa');
    expect(newState.payoutKeys).toBe(2);
    expect(adoptPoolState(fixed, newState).lastTotal).toBe(10.7);
  });

  it('an instance that has not corrected yet takes the corrected (lower) baseline from the other OS', () => {
    const inflated = { ...emptyLedger(), payoutKeys: undefined, lastTotal: 13.0, paidTotal: 11.2 };
    const corrected = poolStateOf({ ...emptyLedger(), lastTotal: 10.59, paidTotal: 8.81, correctedAt: at(12) }, 'pearl', null, 11, 'windows-aaaaaa');
    const l = adoptPoolState(inflated, corrected);
    expect(l.lastTotal).toBe(10.59);
    expect(l.payoutKeys).toBe(2);
    // 바로잡은 뒤 같은 인스턴스가 다시 쓴 기준점은 보통처럼 큰 값
    expect(adoptPoolState(l, { ...corrected, lastTotal: 10.7, gen: 12 }).lastTotal).toBe(10.7);
  });
});

describe('PnL ledger: duplicate payouts across two instances, with backfill', () => {
  // Windows 가 P1 을 "지급 중"(시각:금액 키)으로 기록, 재부팅 뒤 Ubuntu 가 txid 키로 또 기록 → 그 증가분에 P1 이 한 번 더
  const win: PnlEvent[] = [
    { t: at(0), id: 'w1', type: 'pool', coin: 'pearl', total: 0.5 },
    { t: at(0), id: 'w2', type: 'bootstrap', coin: 'pearl', from: at(20, 0, 17), to: at(0), qty: 0.5, watts: 600, kwh: 2.4, auto: true, days: { '2026-10-17': { mined: 0.5, revenueKrw: 1250, unpriced: 0, energyKwh: 2.4, energyCostKrw: 300 } } },
    { t: at(1, 10), id: 'w3', type: 'payout', coin: 'pearl', key: `${at(1, 7) / 1000}:${P1}`, amount: P1, at: at(1, 7) },
    { t: at(1, 10), id: 'w4', type: 'pool', coin: 'pearl', total: 0.5 + P1 + 0.1 },
    { t: at(1, 10), id: 'w5', type: 'mined', coin: 'pearl', qty: P1 + 0.1, krwPerCoin: 2500 },
  ];
  const linux: PnlEvent[] = [
    { t: at(5), id: 'l1', type: 'payout', coin: 'pearl', key: '0x1', amount: P1, at: at(1, 7) },
    { t: at(5), id: 'l2', type: 'pool', coin: 'pearl', total: 0.5 + P1 * 2 + 0.3 },
    { t: at(5), id: 'l3', type: 'mined', coin: 'pearl', qty: P1 + 0.2, krwPerCoin: 2600 },
  ];
  const truth = 0.5 + P1 + 0.3; // 소급(추적 시작 전) + 지급 + 지금 잔고

  it('finds the duplicate in the merged ledger and the correction makes cumulative = pool total', () => {
    const merged = mergeEvents([{ src: 'linux-bbbbbb', events: linux }, { src: 'windows-aaaaaa', events: win }]);
    const dups = findPayoutDuplicates(merged, 'pearl');
    expect(dups).toEqual([{ id: `fix-payout-dup:${at(5)}:0x1`, amount: P1, t: at(5), src: 'linux-bbbbbb', qty: P1, krwPerCoin: 2600, done: false }]);
    const before = summarizePnl(replayEvents(merged, 'pearl').book, 'pearl', at(6), 2600).all;
    expect(before.confirmed + before.backfill).toBeCloseTo(truth + P1, 8);

    const adjust: PnlEvent = { t: at(6), id: dups[0].id, type: 'adjust', coin: 'pearl', qty: -P1, at: dups[0].t, krwPerCoin: 2600, reason: 'payout-dup' };
    // 두 인스턴스가 같은 바로잡기를 써도 한 번만
    const fixed = mergeEvents([{ src: 'linux-bbbbbb', events: [...linux, adjust] }, { src: 'windows-aaaaaa', events: [...win, adjust] }]);
    const after = summarizePnl(replayEvents(fixed, 'pearl').book, 'pearl', at(6), 2600).all;
    expect(after.confirmed + after.backfill).toBeCloseTo(truth, 8);
    expect(after.backfill).toBeCloseTo(0.5, 8); // 소급분은 그대로
    expect(after.revenueKrw).toBeCloseTo(before.revenueKrw - P1 * 2600, 4);
    expect(findPayoutDuplicates(fixed, 'pearl')[0].done).toBe(true);
  });

  it('a correction larger than that day continues into earlier days (an increase split over midnight), backfill untouched', () => {
    const b = replayEvents(mergeEvents([{ src: 'w', events: win }]), 'pearl').book;
    addMined(b, 'pearl', at(23, 0, 17), 0.3, 2400);
    addMined(b, 'pearl', at(0, 30), 0.1, 2500);
    const before = summarizePnl(b, 'pearl', at(1), 2500).all;
    // 오늘(18일) 확정분보다 많은 양: 남는 만큼 17일에서
    const left = adjustMined(b, 'pearl', at(0, 40), -(P1 + 0.1 + 0.2), 2500);
    expect(left).toBe(0);
    const after = summarizePnl(b, 'pearl', at(1), 2500).all;
    expect(before.confirmed - after.confirmed).toBeCloseTo(P1 + 0.3, 8);
    expect(after.backfill).toBe(before.backfill);
    expect(b.days['pearl|2026-10-17'].mined).toBeCloseTo(0.2, 8);
  });

  it('two different payouts with the same amount far apart are not duplicates', () => {
    const ev: PnlEvent[] = [
      { t: at(1), type: 'payout', coin: 'pearl', key: 'a', amount: P1, at: at(1) },
      { t: at(1), type: 'mined', coin: 'pearl', qty: P1, krwPerCoin: 1 },
      { t: at(9, 0, 20), type: 'payout', coin: 'pearl', key: 'b', amount: P1, at: at(9, 0, 20) },
      { t: at(9, 0, 20), type: 'mined', coin: 'pearl', qty: P1, krwPerCoin: 1 },
    ];
    expect(findPayoutDuplicates(ev, 'pearl')).toEqual([]);
  });
});
