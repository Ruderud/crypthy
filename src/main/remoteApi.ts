// 헤드리스 호스트의 원격 API (Tailscale 같은 사설망에서 다른 PC 의 Crypthy 가 붙어 같은 화면을 본다).
//
// 원칙
//  - 기본은 127.0.0.1 에만, 읽기 전용. 다른 주소는 사용자가 지정한 IP 하나에만 연다 (0.0.0.0 같은 전체 공개 불가)
//  - 모든 /v1/state·/v1/charts 는 읽기 토큰(Bearer) 필요. 쓰기(켜기·끄기·설정·보류 해제·매도·소급)는
//    쓰기를 명시적으로 켠 경우에만, 별도 쓰기 토큰으로
//  - Host 헤더는 127.0.0.1·localhost·지정 IP 와 포트만 받는다 (DNS rebinding 차단)
//  - 응답에 지갑 주소 원문·토큰을 넣지 않는다
//  - 이전 버전과 같은 GET /v1/status(요약)는 이 PC(loopback)에서 오면 토큰 없이도 준다
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import type { AppState, ChartsView, SaleInput, Settings } from '../shared/types';
import { NeedConfirm, type ConfirmKind } from './confirm';
import { buildStatus } from './statusApi';

export interface RemoteApiConfig {
  /** 바인딩 IP (127.0.0.1 기본, 또는 Tailscale 100.x 같은 특정 IP) */
  bind: string;
  port: number;
  readToken: string;
  /** null 이면 쓰기 끔 */
  writeToken: string | null;
}

export interface RemoteHandlers {
  state(): AppState;
  charts(): ChartsView;
  start(accept: ConfirmKind[]): Promise<string | null>;
  /** GPU 별 채굴 켜기·끄기 (채굴 중이면 다시 시작) */
  setGpu(id: string, mine: boolean, accept: ConfirmKind[]): Promise<string | null>;
  stop(accept: ConfirmKind[]): Promise<string | null>;
  saveSettings(patch: Partial<Settings>): string | null;
  clearHold(id: string): void;
  addSale(sale: SaleInput): string | null;
  backfill(fromMs: unknown, watts: unknown): string | null;
}

const MAX_BODY = 64 * 1024;
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

/** IPv6 를 표준 표기로 (::0, 0:0:…:0 → ::) */
const canonicalIp = (ip: string) => (net.isIPv6(ip) ? new URL(`http://[${ip}]/`).hostname.slice(1, -1) : ip);

/** 바인딩 주소: IP 리터럴만, 전체 공개(0.0.0.0, ::, ::ffff:0.0.0.0 등) 불가 */
export function validateBind(bind: string): string | null {
  if (!net.isIP(bind)) return `바인딩 주소는 IP 여야 합니다: ${bind}`;
  const c = canonicalIp(bind);
  if (c === '0.0.0.0' || c === '::' || c === '::ffff:0:0' || c === '::ffff:0.0.0.0') return '모든 주소(0.0.0.0, ::)에는 열지 않습니다 — Tailscale IP 처럼 특정 IP 를 지정하세요';
  return null;
}

/** Host 헤더 허용 목록: 127.0.0.1·localhost·지정 IP (IPv6 는 [..]) + 포트 */
export function allowedHosts(bind: string, port: number): Set<string> {
  const h = new Set([`127.0.0.1:${port}`, `localhost:${port}`]);
  h.add(net.isIPv6(bind) ? `[${bind}]:${port}` : `${bind}:${port}`);
  return h;
}

/** 지갑 주소는 앞 6자·끝 4자만 (워커명은 그대로) */
export function maskWallet(w: string): string {
  if (!w) return w;
  const [addr, worker] = w.split('.', 2);
  const m = addr.length > 12 ? `${addr.slice(0, 6)}…${addr.slice(-4)}` : '…';
  return worker ? `${m}.${worker}` : m;
}

/** 채굴기 인자 속 지갑(--wallet/--user 값, 설정 지갑 문자열)도 가린다 */
export function maskArgs(args: string, wallet: string): string {
  let out = args;
  const addr = wallet.split('.')[0];
  if (addr.length >= 8) out = out.split(addr).join(maskWallet(addr));
  return out.replace(/(--(?:wallet|user|u)[=\s]+)("?)([^\s"]{13,})\2/gi, (_m, flag: string, q: string, v: string) => `${flag}${q}${v.includes('…') ? v : maskWallet(v)}${q}`);
}

/** 원격으로 내보낼 상태: 지갑 원문 제거 (설정의 지갑, 채굴기 인자 안의 지갑) */
export function sanitizeState(st: AppState): AppState {
  const s = st.settings;
  return { ...st, settings: { ...s, wallet: maskWallet(s.wallet), minerControl: { ...s.minerControl, args: maskArgs(s.minerControl.args, s.wallet) } } };
}

/**
 * 원격에서 바꿀 수 있는 설정 (허용 목록). 채굴 켜기·끄기 방식(실행 파일·인자·작업·유닛), 안전 정지 설정,
 * 로그인 시 실행은 호스트에서만 바꾼다 — 쓰기 토큰만으로 호스트에서 임의 프로그램을 실행하거나 안전 정지를 끄지 못하게.
 */
export const REMOTE_SETTING_KEYS = new Set<keyof Settings>(['coin', 'wallet', 'pool', 'minerApi', 'updateIntervalMin', 'gpus', 'profit']);

/** 원격에서 온 설정 변경: 허용한 항목만, 가려진 지갑(… 포함)은 바꾸지 않는다 */
export function sanitizePatch(patch: unknown): Partial<Settings> {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return {};
  const p = Object.fromEntries(Object.entries(patch).filter(([k]) => REMOTE_SETTING_KEYS.has(k as keyof Settings))) as Partial<Settings>;
  if (typeof p.wallet === 'string' && p.wallet.includes('…')) delete p.wallet;
  return p;
}

const digest = (s: string) => crypto.createHash('sha256').update(s).digest();
/** 길이와 무관하게 일정 시간 비교 */
export function tokenMatches(given: string | null, expected: string | null): boolean {
  if (!given || !expected) return false;
  return crypto.timingSafeEqual(digest(given), digest(expected));
}

const bearer = (req: http.IncomingMessage) => /^Bearer\s+(\S+)$/i.exec(req.headers.authorization ?? '')?.[1] ?? null;

/** 토큰 파일을 읽거나 없으면 만든다 (0600). 권한이 넓으면 0600 으로 좁힌다 */
export function ensureToken(file: string): string {
  try {
    const t = fs.readFileSync(file, 'utf8').trim();
    if (t.length >= 32) {
      if (process.platform !== 'win32' && (fs.statSync(file).mode & 0o077) !== 0) fs.chmodSync(file, 0o600);
      return t;
    }
  } catch {
    // 없으면 새로 만든다
  }
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const t = crypto.randomBytes(32).toString('base64url');
  fs.writeFileSync(file, `${t}\n`, { mode: 0o600 });
  if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
  return t;
}

function readBody(req: http.IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new Error('too_large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new Error('bad_json'));
      }
    });
    req.on('error', reject);
  });
}

const acceptOf = (b: unknown): ConfirmKind[] =>
  Array.isArray((b as { accept?: unknown })?.accept) ? ((b as { accept: unknown[] }).accept.filter((k) => k === 'consent' || k === 'danger' || k === 'stop') as ConfirmKind[]) : [];

export function createRemoteApiHandler(cfg: RemoteApiConfig, h: RemoteHandlers): http.RequestListener {
  const hosts = allowedHosts(cfg.bind, cfg.port);
  return async (req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
      res.end(JSON.stringify(body));
    };
    try {
      if (!hosts.has(req.headers.host ?? '')) return send(403, { error: 'forbidden_host' });
      const url = (req.url ?? '').split('?')[0];
      const local = LOOPBACK.has(req.socket.remoteAddress ?? '');
      const token = bearer(req);
      const canRead = tokenMatches(token, cfg.readToken) || tokenMatches(token, cfg.writeToken);

      if (req.method === 'GET') {
        if (url === '/v1/status') {
          if (!local && !canRead) return send(401, { error: 'unauthorized' });
          return send(200, buildStatus(h.state()));
        }
        if (url === '/v1/state' || url === '/v1/charts') {
          if (!canRead) return send(401, { error: 'unauthorized' });
          return send(200, url === '/v1/state' ? sanitizeState(h.state()) : h.charts());
        }
        return send(404, { error: 'not_found' });
      }
      if (req.method !== 'POST') return send(405, { error: 'method_not_allowed' });
      if (!cfg.writeToken) return send(403, { error: 'read_only', message: '이 호스트는 읽기 전용입니다 (헤드리스를 --enable-write 로 실행해야 원격 조작 가능)' });
      if (!tokenMatches(token, cfg.writeToken)) return send(401, { error: 'unauthorized' });
      if (!/^application\/json\b/i.test(req.headers['content-type'] ?? '')) return send(415, { error: 'json_required' });
      const body = await readBody(req);
      const result = (err: string | null) => send(err ? 400 : 200, err ? { error: 'rejected', message: err } : { ok: true });
      switch (url) {
        case '/v1/miner/start':
          return result(await h.start(acceptOf(body)));
        case '/v1/miner/stop':
          return result(await h.stop(acceptOf(body)));
        case '/v1/miner/gpu': {
          const b = body as { id?: unknown; mine?: unknown };
          if (typeof b?.id !== 'string' || typeof b.mine !== 'boolean') return send(400, { error: 'bad_request' });
          return result(await h.setGpu(b.id, b.mine, acceptOf(body)));
        }
        case '/v1/settings':
          return result(h.saveSettings(sanitizePatch((body as { patch?: unknown })?.patch)));
        case '/v1/holds/clear': {
          const id = (body as { id?: unknown })?.id;
          if (typeof id !== 'string' || !id) return send(400, { error: 'bad_request' });
          h.clearHold(id);
          return send(200, { ok: true });
        }
        case '/v1/pnl/sale':
          return result(h.addSale((body as { sale?: SaleInput })?.sale as SaleInput));
        case '/v1/pnl/backfill':
          return result(h.backfill((body as { fromMs?: unknown })?.fromMs, (body as { watts?: unknown })?.watts));
        default:
          return send(404, { error: 'not_found' });
      }
    } catch (e) {
      if (e instanceof NeedConfirm) return send(409, { error: 'confirm', needs: e.kind, detail: e.detail });
      const msg = (e as Error).message;
      if (msg === 'too_large') return send(413, { error: 'too_large' });
      if (msg === 'bad_json') return send(400, { error: 'bad_json' });
      return send(500, { error: 'internal' });
    }
  };
}

export function startRemoteApi(cfg: RemoteApiConfig, h: RemoteHandlers, onError: (e: Error) => void): http.Server {
  const err = validateBind(cfg.bind);
  if (err) throw new Error(err);
  const server = http.createServer(createRemoteApiHandler(cfg, h));
  server.on('error', onError);
  server.listen(cfg.port, cfg.bind);
  return server;
}
