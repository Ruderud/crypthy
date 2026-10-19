// SafeTrade 거래소 REST API 클라이언트 (자동 매도용 최소 범위).
//
// 출처 (2026-10-19 확인):
//  - 공식 문서 https://safetrade.com/api (OAS 2.0: https://safetrade.com/api/v2/trade/public/swagger.json), base https://safe.trade/api/v2
//  - 공식 예제 https://github.com/safetrade-exchange/example-client (api.py): 서명 헤더와 주문 본문
// 인증: X-Auth-Apikey, X-Auth-Nonce(밀리초), X-Auth-Signature = hex(HMAC-SHA256(secret, nonce + apiKey))
// 주문: POST /trade/market/orders {market, side, amount, price, type:"limit"} — 시장가는 쓰지 않는다.
//       swagger 에 type 이 없으므로 응답을 확인해 지정가·가격·방향이 다르면 바로 취소하고 실패로 본다.
// 키(apiKey·secret)는 이 모듈 밖으로 내보내지 않고, 오류 문장에서도 지운다.
import crypto from 'node:crypto';

export const SAFETRADE_BASE = 'https://safe.trade/api/v2';

export interface ExchangeKey {
  key: string;
  secret: string;
}

export interface MarketInfo {
  id: string;
  /** 기준 통화 id (2026-10-18 부터 pearl, 그 전 prl) */
  baseUnit: string;
  quoteUnit: string;
  amountPrecision: number;
  pricePrecision: number;
  minAmount: number;
  minPrice: number;
  state: string;
}

export interface Depth {
  /** [가격, 수량] 가격 오름차순 */
  asks: [number, number][];
  /** [가격, 수량] 가격 내림차순 */
  bids: [number, number][];
}

export interface Order {
  id: number;
  market: string;
  side: string;
  type: string;
  state: string;
  price: number;
  originAmount: number;
  filledAmount: number;
  avgPrice: number;
}

export interface Fill {
  id: number;
  orderId: number;
  price: number;
  amount: number;
  total: number;
  fee: number;
  feeCurrency: string;
}

export const sign = (nonce: string, k: ExchangeKey) => crypto.createHmac('sha256', k.secret).update(nonce + k.key).digest('hex');

const num = (v: unknown): number => {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : Number.NaN;
  return Number.isFinite(n) ? n : Number.NaN;
};

/** 오류 문장에서 키·시크릿을 지운다 (응답 본문이 요청 헤더를 되돌려 주는 경우 등) */
export function redact(text: string, k: ExchangeKey | null): string {
  let out = text;
  for (const s of [k?.key, k?.secret]) if (s && s.length >= 6) out = out.split(s).join('[redacted]');
  return out.slice(0, 300);
}

/** 거래소 정밀도에 맞춰 내림 (판매 수량·가격을 올리지 않게) */
export const floorTo = (v: number, digits: number) => Math.floor(v * 10 ** digits + 1e-9) / 10 ** digits;
export const ceilTo = (v: number, digits: number) => Math.ceil(v * 10 ** digits - 1e-9) / 10 ** digits;
export const fixed = (v: number, digits: number) => v.toFixed(digits);

/** PRL 의 기준 통화 id: 새 id 우선 */
export const PRL_BASES = ['pearl', 'prl'];
/** SafeTrade 매도 수수료 기본값 (공개 trading_fees maker·taker 0.001, 2026-10-19 실제 매도 0.1% 확인) */
export const DEFAULT_FEE_RATE = 0.001;

export function parseMarket(j: unknown): MarketInfo {
  const o = (j ?? {}) as Record<string, unknown>;
  return {
    id: String(o.id ?? ''), baseUnit: String(o.base_unit ?? '').toLowerCase(), quoteUnit: String(o.quote_unit ?? '').toLowerCase(),
    amountPrecision: num(o.amount_precision), pricePrecision: num(o.price_precision), minAmount: num(o.min_amount), minPrice: num(o.min_price), state: String(o.state ?? ''),
  };
}

export function parseDepth(j: unknown): Depth {
  const o = (j ?? {}) as { asks?: unknown; bids?: unknown };
  const side = (v: unknown) =>
    (Array.isArray(v) ? v : [])
      .map((r) => (Array.isArray(r) ? ([num(r[0]), num(r[1])] as [number, number]) : null))
      .filter((r): r is [number, number] => !!r && r[0] > 0 && r[1] > 0);
  return { asks: side(o.asks).sort((a, b) => a[0] - b[0]), bids: side(o.bids).sort((a, b) => b[0] - a[0]) };
}

export function parseOrder(j: unknown): Order {
  const o = (j ?? {}) as Record<string, unknown>;
  return {
    id: num(o.id),
    market: String(o.market ?? ''),
    side: String(o.side ?? ''),
    type: String(o.type ?? o.ord_type ?? ''),
    state: String(o.state ?? ''),
    price: num(o.price),
    originAmount: num(o.origin_amount),
    filledAmount: num(o.filled_amount) || 0,
    avgPrice: num(o.avg_price) || 0,
  };
}

export function parseFills(j: unknown): Fill[] {
  return (Array.isArray(j) ? j : []).map((t) => {
    const o = t as Record<string, unknown>;
    return { id: num(o.id), orderId: num(o.order_id), price: num(o.price), amount: num(o.amount), total: num(o.total), fee: num(o.fee) || 0, feeCurrency: String(o.fee_currency ?? '') };
  });
}

export class ExchangeError extends Error {
  constructor(message: string, public status: number | null) {
    super(message);
  }
}

export function createSafeTrade(key: ExchangeKey | null, fetchImpl: typeof fetch = fetch, base = SAFETRADE_BASE, now: () => number = Date.now) {
  async function call(method: 'GET' | 'POST', path: string, body?: unknown, auth = true): Promise<unknown> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (auth) {
      if (!key) throw new ExchangeError('SafeTrade API 키가 없습니다', null);
      const nonce = String(now());
      headers['X-Auth-Apikey'] = key.key;
      headers['X-Auth-Nonce'] = nonce;
      headers['X-Auth-Signature'] = sign(nonce, key);
    }
    if (body !== undefined) headers['content-type'] = 'application/json;charset=utf-8';
    let res: Response;
    try {
      res = await fetchImpl(`${base}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    } catch (e) {
      throw new ExchangeError(`SafeTrade 연결 실패: ${redact((e as Error).message, key)}`, null);
    }
    const text = await res.text();
    // Cloudflare 가 브라우저가 아닌 요청을 막으면 HTML 확인 페이지가 온다 (Node fetch·curl 은 막히고 Electron net.fetch 는 통과, 2026-10-19 확인)
    if (res.status === 403 && /cloudflare|Attention Required/i.test(text)) {
      throw new ExchangeError('SafeTrade 가 Cloudflare 로 이 프로그램의 요청을 막았습니다 (403) — 데스크톱 Crypthy 에서 자동 매도를 쓰세요 (헤드리스는 막힐 수 있습니다)', 403);
    }
    if (!res.ok) throw new ExchangeError(`SafeTrade ${res.status}: ${redact(text, key)}`, res.status);
    try {
      return JSON.parse(text);
    } catch {
      throw new ExchangeError('SafeTrade 응답 형식이 올바르지 않습니다', res.status);
    }
  }

  return {
    hasKey: () => !!key,
    async market(id: string): Promise<MarketInfo> {
      return parseMarket(await call('GET', `/trade/public/markets/${encodeURIComponent(id)}`, undefined, false));
    },
    /**
     * PRL 을 quote(usdt·usdc)로 파는 거래 가능한 마켓을 마켓 목록에서 찾는다. 이름을 박아 두지 않는다:
     * 2026-10-18 에 prlusdt 가 꺼지고 pearlusdt(기준 통화 pearl)로 바뀌었다
     */
    async findMarket(quote: string): Promise<MarketInfo | null> {
      const list = (await call('GET', '/trade/public/markets?limit=1000', undefined, false)) as unknown;
      const all = (Array.isArray(list) ? list : []).map(parseMarket).filter((m) => m.state === 'enabled' && m.quoteUnit === quote && PRL_BASES.includes(m.baseUnit));
      return all.sort((a, z) => PRL_BASES.indexOf(a.baseUnit) - PRL_BASES.indexOf(z.baseUnit))[0] ?? null;
    },
    /** 이 마켓의 taker 수수료율 (공개 trading_fees, 없으면 null) */
    async takerFee(id: string): Promise<number | null> {
      const list = (await call('GET', '/trade/public/trading_fees', undefined, false)) as unknown;
      const rows = (Array.isArray(list) ? list : []) as Record<string, unknown>[];
      const row = rows.find((f) => f.market_id === id) ?? rows.find((f) => f.market_id === 'any' && f.group === 'any');
      const fee = num(row?.taker);
      return Number.isFinite(fee) && fee >= 0 && fee < 0.05 ? fee : null;
    },
    async depth(id: string): Promise<Depth> {
      return parseDepth(await call('GET', `/trade/public/markets/${encodeURIComponent(id)}/depth?limit=50`, undefined, false));
    },
    /** 24시간 평균가(avg_price)와 최근가 */
    async ticker(id: string): Promise<{ avgPrice: number; last: number }> {
      const o = (await call('GET', `/trade/public/tickers/${encodeURIComponent(id)}`, undefined, false)) as Record<string, unknown>;
      return { avgPrice: num(o.avg_price), last: num(o.last) };
    },
    /** 현물 잔고: currency → {available, locked} (balance 를 거래 가능 수량으로 본다) */
    async balances(): Promise<Record<string, { available: number; locked: number }>> {
      const list = (await call('GET', '/trade/account/balances/spot')) as unknown;
      const out: Record<string, { available: number; locked: number }> = {};
      for (const a of Array.isArray(list) ? list : []) {
        const o = a as Record<string, unknown>;
        out[String(o.currency ?? '').toLowerCase()] = { available: num(o.balance) || 0, locked: num(o.locked) || 0 };
      }
      return out;
    },
    /**
     * 지정가 매도. 응답이 지정가·매도·같은 가격이 아니면 바로 취소하고 오류 (시장가로 나가는 일을 막는다).
     */
    async sellLimit(m: MarketInfo, amount: number, price: number): Promise<Order> {
      const amt = fixed(floorTo(amount, m.amountPrecision), m.amountPrecision);
      const px = fixed(floorTo(price, m.pricePrecision), m.pricePrecision);
      if (!(Number(amt) >= m.minAmount)) throw new ExchangeError(`주문 수량 ${amt} 가 최소 ${m.minAmount} 보다 작습니다`, null);
      const o = parseOrder(await call('POST', '/trade/market/orders', { market: m.id, side: 'sell', amount: amt, price: px, type: 'limit' }));
      const ok =
        o.side === 'sell' &&
        (o.type === '' || o.type === 'limit') &&
        (o.market === '' || o.market === m.id) &&
        Math.abs(o.price - Number(px)) < 10 ** -(m.pricePrecision + 1) &&
        (!Number.isFinite(o.originAmount) || Math.abs(o.originAmount - Number(amt)) < 10 ** -(m.amountPrecision + 1));
      if (!ok) {
        if (Number.isFinite(o.id)) await call('POST', `/trade/market/orders/${o.id}/cancel`).catch(() => undefined);
        throw new ExchangeError(`주문 응답이 예상과 다릅니다 (type ${o.type || '?'}, price ${o.price}) — 취소했습니다`, null);
      }
      return o;
    },
    /** 이 마켓의 대기 중인 내 매도 주문 (상태를 모르는 주문 실패 뒤 정리용) */
    async openSells(market: string): Promise<Order[]> {
      const j = await call('GET', `/trade/market/orders?market=${encodeURIComponent(market)}&state=wait&side=sell&limit=100`);
      return (Array.isArray(j) ? j : []).map(parseOrder);
    },
    async order(id: number): Promise<Order> {
      return parseOrder(await call('GET', `/trade/market/orders/${id}`));
    },
    async cancel(id: number): Promise<void> {
      await call('POST', `/trade/market/orders/${id}/cancel`);
    },
    /** 이 주문의 체결 (수수료 포함) */
    async fills(market: string, orderId: number, sinceSec: number): Promise<Fill[]> {
      const j = await call('GET', `/trade/market/trades?market=${encodeURIComponent(market)}&time_from=${Math.floor(sinceSec)}&limit=100`);
      return parseFills(j).filter((f) => f.orderId === orderId);
    },
  };
}

export type SafeTradeClient = ReturnType<typeof createSafeTrade>;
