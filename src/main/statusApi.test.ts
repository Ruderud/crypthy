import http from 'node:http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { AppState } from '../shared/types';
import { DEFAULT_SETTINGS } from './config';
import { buildStatus, startStatusServer, STATUS_PORT } from './statusApi';

const state: AppState = {
  ts: 1, mock: true,
  setup: { minerFound: true, walletSet: true, poolSet: true, gpusMapped: true, consented: true },
  miner: { running: true, mode: 'all', gpuIds: [1, 2], pool: 'p:1', latencyMs: 3, uptimeS: 10, accepted: 5, rejected: 1, totalHashrate: 9, apiOk: true },
  gpus: Array.from({ length: 12 }, (_, i) => ({
    id: `0000000${i}:01:00.0`, label: 'x', index: i, name: 'N'.repeat(500), srbId: i, tempC: 60, fanPct: 50, powerW: 500, powerLimitW: 600,
    powerMinW: 400, powerMaxW: 600, utilPct: 100, hashrate: 1, selected: true, mining: true, excluded: null, present: true,
  })),
  alerts: Array.from({ length: 50 }, (_, i) => ({ ts: i, level: 'warn' as const, code: 'temp_warn', gpu: 'g', message: 'm' })),
  profit: {} as AppState['profit'],
  power: { registered: false, lastLog: null },
  settings: { ...DEFAULT_SETTINGS, wallet: 'prl1secretish.worker1' },
};

describe('buildStatus', () => {
  it('is bounded and excludes settings/wallet', () => {
    const b = buildStatus(state);
    expect(b.gpus).toHaveLength(8);
    expect(b.alerts).toHaveLength(20);
    expect(b.gpus[0].name).toHaveLength(120);
    expect(Object.keys(b)).toEqual(['ts', 'miner', 'gpus', 'alerts']);
    expect(Object.keys(b.miner)).toEqual(['running', 'mode', 'pool', 'uptime_s', 'accepted', 'rejected']);
    expect(Object.keys(b.gpus[0])).toEqual(['index', 'name', 'temp_c', 'fan_pct', 'power_w', 'power_limit_w', 'util_pct', 'hashrate']);
    expect(JSON.stringify(b)).not.toContain('prl1');
  });
});

describe('status server', () => {
  let server: http.Server;
  beforeAll(async () => {
    server = startStatusServer(() => state, (e) => { throw e; });
    await new Promise<void>((r) => server.once('listening', () => r()));
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  const req = (method: string, p: string, host = `127.0.0.1:${STATUS_PORT}`) =>
    new Promise<{ code: number; body: string }>((resolve, reject) => {
      const r = http.request({ host: '127.0.0.1', port: STATUS_PORT, method, path: p, headers: { host } }, (res) => {
        let body = '';
        res.on('data', (d) => (body += d)).on('end', () => resolve({ code: res.statusCode ?? 0, body }));
      });
      r.on('error', reject).end();
    });

  it('serves GET /v1/status only', async () => {
    const ok = await req('GET', '/v1/status');
    expect(ok.code).toBe(200);
    expect(JSON.parse(ok.body).miner.running).toBe(true);
    expect((await req('POST', '/v1/status')).code).toBe(405);
    expect((await req('GET', '/v1/start')).code).toBe(404);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    expect((await req('GET', '/v1/status', 'evil.example:47321')).code).toBe(403);
  });

  it('binds to loopback only', () => {
    expect((server.address() as { address: string }).address).toBe('127.0.0.1');
  });
});
