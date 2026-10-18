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

/** 1장짜리 온디맨드 오퍼의 dph_total 중앙값 */
export function parseVastMedian(json: unknown): number | null {
  const offers = isObj(json) && Array.isArray(json.offers) ? json.offers.filter(isObj) : [];
  const prices = offers
    .filter((o) => num(o.num_gpus) === 1 && o.is_bid !== true)
    .map((o) => num(o.dph_total))
    .filter((p): p is number => p !== null && p > 0)
    .sort((a, b) => a - b);
  if (prices.length === 0) return null;
  const mid = Math.floor(prices.length / 2);
  return prices.length % 2 ? prices[mid] : (prices[mid - 1] + prices[mid]) / 2;
}

export async function fetchVastMedian(gpuName: string): Promise<number | null> {
  const q = JSON.stringify({
    gpu_name: { eq: gpuName },
    num_gpus: { eq: 1 },
    rentable: { eq: true },
    type: 'on-demand',
    limit: 64,
  });
  return parseVastMedian(await getJson(`https://console.vast.ai/api/v0/bundles/?q=${encodeURIComponent(q)}`));
}
