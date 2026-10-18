import { describe, expect, it } from 'vitest';
import { createRemoteClient, normalizeRemoteUrl, postWithConfirm } from './remoteClient';

const reply = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('remote host address', () => {
  it('accepts host[:port] with http(s) and defaults the port', () => {
    expect(normalizeRemoteUrl('100.101.102.103')).toBe('http://100.101.102.103:47321');
    expect(normalizeRemoteUrl(' http://100.101.102.103:48000/ ')).toBe('http://100.101.102.103:48000');
    expect(normalizeRemoteUrl('rud.tailnet.ts.net')).toBe('http://rud.tailnet.ts.net:47321');
    expect(normalizeRemoteUrl('http://[fd7a:115c:a1e0::1]:47321')).toBe('http://[fd7a:115c:a1e0::1]:47321');
  });

  it('refuses paths, credentials and other schemes', () => {
    for (const bad of ['', 'file:///etc/passwd', 'http://user:pw@host', 'http://host/v1/state', 'javascript:alert(1)', 'http://host?x=1']) {
      expect(normalizeRemoteUrl(bad)).toBeNull();
    }
  });
});

describe('remote client', () => {
  it('reads with the read token and writes with the write token', async () => {
    const seen: [string, string | null][] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      seen.push([url, new Headers(init?.headers).get('authorization')]);
      return reply(200, url.endsWith('/v1/state') ? { ts: 1 } : { ok: true });
    }) as typeof fetch;
    const c = createRemoteClient({ url: 'http://h:1', readToken: 'R', writeToken: 'W' }, fetchImpl);
    expect(await c.state()).toEqual({ ts: 1 });
    expect(await c.post('/v1/miner/stop', {})).toEqual({ ok: true });
    expect(seen).toEqual([['http://h:1/v1/state', 'Bearer R'], ['http://h:1/v1/miner/stop', 'Bearer W']]);
  });

  it('without a write token it stays read-only and sends nothing', async () => {
    let called = false;
    const c = createRemoteClient({ url: 'http://h:1', readToken: 'R', writeToken: null }, (async () => ((called = true), reply(200, {}))) as unknown as typeof fetch);
    expect(await c.post('/v1/miner/start', {})).toMatchObject({ error: expect.stringContaining('읽기 전용') });
    expect(called).toBe(false);
  });

  it('asks on this PC when the host needs consent, then resends with the confirmation', async () => {
    const bodies: unknown[] = [];
    const fetchImpl = (async (_u: string, init?: RequestInit) => {
      const b = JSON.parse(String(init?.body));
      bodies.push(b);
      if (!b.accept.includes('consent')) return reply(409, { error: 'confirm', needs: 'consent', detail: 'notice' });
      if (!b.accept.includes('danger')) return reply(409, { error: 'confirm', needs: 'danger', detail: 'fan stopped' });
      return reply(200, { ok: true });
    }) as typeof fetch;
    const c = createRemoteClient({ url: 'http://h:1', readToken: 'R', writeToken: 'W' }, fetchImpl);
    const asked: string[] = [];
    expect(await postWithConfirm(c, '/v1/miner/start', {}, async (k, d) => (asked.push(`${k}:${d}`), true))).toBeNull();
    expect(asked).toEqual(['consent:notice', 'danger:fan stopped']);
    expect(bodies.at(-1)).toEqual({ accept: ['consent', 'danger'] });
    expect(await postWithConfirm(c, '/v1/miner/start', {}, async () => false)).toBe('취소됨');
  });
});
