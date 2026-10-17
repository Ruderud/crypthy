import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, isKryptexPool, mergeSettings, newGpu, parseBatArgs, shortName, validateAccount } from './config';

const WALLET = 'prl1qexampleexampleexampleexample.worker1';

describe('defaults', () => {
  it('ship no personal values and keep safety stop on', () => {
    expect(DEFAULT_SETTINGS.wallet).toBe('');
    expect(DEFAULT_SETTINGS.pool).toBe('');
    expect(DEFAULT_SETTINGS.gpus).toEqual([]);
    expect(DEFAULT_SETTINGS.safetyKill).toBe(true);
    expect(DEFAULT_SETTINGS.openAtLogin).toBe(false);
  });
});

describe('mergeSettings', () => {
  it('merges nested objects and GPUs by id, adding new GPUs', () => {
    const base = { ...DEFAULT_SETTINGS, gpus: [newGpu('a', 'A')] };
    const m = mergeSettings(base, { safety: { ...base.safety, tempStopC: 83 }, minerApi: { adapter: 'srbminer', port: 4000 }, gpus: [{ ...newGpu('a', 'A2'), powerLimitW: 300 }, newGpu('b', 'B')] });
    expect(m.safety).toEqual({ ...DEFAULT_SETTINGS.safety, tempStopC: 83 });
    expect(m.minerApi.port).toBe(4000);
    expect(m.gpus.map((g) => [g.id, g.label, g.powerLimitW])).toEqual([['a', 'A2', 300], ['b', 'B', null]]);
  });

  it('drops unknown keys from 0.1.x settings files (miner launch fields)', () => {
    const old = { wallet: WALLET, pool: 'prl.kryptex.network:8048', minerDir: 'C:\\x', selected: ['a'], consentAt: 1, gpus: [{ id: 'a', label: 'A', srbId: 1, powerLimitW: 280 }] } as never;
    const m = mergeSettings(DEFAULT_SETTINGS, old);
    expect(m.wallet).toBe(WALLET);
    expect(m).not.toHaveProperty('minerDir');
    expect(m).not.toHaveProperty('consentAt');
    expect(m.gpus[0]).toEqual({ ...newGpu('a', 'A'), powerLimitW: 280 });
  });
});

describe('mergeSettings robustness', () => {
  it('survives null / malformed settings files', () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null as never)).toEqual(DEFAULT_SETTINGS);
    expect(mergeSettings(DEFAULT_SETTINGS, { gpus: 'x' } as never).gpus).toEqual([]);
    expect(mergeSettings(DEFAULT_SETTINGS, { gpus: [null, { id: 1 }, { id: 'a' }, { id: 'b', label: 'B' }] } as never).gpus.map((g) => g.id)).toEqual(['b']);
  });
});

describe('validateAccount', () => {
  it('allows empty values and checks formats when filled', () => {
    expect(validateAccount({ wallet: '', pool: '' })).toBeNull();
    expect(validateAccount({ wallet: WALLET, pool: 'prl.kryptex.network:8048' })).toBeNull();
    expect(validateAccount({ wallet: 'prl1abc & calc', pool: '' })).toMatch(/지갑/);
    expect(validateAccount({ wallet: '', pool: 'stratum+tcp://x' })).toMatch(/풀/);
  });
});

describe('isKryptexPool', () => {
  it('detects kryptex hosts only', () => {
    expect(isKryptexPool('prl-hk.kryptex.network:8048')).toBe(true);
    expect(isKryptexPool('kryptex.network.evil.com:8048')).toBe(false);
  });
});

describe('parseBatArgs', () => {
  it('reads wallet and pool from a single-line or ^-continued bat', () => {
    expect(parseBatArgs(`SRBMiner-MULTI.exe --algorithm pearlhash --pool prl-hk.kryptex.network:8048 --wallet ${WALLET}\r\n`)).toEqual({ wallet: WALLET, pool: 'prl-hk.kryptex.network:8048' });
    expect(parseBatArgs(`x.exe ^\r\n  --pool "stratum+tcp://prl.kryptex.network:7048" ^\r\n  --wallet ${WALLET}`)).toEqual({ wallet: WALLET, pool: 'prl.kryptex.network:7048' });
  });
  it('ignores %ENV% placeholders', () => {
    expect(parseBatArgs('x.exe --wallet %WALLET% --pool %POOL%')).toEqual({ wallet: undefined, pool: undefined });
  });
});

describe('shortName', () => {
  it('strips vendor prefixes', () => {
    expect(shortName('NVIDIA GeForce RTX 5090')).toBe('RTX 5090');
  });
});
