// SafeTrade 자동 매도 엔진 (하루 1회). 거래소 접근은 주입한 클라이언트로만 (테스트는 모의 클라이언트).
//
// 원칙
//  - 지정가만. 시장가 주문을 만들지 않는다.
//  - 하한가 아래로는 절대 팔지 않는다: 하한가 = max(사용자 최저가, 기준가 × (1 − 최대 하락률)).
//    기준가 = SafeTrade 24시간 평균가와 CoinGecko 시세 중 높은 값 (모르면 팔지 않음).
//  - 호가가 이상하면(스프레드 과다·매수 호가 깊이 부족·API 오류) 그날은 팔지 않는다.
//  - 하루 최대 매도량·1회 주문 최대 금액. 남겨 둘 PRL(reserve) 은 팔지 않는다.
//  - 최우선 매도호가 바로 아래에 걸고, N분 안에 다 체결되지 않으면 취소 후 한 단계 낮춰 다시 (하한가까지, 최대 횟수).
//  - dry-run 은 계획만 만들고 주문하지 않는다.
import type { AutoSellConfig, SellResult } from '../shared/types';
import type { Depth, MarketInfo, Order } from './safetrade';
export type { AutoSellConfig, SellOrderRecord, SellResult } from '../shared/types';
import { ceilTo, floorTo } from './safetrade';

export const DEFAULT_AUTOSELL: AutoSellConfig = {
  enabled: false,
  dryRun: true,
  time: '10:00',
  market: 'prlusdt',
  reservePrl: 0,
  floorUsd: 0,
  maxDropPct: 5,
  maxSpreadPct: 2,
  minBidDepthUsd: 200,
  dailyMaxPrl: 50,
  orderMaxUsd: 50,
  repriceMinutes: 15,
  repriceStepPct: 0.5,
  maxReprices: 8,
};

export function validateAutoSell(c: AutoSellConfig): string | null {
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(c.time)) return '실행 시각은 HH:MM 이어야 합니다';
  if (!/^[a-z0-9]{4,20}$/.test(c.market)) return '마켓 이름이 올바르지 않습니다 (예: prlusdt)';
  const nonneg = [c.reservePrl, c.floorUsd, c.minBidDepthUsd];
  if (!nonneg.every((v) => Number.isFinite(v) && v >= 0)) return '자동 매도 값은 0 이상이어야 합니다';
  if (!(c.maxDropPct > 0 && c.maxDropPct <= 50)) return '최대 하락률은 0~50% 이어야 합니다';
  if (!(c.maxSpreadPct > 0 && c.maxSpreadPct <= 20)) return '스프레드 상한은 0~20% 이어야 합니다';
  if (!(c.dailyMaxPrl > 0 && c.orderMaxUsd > 0)) return '하루 최대 매도량과 1회 주문 한도는 0보다 커야 합니다';
  if (!(c.repriceMinutes >= 1 && c.repriceMinutes <= 240)) return '재가격 간격은 1~240분이어야 합니다';
  if (!(c.repriceStepPct > 0 && c.repriceStepPct <= 5)) return '한 번에 내리는 비율은 0~5% 이어야 합니다';
  if (!(Number.isInteger(c.maxReprices) && c.maxReprices >= 0 && c.maxReprices <= 50)) return '최대 재가격 횟수는 0~50 정수여야 합니다';
  return null;
}

export interface SellClient {
  market(id: string): Promise<MarketInfo>;
  depth(id: string): Promise<Depth>;
  ticker(id: string): Promise<{ avgPrice: number; last: number }>;
  balances(): Promise<Record<string, { available: number; locked: number }>>;
  sellLimit(m: MarketInfo, amount: number, price: number): Promise<Order>;
  order(id: number): Promise<Order>;
  cancel(id: number): Promise<void>;
  fills(market: string, orderId: number, sinceSec: number): Promise<{ amount: number; total: number; fee: number; feeCurrency: string; price: number }[]>;
  openSells(market: string): Promise<Order[]>;
}

export interface SellDeps {
  client: SellClient;
  sleep(ms: number): Promise<void>;
  now(): number;
  /** 외부 기준가 (CoinGecko, USD). 모르면 null */
  refPriceUsd(): number | null;
  /** 오늘 이미 판 PRL (하루 한도 계산) */
  soldTodayPrl: number;
  day: string;
  /** 주문을 걸었을 때·닫았을 때 (앱이 중간에 꺼져도 다음 시작 때 취소·기록하려고 저장) */
  onOpen?(o: Order | null): void;
}

const pct = (a: number, b: number) => ((a - b) / ((a + b) / 2)) * 100;

/** 호가가 정상인지: 양쪽 호가가 있고, 스프레드·매수 깊이가 기준 안 */
export function checkBook(depth: Depth, cfg: AutoSellConfig): { ask: number; bid: number } | { skip: string } {
  const ask = depth.asks[0]?.[0];
  const bid = depth.bids[0]?.[0];
  if (!(ask > 0) || !(bid > 0)) return { skip: '호가가 비어 있습니다' };
  if (ask <= bid) return { skip: `호가가 꼬였습니다 (매도 ${ask} ≤ 매수 ${bid})` };
  const spread = pct(ask, bid);
  if (spread > cfg.maxSpreadPct) return { skip: `스프레드 ${spread.toFixed(2)}% > ${cfg.maxSpreadPct}%` };
  const depthUsd = depth.bids.filter(([p]) => p >= bid * 0.95).reduce((s, [p, a]) => s + p * a, 0);
  if (depthUsd < cfg.minBidDepthUsd) return { skip: `매수 호가 깊이 ${depthUsd.toFixed(0)} USDT < ${cfg.minBidDepthUsd}` };
  return { ask, bid };
}

/** 하한가 (가격 정밀도로 올림): 사용자 최저가와 기준가 하락 한도 중 높은 값 */
export function floorPrice(cfg: AutoSellConfig, refUsd: number, pricePrecision: number): number {
  return ceilTo(Math.max(cfg.floorUsd, refUsd * (1 - cfg.maxDropPct / 100)), pricePrecision);
}

/** 걸 가격: 최우선 매도호가 한 틱 아래, 하한가 이상 */
export function quotePrice(ask: number, floor: number, pricePrecision: number): number {
  const tick = 10 ** -pricePrecision;
  return Math.max(floor, floorTo(ask - tick, pricePrecision));
}

export async function runAutoSell(cfg: AutoSellConfig, d: SellDeps): Promise<SellResult> {
  const startedAt = d.now();
  const r: SellResult = { day: d.day, at: startedAt, dryRun: cfg.dryRun, status: 'nothing', reason: null, floorUsd: null, refUsd: null, plan: null, orders: [], soldPrl: 0, proceedsUsdt: 0, feeUsdt: 0 };
  const skip = (reason: string): SellResult => ({ ...r, status: r.soldPrl > 0 ? 'partial' : 'skipped', reason });
  let open: Order | null = null;
  try {
    const m = await d.client.market(cfg.market);
    if (m.state !== 'enabled') return skip(`마켓 ${cfg.market} 상태: ${m.state}`);
    const [bal, tk] = await Promise.all([d.client.balances(), d.client.ticker(cfg.market)]);
    const refs = [tk.avgPrice, d.refPriceUsd() ?? Number.NaN].filter((v) => Number.isFinite(v) && v > 0);
    if (!refs.length) return skip('기준가를 알 수 없습니다 (24시간 평균가·시세 없음)');
    r.refUsd = Math.max(...refs);
    const floor = floorPrice(cfg, r.refUsd, m.pricePrecision);
    r.floorUsd = floor;
    const base = m.id.replace(/usdt$|usdc$|btc$/, '');
    const avail = bal[base]?.available ?? 0;
    let remaining = floorTo(Math.min(avail - cfg.reservePrl, cfg.dailyMaxPrl - d.soldTodayPrl), m.amountPrecision);
    if (remaining < m.minAmount) return { ...r, status: 'nothing', reason: `팔 수 있는 PRL ${Math.max(0, remaining)} (가용 ${avail}, 남길 양 ${cfg.reservePrl}, 오늘 ${d.soldTodayPrl}/${cfg.dailyMaxPrl}) < 최소 ${m.minAmount}` };

    let reprices = 0;
    let lastPrice: number | null = null;
    while (remaining >= m.minAmount) {
      const book = checkBook(await d.client.depth(cfg.market), cfg);
      if ('skip' in book) return skip(book.skip);
      let price = quotePrice(book.ask, floor, m.pricePrecision);
      // 재가격: 직전 가격에서 한 단계 내리되 지금 호가 한 틱 아래보다 높게 걸지 않고, 하한가 밑으로는 내리지 않는다
      if (lastPrice !== null) price = Math.max(floor, Math.min(price, floorTo(lastPrice * (1 - cfg.repriceStepPct / 100), m.pricePrecision)));
      if (price < floor) return skip(`가격 ${price} 가 하한가 ${floor} 아래`);
      const amount = floorTo(Math.min(remaining, cfg.orderMaxUsd / price), m.amountPrecision);
      if (amount < m.minAmount) return skip(`1회 주문 한도 ${cfg.orderMaxUsd} USDT 로는 최소 수량 ${m.minAmount} PRL 을 살 수 없습니다`);
      if (cfg.dryRun) return { ...r, status: 'planned', plan: { price, amount }, reason: `${amount} PRL 을 ${price} USDT 에 지정가 매도할 계획 (하한가 ${floor}, 기준가 ${r.refUsd})` };

      try {
        open = await d.client.sellLimit(m, amount, price);
      } catch (e) {
        // 상태를 모르는 실패(5xx·연결 끊김)는 방금 넣었을 수 있는 같은 주문을 찾아 취소한다
        const status = (e as { status?: number | null }).status;
        if (status === null || status === undefined || status >= 500) {
          for (const o of await d.client.openSells(cfg.market).catch(() => [])) {
            if (Math.abs(o.price - price) < 1e-9 && Math.abs(o.originAmount - amount) < 1e-9) await d.client.cancel(o.id).catch(() => undefined);
          }
        }
        throw e;
      }
      d.onOpen?.(open);
      r.plan ??= { price, amount };
      lastPrice = price;
      await d.sleep(cfg.repriceMinutes * 60_000);
      let o = await d.client.order(open.id);
      if (o.state !== 'done') {
        await d.client.cancel(open.id).catch(() => undefined);
        o = await d.client.order(open.id);
      }
      open = null;
      d.onOpen?.(null);
      r.orders.push({ id: o.id, price, amount, filled: o.filledAmount, avgPrice: o.avgPrice });
      r.soldPrl += o.filledAmount;
      remaining = floorTo(remaining - o.filledAmount, m.amountPrecision);
      if (o.filledAmount < amount - 1e-9) {
        reprices++;
        if (reprices > cfg.maxReprices) break;
        if (price <= floor) break; // 하한가에서도 안 팔림: 오늘은 여기까지
      } else lastPrice = null; // 다 팔렸으면 다음 주문은 다시 지금 호가 기준으로 (내리지 않음)
    }

    // 체결 금액·수수료 (체결 내역 기준, 없으면 평균가로)
    for (const ord of r.orders.filter((x) => x.filled > 0)) {
      const fills = await d.client.fills(cfg.market, ord.id, startedAt / 1000 - 60).catch(() => []);
      if (fills.length) {
        r.proceedsUsdt += fills.reduce((s, f) => s + (f.total || f.amount * f.price), 0);
        r.feeUsdt += fills.reduce((s, f) => s + (/prl/i.test(f.feeCurrency) ? f.fee * f.price : f.fee), 0);
      } else r.proceedsUsdt += ord.filled * ord.avgPrice;
    }
    r.status = r.soldPrl <= 0 ? 'nothing' : remaining >= m.minAmount ? 'partial' : 'sold';
    if (r.status !== 'sold') r.reason = r.soldPrl > 0 ? `일부만 체결 (${r.soldPrl} PRL), 남은 ${remaining} PRL 은 하한가·재가격 한도로 중단` : `하한가 ${floor} 이상에서 체결되지 않았습니다`;
    return r;
  } catch (e) {
    // 걸어 둔 주문이 있으면 취소하고, 그때까지 체결된 양은 기록한다 (장부에 빠지지 않게)
    if (open) {
      const id = open.id;
      await d.client.cancel(id).catch(() => undefined);
      const o = await d.client.order(id).catch(() => null);
      if (o && o.filledAmount > 0) {
        r.orders.push({ id, price: open.price, amount: open.originAmount, filled: o.filledAmount, avgPrice: o.avgPrice });
        r.soldPrl += o.filledAmount;
      }
      d.onOpen?.(null);
    }
    r.proceedsUsdt = r.orders.reduce((s, x) => s + x.filled * x.avgPrice, 0);
    return { ...r, status: 'error', reason: (e as Error).message.slice(0, 300) };
  }
}

/**
 * 다음 실행 시각 (이 PC 시간대). 오늘 이미 했으면 내일, 아니면 오늘 그 시각 (지났으면 지금).
 */
export function nextRunAt(time: string, doneToday: boolean, now: number): number {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(now);
  if (doneToday) return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, h, m).getTime();
  return Math.max(now, new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, m).getTime());
}
