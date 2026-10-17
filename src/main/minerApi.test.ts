import { readFileSync } from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { minerApi, MINER_APIS } from './minerApi';

const fixture = readFileSync(path.join(__dirname, 'fixtures/srbminer-api.json'), 'utf8');

describe('miner API registry', () => {
  it('exposes the SRBMiner adapter and rejects unknown ids', () => {
    expect(Object.keys(MINER_APIS)).toEqual(['srbminer']);
    expect(minerApi('srbminer')?.defaultPort).toBe(21550);
    expect(minerApi('nope')).toBeNull();
    expect(minerApi('__proto__')).toBeNull();
  });
});

describe('SRBMiner adapter over HTTP', () => {
  let server: http.Server;
  let port = 0;
  beforeAll(async () => {
    server = http.createServer((_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(fixture);
    });
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
    port = (server.address() as AddressInfo).port;
  });
  afterAll(() => new Promise<void>((r) => server.close(() => r())));

  it('reads stats from 127.0.0.1:<port>', async () => {
    const s = await minerApi('srbminer')!.fetch(port);
    expect(s).toMatchObject({ algorithm: 'pearlhash', accepted: 410, rejected: 2 });
    expect(s.devices.map((d) => d.bus)).toEqual([1, 16]);
  });

  it('fails fast when nothing listens', async () => {
    await expect(minerApi('srbminer')!.fetch(1)).rejects.toThrow();
  });
});
