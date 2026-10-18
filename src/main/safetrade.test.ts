import crypto from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { createSafeTrade, floorTo, parseDepth, redact, sign, type MarketInfo } from './safetrade';

const KEY = { key: 'AK_test_key_123456', secret: 'SK_super_secret_abcdef' };
const PRL: MarketInfo = { id: 'prlusdt', amountPrecision: 4, pricePrecision: 2, minAmount: 2, minPrice: 0.01, state: 'enabled' };

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };
function fakeFetch(reply: (c: Call) => { status?: number; body: unknown }) {
  const calls: Call[] = [];
  const f = (async (url: string, init?: RequestInit) => {
    const c: Call = { url, method: init?.method ?? 'GET', headers: Object.fromEntries(new Headers(init?.headers).entries()), body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(c);
    const r = reply(c);
    return new Response(JSON.stringify(r.body), { status: r.status ?? 200 });
  }) as unknown as typeof fetch;
  return { calls, f };
}

describe('SafeTrade API (official docs + example client)', () => {
  it('signs nonce + api key with HMAC-SHA256(secret), hex', () => {
    expect(sign('1792336636000', KEY)).toBe(crypto.createHmac('sha256', KEY.secret).update(`1792336636000${KEY.key}`).digest('hex'));
  });

  it('sends the auth headers on private calls only', async () => {
    const { calls, f } = fakeFetch((c) => ({ body: c.url.includes('balances') ? [{ currency: 'prl', balance: '12.5', locked: '1' }] : { avg_price: '1.88', last: '1.96' } }));
    const st = createSafeTrade(KEY, f, 'https://x/api/v2', () => 1792336636000);
    expect(await st.balances()).toEqual({ prl: { available: 12.5, locked: 1 } });
    await st.ticker('prlusdt');
    expect(calls[0].headers).toMatchObject({ 'x-auth-apikey': KEY.key, 'x-auth-nonce': '1792336636000', 'x-auth-signature': sign('1792336636000', KEY) });
    expect(calls[1].headers['x-auth-apikey']).toBeUndefined();
  });

  it('places only limit sells, rounded down to the market precision', async () => {
    const { calls, f } = fakeFetch(() => ({ status: 201, body: { id: 7, market: 'prlusdt', side: 'sell', type: 'limit', state: 'wait', price: '1.96', origin_amount: '25.5', filled_amount: '0' } }));
    const o = await createSafeTrade(KEY, f).sellLimit(PRL, 25.56789, 1.9699);
    expect(calls[0].body).toEqual({ market: 'prlusdt', side: 'sell', amount: '25.5678', price: '1.96', type: 'limit' });
    expect(o).toMatchObject({ id: 7, state: 'wait', price: 1.96 });
    await expect(createSafeTrade(KEY, f).sellLimit(PRL, 1.5, 1.96)).rejects.toThrow(/최소/);
  });

  it('cancels and fails if the exchange answers with anything but our limit order', async () => {
    const { calls, f } = fakeFetch((c) => (c.url.endsWith('/cancel') ? { body: { status: 1 } } : { status: 201, body: { id: 9, side: 'sell', type: 'market', price: '0', origin_amount: '10' } }));
    await expect(createSafeTrade(KEY, f).sellLimit(PRL, 10, 1.96)).rejects.toThrow(/예상과 다릅니다/);
    expect(calls.map((c) => `${c.method} ${c.url.replace(/^.*\/api\/v2/, '')}`)).toEqual(['POST /trade/market/orders', 'POST /trade/market/orders/9/cancel']);
  });

  it('never puts the key or secret in an error message', async () => {
    const { f } = fakeFetch(() => ({ status: 401, body: { errors: [`bad key ${KEY.key} sig for ${KEY.secret}`] } }));
    const err = await createSafeTrade(KEY, f).balances().catch((e: Error) => e.message);
    expect(err).toContain('401');
    expect(err).not.toContain(KEY.key);
    expect(err).not.toContain(KEY.secret);
    expect(redact(`x ${KEY.secret} y`, KEY)).toBe('x [redacted] y');
  });

  it('parses depth (strings, sorted) and rounds down', () => {
    const d = parseDepth({ asks: [['1.98', '10'], ['1.97', '2971.95']], bids: [['1.95', '20'], ['1.96', '2505.25'], ['x', '1']] });
    expect(d.asks[0]).toEqual([1.97, 2971.95]);
    expect(d.bids.map((b) => b[0])).toEqual([1.96, 1.95]);
    expect(floorTo(1.9699, 2)).toBe(1.96);
  });
});
