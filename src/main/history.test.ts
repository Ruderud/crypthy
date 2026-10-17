import { describe, expect, it } from 'vitest';
import { emptyLedger, recordEarnings, recordEnergy } from './profit';
import { addSample, BUCKET_MS, dailyClose, dailySeries, emptyHistory, historyToJson, loadHistory, MAX_GPUS, MAX_POINTS, parseMarketChart, seriesOf } from './history';

const s = (hash: number | null, temp: number | null, power: number | null) => ({ hash, temp, power });

describe('history buckets', () => {
  it('averages samples within a minute and finalizes on rollover', () => {
    let h = emptyHistory();
    const t0 = 10 * BUCKET_MS;
    h = addSample(h, 'g', s(100, 60, 500), t0);
    h = addSample(h, 'g', s(200, 62, null), t0 + 2000);
    expect(h.series.g).toBeUndefined();
    expect(seriesOf(h, 'g')).toEqual([{ t: t0, hash: 150, temp: 61, power: 500 }]);
    h = addSample(h, 'g', s(300, 70, 600), t0 + BUCKET_MS);
    expect(h.series.g).toEqual([{ t: t0, hash: 150, temp: 61, power: 500 }]);
    expect(seriesOf(h, 'g')).toHaveLength(2);
  });

  it('keeps at most MAX_POINTS per GPU and MAX_GPUS GPUs', () => {
    let h = emptyHistory();
    for (let i = 0; i <= MAX_POINTS + 10; i++) h = addSample(h, 'g', s(1, 1, 1), i * BUCKET_MS);
    expect(h.series.g).toHaveLength(MAX_POINTS);
    expect(h.series.g[0].t).toBe(10 * BUCKET_MS);
    for (let i = 0; i < MAX_GPUS + 5; i++) h = addSample(h, `x${i}`, s(1, 1, 1), 0);
    expect(Object.keys(h.acc).length).toBeLessThanOrEqual(MAX_GPUS);
  });

  it('records null when a metric is missing for the whole minute', () => {
    const h = addSample(emptyHistory(), 'g', s(null, 55, null), 0);
    expect(seriesOf(h, 'g')[0]).toEqual({ t: 0, hash: null, temp: 55, power: null });
  });

  it('round-trips through JSON without the open bucket and drops junk on load', () => {
    let h = emptyHistory();
    h = addSample(h, 'g', s(1, 2, 3), 0);
    h = addSample(h, 'g', s(1, 2, 3), BUCKET_MS);
    const loaded = loadHistory(JSON.parse(JSON.stringify(historyToJson(h))));
    expect(loaded.series.g).toHaveLength(1);
    expect(loaded.acc).toEqual({});
    expect(loadHistory(null).series).toEqual({});
    expect(loadHistory({ series: { g: [{ t: 'x' }, { t: 5 }], h: 'bad' } }).series).toEqual({ g: [{ t: 5 }] });
  });
});

describe('price history', () => {
  it('parses market_chart prices sorted, skipping junk', () => {
    expect(parseMarketChart({ prices: [[2, 1.5], ['x', 1], [1, 1.2]] })).toEqual([{ t: 1, usd: 1.2 }, { t: 2, usd: 1.5 }]);
    expect(parseMarketChart({})).toEqual([]);
  });

  it('daily close keeps the last price of each local day', () => {
    const d1 = new Date(2026, 9, 16, 9).getTime();
    const d1b = new Date(2026, 9, 16, 21).getTime();
    const d2 = new Date(2026, 9, 17, 9).getTime();
    expect(dailyClose([{ t: d1, usd: 1 }, { t: d1b, usd: 2 }, { t: d2, usd: 3 }])).toEqual({ '2026-10-16': 2, '2026-10-17': 3 });
  });
});

describe('dailySeries', () => {
  it('uses that day close, falling back to the current price', () => {
    const t1 = new Date(2026, 9, 16, 10).getTime();
    const t2 = new Date(2026, 9, 17, 10).getTime();
    let l = recordEarnings(emptyLedger(), 0, [], t1);
    l = recordEarnings(l, 2, [], t1 + 1000);
    l = recordEnergy(l, 1000, 3_600_000, t1);
    l = recordEarnings(l, 3, [], t2);
    const cfg = { krwPerKwh: 350, krwPerUsd: 1340 };
    expect(dailySeries(l, { '2026-10-16': 1.5 }, 2, cfg)).toEqual([
      { day: '2026-10-16', coin: 2, kwh: 1, netKrw: Math.round(2 * 1.5 * 1340 - 350) },
      { day: '2026-10-17', coin: 1, kwh: 0, netKrw: Math.round(1 * 2 * 1340) },
    ]);
    expect(dailySeries(l, {}, null, cfg)[0].netKrw).toBeNull();
  });
});
