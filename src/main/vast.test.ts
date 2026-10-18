import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildVastQuery, vastStats, VAST_MIN_SAMPLES, type VastQuery } from './remote';

/** 0.3.2 이하 알고리즘: 1장·비경매 매물 전체의 dph_total 중앙값 (인증·DLPerf 필터 없음) */
function oldMedian(json: { offers: { num_gpus: number; is_bid: boolean; dph_total: number }[] }): number {
  const p = json.offers.filter((o) => o.num_gpus === 1 && !o.is_bid).map((o) => o.dph_total).sort((a, b) => a - b);
  const m = Math.floor(p.length / 2);
  return p.length % 2 ? p[m] : (p[m - 1] + p[m]) / 2;
}

// 2026-10-18 09:53 KST 실제 공개 검색 응답(필드 일부)
const mixed = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/vast-5090-ondemand.json'), 'utf8'));
const verified = JSON.parse(readFileSync(path.join(__dirname, 'fixtures/vast-5090-ondemand-verified.json'), 'utf8'));
const q = (o: Partial<VastQuery> = {}): VastQuery => ({ gpuName: 'RTX 5090', verifiedOnly: true, type: 'on-demand', regions: [], ...o });
const offer = (o: Record<string, unknown>) => ({ num_gpus: 1, is_bid: false, verification: 'verified', dph_total: 0.8, dlperf: 199, geolocation: 'Texas, US', ...o });

describe('buildVastQuery', () => {
  it('asks the server for verified 1-GPU rentable offers of the chosen type', () => {
    expect(buildVastQuery(q())).toEqual({ gpu_name: { eq: 'RTX 5090' }, num_gpus: { eq: 1 }, rentable: { eq: true }, type: 'on-demand', verified: { eq: true }, limit: 1000 });
    expect(buildVastQuery(q({ verifiedOnly: false, type: 'interruptible' }))).toEqual({ gpu_name: { eq: 'RTX 5090' }, num_gpus: { eq: 1 }, rentable: { eq: true }, type: 'bid', limit: 1000 });
  });
});

describe('vastStats on the real 2026-10-18 response', () => {
  it('unverified/deverified offers drag the median down (before: all offers)', () => {
    const all = vastStats(mixed, q({ verifiedOnly: false }), 1);
    const ver = vastStats(mixed, q(), 1);
    expect(all.total).toBe(64);
    expect(ver.n).toBeLessThan(all.n);
    expect(ver.median!).toBeGreaterThan(all.median!);
    // 개선 전 알고리즘(0.3.2 이하: 필터 없이 64개 중앙값) = $0.699 → 인증 매물만 ≈ $0.85
    expect(oldMedian(mixed)).toBeCloseTo(0.699, 3);
    expect(ver.median!).toBeGreaterThan(0.8);
  });

  it('server-side verified response: median ≈ $0.87 with 25th percentile and sample size', () => {
    const s = vastStats(verified, q(), 42);
    expect(s.status).toBe('ok');
    expect(s.total).toBe(43);
    expect(s.n).toBeGreaterThanOrEqual(VAST_MIN_SAMPLES);
    expect(s.median!).toBeGreaterThan(0.8);
    expect(s.median!).toBeLessThan(0.95);
    expect(s.p25!).toBeLessThanOrEqual(s.median!);
    expect(s.at).toBe(42);
  });

  it('region filter keeps only matching country codes', () => {
    const sk = vastStats(mixed, q({ verifiedOnly: false, regions: ['sk'] }), 1);
    const expected = mixed.offers.filter((o: { geolocation?: string; num_gpus: number }) => o.num_gpus === 1 && /, SK$/.test(o.geolocation ?? '')).length;
    expect(sk.n).toBeLessThanOrEqual(expected);
  });
});

describe('vastStats filters', () => {
  it('drops DLPerf outliers below 80% of the median', () => {
    const offers = [199, 198, 197, 199, 196, 79].map((dlperf, i) => offer({ dlperf, dph_total: 0.7 + i * 0.01 }));
    const s = vastStats({ offers }, q(), 0);
    expect(s.n).toBe(5);
    expect(s.median).toBeCloseTo(0.72, 10);
  });

  it('separates on-demand from interruptible (bid) offers', () => {
    const offers = [...Array.from({ length: 5 }, () => offer({ dph_total: 0.8 })), offer({ is_bid: true, dph_total: 0.2 })];
    expect(vastStats({ offers }, q(), 0).median).toBeCloseTo(0.8, 10);
  });

  it('reports insufficient data instead of a misleading price', () => {
    const s = vastStats({ offers: [offer({}), offer({}), offer({ verification: 'unverified' })] }, q(), 0);
    expect(s).toMatchObject({ status: 'insufficient', median: null, p25: null, n: 2, total: 3 });
    expect(vastStats({}, q(), 0)).toMatchObject({ status: 'insufficient', n: 0, total: 0 });
  });

  it('computes the 25th percentile by linear interpolation', () => {
    const offers = [0.6, 0.7, 0.8, 0.9, 1.0].map((dph_total) => offer({ dph_total }));
    const s = vastStats({ offers }, q(), 0);
    expect(s.p25).toBeCloseTo(0.7, 10);
    expect(s.median).toBeCloseTo(0.8, 10);
  });
});
