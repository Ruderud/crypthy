// 공개 API 조회 (인증 없음). 지갑은 공개 주소만 사용한다.
import type { Payout, PoolStats } from './profit';

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => {
  const n = typeof v === 'string' ? Number.parseFloat(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : null;
};

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { signal: AbortSignal.timeout(10_000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${new URL(url).host} HTTP ${res.status}`);
  return res.json();
}

/** "prl1....worker1" → "prl1...." (워커명 제거) */
export const walletAddress = (wallet: string): string => wallet.split('.')[0];

// ---- Kryptex: https://pool.kryptex.com/{ticker}/api/v1/... ----

export function parseKryptexBalance(json: unknown): number | null {
  return isObj(json) ? num(json.total) : null;
}

export function parseKryptexPayouts(json: unknown): Payout[] {
  const results = isObj(json) && Array.isArray(json.results) ? json.results.filter(isObj) : [];
  const out: Payout[] = [];
  for (const r of results) {
    const amount = num(r.amount) ?? num(r.value);
    if (amount === null) continue;
    const id = r.txid ?? r.tx_hash ?? r.hash ?? r.id;
    const time = r.created ?? r.timestamp ?? r.time ?? r.date;
    out.push({ key: String(id ?? `${String(time)}:${amount}`), amount });
  }
  return out;
}

export function parseKryptexPool(json: unknown): PoolStats | null {
  if (!isObj(json)) return null;
  const netHashrate = num(json.net_hashrate);
  const blockReward = num(json.block_reward);
  const blockTimeS = num(json.block_time);
  const fee = num(json.fee) ?? 0;
  if (netHashrate === null || blockReward === null || blockTimeS === null) return null;
  return { netHashrate, blockReward, blockTimeS, fee };
}

/** 풀 통계만 (지갑 없이도 실시간 추정에 필요) */
export async function fetchKryptexPool(ticker: string): Promise<PoolStats | null> {
  return parseKryptexPool(await getJson(`https://pool.kryptex.com/${encodeURIComponent(ticker)}/api/v1/pool/stats`));
}

export async function fetchKryptex(ticker: string, wallet: string) {
  const base = `https://pool.kryptex.com/${encodeURIComponent(ticker)}/api/v1`;
  const addr = encodeURIComponent(walletAddress(wallet));
  const [bal, pay, pool] = await Promise.all([
    getJson(`${base}/miner/balance/${addr}`),
    getJson(`${base}/miner/payouts/${addr}`),
    getJson(`${base}/pool/stats`),
  ]);
  return { balance: parseKryptexBalance(bal), payouts: parseKryptexPayouts(pay), pool: parseKryptexPool(pool) };
}

// ---- CoinGecko ----

export function parseCoingecko(json: unknown, id: string): { usd: number; change24h: number | null } | null {
  const c = isObj(json) ? json[id] : null;
  if (!isObj(c)) return null;
  const usd = num(c.usd);
  return usd === null ? null : { usd, change24h: num(c.usd_24h_change) };
}

/** 최근 30일 시세 (차트용) */
export async function fetchMarketChart(id: string): Promise<unknown> {
  return getJson(`https://api.coingecko.com/api/v3/coins/${encodeURIComponent(id)}/market_chart?vs_currency=usd&days=30`);
}

export async function fetchCoingecko(id: string) {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(id)}&vs_currencies=usd&include_24hr_change=true`;
  return parseCoingecko(await getJson(url), id);
}

// ---- Vast.ai 공개 오퍼 검색 (정보 표시용) ----

export interface VastQuery {
  gpuName: string;
  /** Vast 인증(verified) 매물만. 미인증·인증 해제 매물은 최저가 쪽에 몰려 중앙값을 낮춘다 */
  verifiedOnly: boolean;
  type: 'on-demand' | 'interruptible';
  /** 국가 코드 목록(geolocation 끝의 ", KR" 등). 비면 전체 */
  regions: string[];
}

export interface VastStats {
  status: 'ok' | 'insufficient';
  median: number | null;
  p25: number | null;
  /** 필터 후 표본 수 / 응답 전체 매물 수 */
  n: number;
  total: number;
  at: number;
}

/** 표본이 이보다 적으면 "데이터 부족" */
export const VAST_MIN_SAMPLES = 5;
/** 같은 GPU 의 DLPerf 중앙값 대비 이 비율 미만인 매물은 비정상(제한·고장·공유)으로 보고 뺀다 */
export const VAST_DLPERF_RATIO = 0.8;

const quantile = (sorted: number[], q: number) => {
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
};

/** 공개 검색(bundles) 쿼리: 1장짜리, 대여 가능, 유형·인증 조건 */
export function buildVastQuery(q: VastQuery): Record<string, unknown> {
  return {
    gpu_name: { eq: q.gpuName },
    num_gpus: { eq: 1 },
    rentable: { eq: true },
    type: q.type === 'interruptible' ? 'bid' : 'on-demand',
    ...(q.verifiedOnly ? { verified: { eq: true } } : {}),
    limit: 1000,
  };
}

/** 응답 → 필터(1장·가격·인증·유형·지역·DLPerf) → 중앙값·하위 25% */
export function vastStats(json: unknown, q: VastQuery, now: number): VastStats {
  const offers = isObj(json) && Array.isArray(json.offers) ? json.offers.filter(isObj) : [];
  const regions = q.regions.map((r) => r.trim().toUpperCase()).filter(Boolean);
  let rows = offers.filter((o) => {
    if (num(o.num_gpus) !== 1 || !((num(o.dph_total) ?? 0) > 0)) return false;
    if (q.verifiedOnly && o.verification !== 'verified') return false;
    if (q.type === 'on-demand' && o.is_bid === true) return false;
    if (regions.length) {
      const cc = /,\s*([A-Z]{2})$/.exec(String(o.geolocation ?? ''))?.[1];
      if (!cc || !regions.includes(cc)) return false;
    }
    return true;
  });
  const perf = rows.map((o) => num(o.dlperf)).filter((v): v is number => v !== null && v > 0).sort((a, b) => a - b);
  if (perf.length) {
    const floor = quantile(perf, 0.5) * VAST_DLPERF_RATIO;
    rows = rows.filter((o) => (num(o.dlperf) ?? 0) >= floor);
  }
  const prices = rows.map((o) => num(o.dph_total) as number).sort((a, b) => a - b);
  const ok = prices.length >= VAST_MIN_SAMPLES;
  return {
    status: ok ? 'ok' : 'insufficient',
    median: ok ? quantile(prices, 0.5) : null,
    p25: ok ? quantile(prices, 0.25) : null,
    n: prices.length,
    total: offers.length,
    at: now,
  };
}

export async function fetchVastStats(q: VastQuery, now: number): Promise<VastStats> {
  const json = await getJson(`https://console.vast.ai/api/v0/bundles/?q=${encodeURIComponent(JSON.stringify(buildVastQuery(q)))}`);
  return vastStats(json, q, now);
}
