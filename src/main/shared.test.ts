import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  addPoolIncrease, appendEvent, emptyBook, eventKey, freshPayouts, mergeEvents, readEvents, replayEvents, startTracking, summarizePnl,
  type PnlBook, type PnlEvent,
} from './pnl';
import { emptyLedger, recordEarnings, type Ledger, type Payout } from './profit';
import {
  adoptPoolState, ensureInstanceId, poolStateOf, readPoolState, readSharedEvents, sharedEventsFile, sharedRoot, syncOwnEvents, writeAtomic,
  writePoolState,
} from './shared';

const H = 3_600_000;
const KRW = 2479;
const tmps: string[] = [];
const tmp = () => {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), 'crypthy-shared-'));
  tmps.push(d);
  return d;
};
afterEach(() => tmps.splice(0).forEach((d) => fs.rmSync(d, { recursive: true, force: true })));

/**
 * core.ts 의 풀 조회·기록 흐름을 그대로 따라 하는 인스턴스 (Windows Crypthy 또는 Ubuntu 헤드리스).
 * shared 가 null 이면 공유 장부 없이(단일 장부 기준값) 동작한다.
 */
class Instance {
  ledger: Ledger = emptyLedger();
  book: PnlBook = emptyBook();
  poolGen = 0;
  events: string;
  seq = 0;
  constructor(public id: string, public shared: string | null, dataDir = tmp()) {
    this.events = path.join(dataDir, 'pnl', 'events.jsonl');
  }
  log(ev: PnlEvent, legacy = false) {
    appendEvent(this.events, legacy ? ev : { ...ev, id: `${this.id}-${this.seq++}` });
  }
  syncIn() {
    if (!this.shared) return;
    const st = readPoolState(sharedRoot(this.shared));
    if (!st || st.gen <= this.poolGen) return;
    this.ledger = adoptPoolState(this.ledger, st);
    if (st.lastMinedAt !== null) this.book.lastMinedAt = Math.max(this.book.lastMinedAt ?? 0, st.lastMinedAt);
    this.poolGen = st.gen;
  }
  syncOut() {
    if (!this.shared) return;
    const root = sharedRoot(this.shared);
    const gen = Math.max(this.poolGen, readPoolState(root)?.gen ?? 0) + 1;
    writePoolState(root, poolStateOf(this.ledger, this.book.lastMinedAt, gen, this.id));
    this.poolGen = gen;
  }
  /** 풀 잔액·지급 조회 1회 (core.refreshRemote 의 풀 부분) */
  observe(t: number, balance: number, payouts: Payout[], legacy = false) {
    this.syncIn();
    const prev = this.ledger.lastTotal;
    const fresh = freshPayouts(new Set(this.ledger.seenPayouts), payouts);
    this.ledger = recordEarnings(this.ledger, balance, payouts, t);
    for (const p of fresh) this.log({ t, type: 'payout', coin: 'pearl', key: p.key, amount: p.amount, at: p.at }, legacy);
    if (this.ledger.lastTotal !== null && this.ledger.lastTotal !== prev) {
      this.log({ t, type: 'pool', coin: 'pearl', total: this.ledger.lastTotal }, legacy);
      if (prev === null) startTracking(this.book, 'pearl', t, this.ledger.lastTotal);
      else if (this.ledger.lastTotal > prev) {
        const qty = this.ledger.lastTotal - prev;
        const from = this.book.lastMinedAt ?? undefined;
        addPoolIncrease(this.book, 'pearl', t, qty, KRW);
        this.log({ t, type: 'mined', coin: 'pearl', qty, krwPerCoin: KRW, from }, legacy);
      }
      this.syncOut();
    }
  }
  energy(start: number, end: number, watts: number, legacy = false) {
    this.log({ t: end, type: 'energy', start, end, avgW: watts, kwh: (watts * (end - start)) / H / 1000, krwPerKwh: 350 }, legacy);
  }
  push() {
    if (this.shared) syncOwnEvents(this.events, sharedEventsFile(sharedRoot(this.shared), this.id));
  }
}

/** 풀 시뮬레이션: 매시간 0.3 PRL, 15시에 2.0 지급 (잔액이 줄고 지급 내역이 생김) */
const day = (d: number, h: number) => new Date(2026, 9, d, h).getTime();
function pool(t: number): { balance: number; payouts: Payout[] } {
  const mined = 1 + ((t - day(18, 9)) / H) * 0.3; // 09시에 이미 1.0 (추적 전 채굴분)
  const paid = t >= day(18, 15) ? [{ key: 'tx1', amount: 2, at: day(18, 15) }] : [];
  return { balance: mined - paid.reduce((a, p) => a + p.amount, 0), payouts: paid };
}

/** 같은 관측을 한 장부로 했을 때 (기준값) */
function reference(times: number[], energy: [number, number][]) {
  const one = new Instance('single', null);
  for (const t of times) one.observe(t, pool(t).balance, pool(t).payouts);
  for (const [s, e] of energy) one.energy(s, e, 865);
  return replayEvents(mergeEvents([{ src: 'single', events: readEvents(one.events) }]), 'pearl').book;
}

const hours = (from: number, to: number) => Array.from({ length: Math.floor((to - from) / H) + 1 }, (_, i) => from + i * H);

describe('shared ledger across a dual boot (Windows ↔ Ubuntu, never at the same time)', () => {
  const winTimes = hours(day(18, 9), day(18, 20));
  const linTimes = hours(day(18, 22), day(19, 7));
  const win2Times = hours(day(19, 9), day(19, 12));
  const winEnergy: [number, number][] = [[day(18, 9), day(18, 20)], [day(19, 9), day(19, 12)]];
  const linEnergy: [number, number][] = [[day(18, 22), day(19, 7)]];

  function run(shared: string, copyWindowsIntoUbuntu: boolean) {
    const win = new Instance('windows-aaaaaa', shared);
    const lin = new Instance('linux-bbbbbb', shared);
    // Windows: 공유 장부 이전부터 쓰던 기록 (id 없는 0.4.0 이전 줄)
    for (const t of winTimes) win.observe(t, pool(t).balance, pool(t).payouts, true);
    win.energy(...winEnergy[0], 865, true);
    if (copyWindowsIntoUbuntu) {
      // 2026-10-18 실기: Windows 데이터를 헤드리스로 한 번 복사해 이어 붙임
      fs.mkdirSync(path.dirname(lin.events), { recursive: true });
      fs.copyFileSync(win.events, lin.events);
      lin.ledger = structuredClone(win.ledger);
      lin.book = structuredClone(win.book);
    }
    win.push(); // Windows 에서 공유 장부를 켬 → 기존 장부를 자기 파일로 내보냄
    // Ubuntu 부팅: 다른 OS 가 마지막에 쓴 기준점을 받아 그 이후 증가분만 기록
    lin.push();
    for (const t of linTimes) lin.observe(t, pool(t).balance, pool(t).payouts);
    lin.energy(...linEnergy[0], 865);
    lin.push();
    // 다시 Windows
    for (const t of win2Times) win.observe(t, pool(t).balance, pool(t).payouts);
    win.energy(...winEnergy[1], 865);
    win.push();
    return replayEvents(mergeEvents(readSharedEvents(sharedRoot(shared))), 'pearl');
  }

  const ref = reference([...winTimes, ...linTimes, ...win2Times], [...winEnergy, ...linEnergy]);
  const refSum = summarizePnl(ref, 'pearl', day(19, 12), KRW);

  it('cumulative PnL equals one single ledger (pool increases counted once, payout once)', () => {
    const merged = run(tmp(), false);
    const s = summarizePnl(merged.book, 'pearl', day(19, 12), KRW);
    expect(s.all.mined).toBeCloseTo(refSum.all.mined, 9);
    expect(s.all.revenueKrw).toBeCloseTo(refSum.all.revenueKrw, 6);
    expect(s.all.energyCostKrw).toBeCloseTo(refSum.all.energyCostKrw, 6);
    // 09시(1.0, 추적 기준점) ~ 다음날 12시: 27시간 × 0.3 = 8.1 PRL (2.0 지급은 채굴량이 아니다)
    expect(s.all.mined).toBeCloseTo(27 * 0.3, 9);
    expect(merged.book.trackStart).toEqual({ at: day(18, 9), total: 1 });
    expect(merged.overlaps).toBe(0);
    // 날짜별로도 같다 (자정 분할 포함)
    expect(summarizePnl(merged.book, 'pearl', day(18, 23), KRW).today.mined).toBeCloseTo(summarizePnl(ref, 'pearl', day(18, 23), KRW).today.mined, 9);
  });

  it('the Windows data copied into Ubuntu (2026-10-18) is not counted twice', () => {
    const merged = run(tmp(), true);
    const s = summarizePnl(merged.book, 'pearl', day(19, 12), KRW);
    expect(s.all.mined).toBeCloseTo(refSum.all.mined, 9);
    expect(s.all.energyCostKrw).toBeCloseTo(refSum.all.energyCostKrw, 6);
  });

  it('Ubuntu without the shared folder would double count — the case this fixes', () => {
    const shared = tmp();
    const win = new Instance('windows-aaaaaa', shared);
    for (const t of winTimes) win.observe(t, pool(t).balance, pool(t).payouts);
    win.push();
    // 공유 기준점 없이 시작한 Ubuntu: 처음 본 누적치가 기준점이 되어 Windows 몫과 기준이 어긋난다
    const lone = new Instance('linux-cccccc', null);
    for (const t of linTimes) lone.observe(t, pool(t).balance, pool(t).payouts);
    const loneBook = replayEvents(mergeEvents([{ src: 'l', events: readEvents(lone.events) }]), 'pearl').book;
    expect(loneBook.trackStart?.total).not.toBe(1); // 기준점이 다름 → 소급하면 Windows 몫을 다시 센다
  });

  it('flags energy records of two instances that overlap in time', () => {
    const shared = tmp();
    const a = new Instance('windows-aaaaaa', shared);
    const b = new Instance('linux-bbbbbb', shared);
    a.energy(day(18, 9), day(18, 12), 865);
    b.energy(day(18, 11), day(18, 13), 865);
    a.push();
    b.push();
    expect(replayEvents(mergeEvents(readSharedEvents(sharedRoot(shared))), 'pearl').overlaps).toBe(1);
  });
});

describe('shared folder files', () => {
  it('appends only the events missing from this instance\'s shared file (offline catch-up, no duplicates)', () => {
    const shared = tmp();
    const inst = new Instance('linux-bbbbbb', shared);
    inst.energy(day(18, 9), day(18, 10), 865);
    inst.push();
    // 공유 폴더가 안 보이던 동안 로컬에만 쌓인 기록
    inst.energy(day(18, 10), day(18, 11), 865);
    inst.energy(day(18, 11), day(18, 12), 865);
    inst.push();
    inst.push();
    const own = readEvents(sharedEventsFile(sharedRoot(shared), 'linux-bbbbbb'));
    expect(own).toHaveLength(3);
    expect(new Set(own.map(eventKey)).size).toBe(3);
  });

  it('skips torn lines and ignores files that are not instance logs', () => {
    const root = sharedRoot(tmp());
    fs.mkdirSync(path.join(root, 'pnl'), { recursive: true });
    fs.writeFileSync(path.join(root, 'pnl', 'events-windows-aaaaaa.jsonl'), '{"t":1,"type":"price","coin":"pearl","usd":1,"krwPerUsd":1}\n{"t":2,"type":"po');
    fs.writeFileSync(path.join(root, 'pnl', 'notes.txt'), 'x');
    fs.writeFileSync(path.join(root, 'pnl', 'events-../evil.jsonl'.replace('/', '_')), '');
    const lists = readSharedEvents(root);
    expect(lists.map((l) => [l.src, l.events.length])).toEqual([['windows-aaaaaa', 1]]);
  });

  it('pool state: newer generation is adopted; same base keeps the high-water mark', () => {
    const root = sharedRoot(tmp());
    expect(readPoolState(root)).toBeNull();
    const l = { ...emptyLedger(), lastTotal: 5, paidTotal: 2, seenPayouts: ['tx1'] };
    writePoolState(root, poolStateOf({ ...l, lastTotal: 6.5, seenPayouts: ['tx1', 'tx2'], paidTotal: 3 }, 123, 4, 'windows-aaaaaa'));
    const st = readPoolState(root)!;
    expect(st).toMatchObject({ gen: 4, by: 'windows-aaaaaa', lastMinedAt: 123 });
    const adopted = adoptPoolState({ ...l, pendingKwh: 1, pendingMs: 9 }, st);
    expect(adopted).toMatchObject({ lastTotal: 6.5, paidTotal: 3, seenPayouts: ['tx1', 'tx2'], pendingKwh: 0, pendingMs: 0 });
  });

  it('atomic write leaves no temp file and replaces the content', () => {
    const f = path.join(tmp(), 'crypthy', 'shared-settings.json');
    writeAtomic(f, 'a');
    writeAtomic(f, 'b');
    expect(fs.readFileSync(f, 'utf8')).toBe('b');
    expect(fs.existsSync(`${f}.tmp`)).toBe(false);
  });

  it('instance id is created once and kept', () => {
    const d = tmp();
    const id = ensureInstanceId(d, 'windows');
    expect(id).toMatch(/^windows-[0-9a-f]{6}$/);
    expect(ensureInstanceId(d, 'windows')).toBe(id);
  });
});
