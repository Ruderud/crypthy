import { describe, expect, it } from 'vitest';
import { DEFAULT_SETTINGS, newGpu } from './config';
import { buildMinerArgs, gpuIdsFor, isKryptexPool, parseBatArgs, parseTasklistPids, validateMinerSettings } from './miner';

const WALLET = 'prl1qexampleexampleexampleexample.worker1';
const gpus = [
  { ...newGpu('00000000:01:00.0', 'GPU A'), srbId: 1 },
  { ...newGpu('00000000:10:00.0', 'GPU B'), srbId: 2 },
  newGpu('00000000:20:00.0', 'GPU C'),
];
const settings = { ...DEFAULT_SETTINGS, wallet: WALLET, pool: 'prl.kryptex.network:8048', minerDir: 'D:\\Miners\\SRBMiner', gpus };
const A = gpus[0].id;
const B = gpus[1].id;
const C = gpus[2].id;

describe('gpuIdsFor', () => {
  const none = new Set<string>();
  it('maps selected GPUs to SRBMiner ids', () => {
    expect(gpuIdsFor([A, B], gpus, none)).toEqual([1, 2]);
    expect(gpuIdsFor([B], gpus, none)).toEqual([2]);
  });
  it('drops safety-excluded GPUs', () => {
    expect(gpuIdsFor([A, B], gpus, new Set([B]))).toEqual([1]);
    expect(gpuIdsFor([B], gpus, new Set([B]))).toEqual([]);
  });
  it('returns null for unmapped GPUs so launch can refuse', () => {
    expect(gpuIdsFor([A, C], gpus, none)).toContain(null);
  });
});

describe('buildMinerArgs', () => {
  it('builds SRBMiner arguments', () => {
    expect(buildMinerArgs(settings, [1, 2]).join(' ')).toBe(
      `--disable-cpu --algorithm pearlhash --pool prl.kryptex.network:8048 --tls true --wallet ${WALLET} --gpu-id 1,2 --api-enable --api-port 21550 --log-file D:\\Miners\\SRBMiner\\logs\\srb.log`,
    );
  });
  it('omits --gpu-id for the mapping detection run', () => {
    expect(buildMinerArgs(settings, [])).not.toContain('--gpu-id');
  });
});

describe('validateMinerSettings', () => {
  it('accepts public address + worker', () => {
    expect(validateMinerSettings(settings)).toBeNull();
  });
  it('rejects disabled preset, bad wallet/pool/port/exe, missing folder', () => {
    expect(validateMinerSettings({ ...settings, coin: 'quantus' })).toMatch(/비활성/);
    expect(validateMinerSettings({ ...settings, wallet: 'prl1abc & calc' })).toMatch(/지갑/);
    expect(validateMinerSettings({ ...settings, wallet: '' })).toMatch(/지갑/);
    expect(validateMinerSettings({ ...settings, pool: 'stratum+tcp://x' })).toMatch(/풀/);
    expect(validateMinerSettings({ ...settings, apiPort: 0 })).toMatch(/포트/);
    expect(validateMinerSettings({ ...settings, minerExe: '..\\evil.exe' })).toMatch(/실행 파일/);
    expect(validateMinerSettings({ ...settings, minerDir: '' })).toMatch(/폴더/);
  });
});

describe('isKryptexPool', () => {
  it('detects kryptex hosts only', () => {
    expect(isKryptexPool('prl-hk.kryptex.network:8048')).toBe(true);
    expect(isKryptexPool('kryptex.network.evil.com:8048')).toBe(false);
    expect(isKryptexPool('pool.example.com:3333')).toBe(false);
  });
});

describe('parseBatArgs', () => {
  it('reads wallet and pool from a single-line or ^-continued bat', () => {
    const one = `@echo off\r\nSRBMiner-MULTI.exe --disable-cpu --algorithm pearlhash --pool prl-hk.kryptex.network:8048 --tls true --wallet ${WALLET} --gpu-id 1,2\r\n`;
    expect(parseBatArgs(one)).toEqual({ wallet: WALLET, pool: 'prl-hk.kryptex.network:8048' });
    const multi = `SRBMiner-MULTI.exe --disable-cpu ^\r\n  --pool "prl-sg.kryptex.network:8048" --tls true ^\r\n  --wallet ${WALLET}`;
    expect(parseBatArgs(multi)).toEqual({ wallet: WALLET, pool: 'prl-sg.kryptex.network:8048' });
  });
  it('ignores %ENV% placeholders', () => {
    expect(parseBatArgs('x.exe --wallet %WALLET%.%WORKER% --pool %POOL%')).toEqual({ wallet: undefined, pool: undefined });
  });
});

describe('parseTasklistPids', () => {
  it('parses CSV rows for the exact image name', () => {
    const out = '"SRBMiner-MULTI.exe","4321","Console","1","812,004 K"\r\n"SRBMiner-MULTI.exe","999","Console","1","10 K"\r\n';
    expect(parseTasklistPids(out, 'SRBMiner-MULTI.exe')).toEqual([4321, 999]);
  });
  it('returns [] for the "no tasks" message', () => {
    expect(parseTasklistPids('INFO: No tasks are running which match the specified criteria.\r\n', 'SRBMiner-MULTI.exe')).toEqual([]);
  });
});
