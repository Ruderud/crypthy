// 차트용 로컬 시계열: GPU별 해시레이트·온도·전력을 1분 단위 평균으로 모아 보관한다.
// 2초 샘플을 그대로 쌓지 않고 1분 버킷으로 줄이며, GPU당 최대 MAX_POINTS(3일) 만 남긴다.
import type { ChartPoint, DailyPoint, GpuId, ProfitConfig } from '../shared/types';
import { dateKey, MIN_MATCHED_MS, type Ledger } from './profit';

export const BUCKET_MS = 60_000;
export const MAX_POINTS = 3 * 24 * 60;
export const MAX_GPUS = 16;

interface Acc {
  t: number;
  n: number;
  hash: [number, number];
  temp: [number, number];
  power: [number, number];
}

export interface History {
  series: Record<GpuId, ChartPoint[]>;
  acc: Record<GpuId, Acc>;
}

export const emptyHistory = (): History => ({ series: {}, acc: {} });

const add = (pair: [number, number], v: number | null): [number, number] => (v === null || !Number.isFinite(v) ? pair : [pair[0] + v, pair[1] + 1]);
const avg = ([sum, n]: [number, number]) => (n ? Math.round((sum / n) * 100) / 100 : null);

function flush(h: History, id: GpuId): void {
  const a = h.acc[id];
  if (!a || a.n === 0) return;
  const list = (h.series[id] ??= []);
  list.push({ t: a.t, hash: avg(a.hash), temp: avg(a.temp), power: avg(a.power) });
  if (list.length > MAX_POINTS) list.splice(0, list.length - MAX_POINTS);
}

/** 샘플 1회분을 반영한다 (같은 1분 버킷이면 누적, 버킷이 바뀌면 이전 버킷을 평균으로 확정) */
export function addSample(h: History, id: GpuId, s: { hash: number | null; temp: number | null; power: number | null }, now: number): History {
  const t = Math.floor(now / BUCKET_MS) * BUCKET_MS;
  const a = h.acc[id];
  if (a && a.t !== t) flush(h, id);
  if (!a || a.t !== t) {
    if (!a && Object.keys(h.acc).length >= MAX_GPUS) return h;
    h.acc[id] = { t, n: 0, hash: [0, 0], temp: [0, 0], power: [0, 0] };
  }
  const cur = h.acc[id];
  cur.n += 1;
  cur.hash = add(cur.hash, s.hash);
  cur.temp = add(cur.temp, s.temp);
  cur.power = add(cur.power, s.power);
  return h;
}

/** 확정된 점 + 진행 중 버킷의 현재 평균 (차트 표시용) */
export function seriesOf(h: History, id: GpuId): ChartPoint[] {
  const list = h.series[id] ?? [];
  const a = h.acc[id];
  return a && a.n ? [...list, { t: a.t, hash: avg(a.hash), temp: avg(a.temp), power: avg(a.power) }] : list;
}

/** 저장 파일에서 읽을 때 형식이 이상하면 버리고, 상한을 다시 적용한다 */
export function loadHistory(raw: unknown): History {
  const h = emptyHistory();
  const series = (raw as History | null)?.series;
  if (!series || typeof series !== 'object') return h;
  for (const [id, list] of Object.entries(series).slice(0, MAX_GPUS)) {
    if (!Array.isArray(list)) continue;
    h.series[id] = list.filter((p) => p && Number.isFinite(p.t)).slice(-MAX_POINTS);
  }
  return h;
}

/** 저장용: 진행 중 버킷은 저장하지 않는다 */
export const historyToJson = (h: History) => ({ series: h.series });

// ---- 시세 ----

/** CoinGecko /coins/{id}/market_chart 의 prices [[ms, usd], ...] */
export function parseMarketChart(json: unknown): { t: number; usd: number }[] {
  const prices = (json as { prices?: unknown })?.prices;
  if (!Array.isArray(prices)) return [];
  return prices
    .filter((p): p is [number, number] => Array.isArray(p) && Number.isFinite(p[0]) && Number.isFinite(p[1]))
    .map(([t, usd]) => ({ t, usd }))
    .sort((a, b) => a.t - b.t);
}

/** 날짜(로컬)별 마지막 시세 */
export function dailyClose(prices: { t: number; usd: number }[]): Record<string, number> {
  const out: Record<string, number> = {};
  for (const p of prices) out[dateKey(p.t)] = p.usd;
  return out;
}

/**
 * 장부의 일별 값 → 차트용 일별 점.
 * coin = 그날 확정 채굴량(업데이트 이전 몫 포함), netKrw = 그날 짝지은 구간(3시간 이상)의 순수익.
 * 짝지은 구간이 짧거나 시세가 없으면 null (음수 착시 방지). 그날 시세가 없으면 현재 시세를 쓴다.
 */
export function dailySeries(l: Ledger, closeByDay: Record<string, number>, fallbackUsd: number | null, cfg: Pick<ProfitConfig, 'krwPerKwh' | 'krwPerUsd'>): DailyPoint[] {
  return Object.keys(l.days)
    .sort()
    .map((day) => {
      const d = l.days[day];
      const usd = closeByDay[day] ?? fallbackUsd;
      return {
        day,
        coin: Math.round((d.prl + (d.legacyPrl ?? 0)) * 1e6) / 1e6,
        kwh: Math.round(d.kwh * 1000) / 1000,
        netKrw: usd === null || d.matchedMs < MIN_MATCHED_MS ? null : Math.round(d.prl * usd * cfg.krwPerUsd - d.matchedKwh * cfg.krwPerKwh),
      };
    });
}
