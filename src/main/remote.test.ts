import { describe, expect, it } from 'vitest';
import { parseCoingecko, parseKryptexBalance, parseKryptexPayouts, parseKryptexPool, walletAddress } from './remote';

describe('kryptex', () => {
  it('balance uses total', () => {
    expect(parseKryptexBalance({ total: 1.53, unconfirmed: 1.53, confirmed: 0, threshold: 1 })).toBe(1.53);
    expect(parseKryptexBalance('<html>')).toBeNull();
  });

  it('payouts tolerate unknown schema and build stable keys', () => {
    const p = parseKryptexPayouts({ count: 3, results: [
      { amount: 1.01, txid: 'abc', created: '2026-10-17T10:00:00Z' },
      { value: '2.5', timestamp: 1792150800000 },
      { foo: 1 },
    ] });
    expect(p).toEqual([
      { key: 'abc', amount: 1.01, at: Date.parse('2026-10-17T10:00:00Z') },
      { key: '1792150800000:2.5', amount: 2.5, at: 1792150800000 },
    ]);
    expect(parseKryptexPayouts({ count: 0, results: [] })).toEqual([]);
  });

  it('parses the real Kryptex payout shape (date = unix seconds string, amount string)', () => {
    const real = { count: 1, results: [{ date: '1792278460', address: 'x', status: 'FINISHED', amount: '1.403018290000000000', received: 1.40301829, fee: '0.00000002', txid: 't1' }] };
    expect(parseKryptexPayouts(real)).toEqual([{ key: 't1', amount: 1.40301829, at: 1792278460000 }]);
  });

  it('pool stats', () => {
    expect(parseKryptexPool({ net_hashrate: 5.8e19, block_reward: 2248, block_time: 194, fee: 0.03 })).toEqual({ netHashrate: 5.8e19, blockReward: 2248, blockTimeS: 194, fee: 0.03 });
    expect(parseKryptexPool({ net_hashrate: 1 })).toBeNull();
  });

  it('strips worker suffix from wallet', () => {
    expect(walletAddress('prl1abc.worker1')).toBe('prl1abc');
  });
});

describe('coingecko', () => {
  it('parses simple/price', () => {
    expect(parseCoingecko({ 'pearl-2': { usd: 1.69, usd_24h_change: -8.5 } }, 'pearl-2')).toEqual({ usd: 1.69, change24h: -8.5 });
    expect(parseCoingecko({}, 'pearl-2')).toBeNull();
  });
});
