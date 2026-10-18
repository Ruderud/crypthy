import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import type { AppState, Settings } from '../shared/types';
import { NeedConfirm, type ConfirmKind } from './confirm';
import { DEFAULT_SETTINGS } from './config';
import { allowedHosts, createRemoteApiHandler, ensureToken, maskWallet, sanitizePatch, tokenMatches, validateBind, type RemoteHandlers } from './remoteApi';

const WALLET = 'prl1qexamplewalletaddressxyz0000000000.rig1';
const READ = 'r'.repeat(43);
const WRITE = 'w'.repeat(43);

const fakeState = () =>
  ({
    ts: 1, miner: { running: false, mode: null, pool: null, uptimeS: null, accepted: null, rejected: null }, gpus: [], alerts: [], pnl: null,
    settings: { ...DEFAULT_SETTINGS, wallet: WALLET, minerControl: { ...DEFAULT_SETTINGS.minerControl, args: '--algorithm pearlhash --wallet prl1qexamplewalletaddressxyz0000000000.rig1 --user prl1otherwalletaddress9999 --pool x:1' } },
  }) as unknown as AppState;

function handlers(log: string[] = []): RemoteHandlers {
  return {
    state: fakeState,
    charts: () => ({ gpus: [], price: [], daily: [], pnl: [], symbol: 'PRL' }),
    async start(accept: ConfirmKind[]) {
      log.push(`start ${accept.join(',')}`);
      if (!accept.includes('consent')) throw new NeedConfirm('consent', 'notice');
      return null;
    },
    async stop(accept) {
      log.push(`stop ${accept.join(',')}`);
      return null;
    },
    async setGpu(id, mine) {
      log.push(`gpu ${id} ${mine}`);
      return null;
    },
    saveSettings(patch: Partial<Settings>) {
      log.push(`settings ${JSON.stringify(patch)}`);
      return null;
    },
    clearHold: (id) => void log.push(`clear ${id}`),
    addSale: () => null,
    backfill: () => null,
  };
}

const servers: http.Server[] = [];
afterEach(() => servers.splice(0).forEach((s) => s.close()));

async function serve(writeToken: string | null, log: string[] = []) {
  const server = http.createServer();
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const port = (server.address() as AddressInfo).port;
  server.on('request', createRemoteApiHandler({ bind: '127.0.0.1', port, readToken: READ, writeToken }, handlers(log)));
  const call = async (method: string, url: string, o: { token?: string; host?: string; body?: unknown } = {}) => {
    const res = await new Promise<http.IncomingMessage & { text: string }>((resolve, reject) => {
      const req = http.request(
        {
          host: '127.0.0.1', port, method, path: url,
          headers: {
            host: o.host ?? `127.0.0.1:${port}`,
            ...(o.token ? { authorization: `Bearer ${o.token}` } : {}),
            ...(o.body !== undefined ? { 'content-type': 'application/json' } : {}),
          },
        },
        (r) => {
          let text = '';
          r.on('data', (c) => (text += c));
          r.on('end', () => resolve(Object.assign(r, { text })));
        },
      );
      req.on('error', reject);
      if (o.body !== undefined) req.write(JSON.stringify(o.body));
      req.end();
    });
    return { status: res.statusCode, json: JSON.parse(res.text) };
  };
  return { port, call };
}

describe('remote API: reading', () => {
  it('rejects a foreign Host header (DNS rebinding)', async () => {
    const { call } = await serve(null);
    expect((await call('GET', '/v1/state', { token: READ, host: 'evil.example:80' })).status).toBe(403);
  });

  it('full state needs the read token and never contains the wallet address', async () => {
    const { call } = await serve(null);
    expect((await call('GET', '/v1/state')).status).toBe(401);
    expect((await call('GET', '/v1/state', { token: 'x'.repeat(43) })).status).toBe(401);
    const r = await call('GET', '/v1/state', { token: READ });
    expect(r.status).toBe(200);
    expect(r.json.settings.wallet).toBe('prl1qe…0000.rig1');
    expect(JSON.stringify(r.json)).not.toContain('examplewallet');
    expect(r.json.settings.minerControl.args).toBe('--algorithm pearlhash --wallet prl1qe…0000.rig1 --user prl1ot…9999 --pool x:1');
    expect((await call('GET', '/v1/charts', { token: READ })).json.symbol).toBe('PRL');
  });

  it('keeps the old compact /v1/status open for this PC only', async () => {
    const { call } = await serve(null);
    expect((await call('GET', '/v1/status')).status).toBe(200);
  });
});

describe('remote API: writing', () => {
  it('is read-only unless writes were enabled', async () => {
    const log: string[] = [];
    const { call } = await serve(null, log);
    const r = await call('POST', '/v1/miner/stop', { token: READ, body: {} });
    expect(r.status).toBe(403);
    expect(r.json.error).toBe('read_only');
    expect(log).toEqual([]);
  });

  it('needs the write token (the read token is not enough)', async () => {
    const log: string[] = [];
    const { call } = await serve(WRITE, log);
    expect((await call('POST', '/v1/miner/stop', { token: READ, body: {} })).status).toBe(401);
    expect((await call('POST', '/v1/miner/stop', { token: WRITE, body: { accept: ['stop'] } })).status).toBe(200);
    expect(log).toEqual(['stop stop']);
  });

  it('per-GPU mining needs the write token and a boolean', async () => {
    const log: string[] = [];
    const { call } = await serve(WRITE, log);
    expect((await call('POST', '/v1/miner/gpu', { token: READ, body: { id: '00000000:01:00.0', mine: false } })).status).toBe(401);
    expect((await call('POST', '/v1/miner/gpu', { token: WRITE, body: { id: '00000000:01:00.0', mine: 'no' } })).status).toBe(400);
    expect((await call('POST', '/v1/miner/gpu', { token: WRITE, body: { id: '00000000:01:00.0', mine: false } })).status).toBe(200);
    expect(log).toEqual(['gpu 00000000:01:00.0 false']);
  });

  it('asks the client for consent instead of starting silently', async () => {
    const log: string[] = [];
    const { call } = await serve(WRITE, log);
    const first = await call('POST', '/v1/miner/start', { token: WRITE, body: {} });
    expect(first.status).toBe(409);
    expect(first.json).toMatchObject({ needs: 'consent', detail: 'notice' });
    expect((await call('POST', '/v1/miner/start', { token: WRITE, body: { accept: ['consent', 'bogus'] } })).status).toBe(200);
    expect(log).toEqual(['start ', 'start consent']);
  });

  it('a masked wallet sent back from a remote screen does not overwrite the real one', async () => {
    const log: string[] = [];
    const { call } = await serve(WRITE, log);
    await call('POST', '/v1/settings', { token: WRITE, body: { patch: { wallet: 'prl1qe…0000.rig1', pool: 'prl.kryptex.network:8048' } } });
    expect(log).toEqual(['settings {"pool":"prl.kryptex.network:8048"}']);
    expect(sanitizePatch([1, 2])).toEqual({});
  });

  it('cannot change the miner command, safety settings or login start from remote (no remote code execution)', async () => {
    const log: string[] = [];
    const { call } = await serve(WRITE, log);
    await call('POST', '/v1/settings', {
      token: WRITE,
      body: { patch: { minerControl: { mode: 'direct', exe: '/usr/bin/perl', args: '-e evil' }, safetyKill: false, safety: { tempStopC: 95 }, openAtLogin: true, autoStartMining: true, sharedLedgerDir: '/tmp', gpus: [] } },
    });
    expect(log).toEqual(['settings {"gpus":[]}']);
  });
});

describe('binding, tokens and masking', () => {
  it('binds only to a specific IP, never to every interface', () => {
    expect(validateBind('127.0.0.1')).toBeNull();
    expect(validateBind('100.101.102.103')).toBeNull();
    expect(validateBind('fd7a:115c:a1e0::1')).toBeNull();
    expect(validateBind('0.0.0.0')).not.toBeNull();
    expect(validateBind('::')).not.toBeNull();
    expect(validateBind('my-host.ts.net')).not.toBeNull();
    for (const all of ['::0', '0:0:0:0:0:0:0:0', '::ffff:0.0.0.0', '0000::0000']) expect(validateBind(all), all).not.toBeNull();
    expect([...allowedHosts('100.101.102.103', 47321)]).toEqual(['127.0.0.1:47321', 'localhost:47321', '100.101.102.103:47321']);
    expect(allowedHosts('fd7a:115c:a1e0::1', 47321).has('[fd7a:115c:a1e0::1]:47321')).toBe(true);
  });

  it('creates a random token file readable only by the owner, and reuses it', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypthy-token-'));
    const f = path.join(dir, 'remote-read.token');
    const t = ensureToken(f);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ensureToken(f)).toBe(t);
    if (process.platform !== 'win32') {
      expect(fs.statSync(f).mode & 0o777).toBe(0o600);
      fs.chmodSync(f, 0o644);
      ensureToken(f);
      expect(fs.statSync(f).mode & 0o777).toBe(0o600);
    }
    fs.rmSync(dir, { recursive: true });
  });

  it('compares tokens without accepting empty values', () => {
    expect(tokenMatches(READ, READ)).toBe(true);
    expect(tokenMatches(READ, null)).toBe(false);
    expect(tokenMatches(null, READ)).toBe(false);
    expect(tokenMatches('', '')).toBe(false);
  });

  it('masks wallets but keeps the worker name', () => {
    expect(maskWallet(WALLET)).toBe('prl1qe…0000.rig1');
    expect(maskWallet('short')).toBe('…');
    expect(maskWallet('')).toBe('');
  });
});
