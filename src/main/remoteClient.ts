// 원격 호스트(헤드리스 Crypthy)에 붙는 클라이언트. Electron 메인 프로세스에서만 쓰고, 토큰은 화면(렌더러)에 넘기지 않는다.
import type { AppState, ChartsView } from '../shared/types';
import type { ConfirmKind } from './confirm';

export interface RemoteTarget {
  /** http://IP:port (경로 없음) */
  url: string;
  readToken: string;
  /** 없으면 읽기 전용으로 붙는다 */
  writeToken: string | null;
}

export type PostResult = { ok: true } | { needs: ConfirmKind; detail: string } | { error: string };

/** 주소 정리: http(s)://host[:port] 만 허용 (경로·사용자 정보 불가). 포트가 없으면 47321 */
export function normalizeRemoteUrl(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;
  let u: URL;
  try {
    u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `http://${raw}`);
  } catch {
    return null;
  }
  if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || (u.pathname !== '/' && u.pathname !== '') || u.search || u.hash) return null;
  return `${u.protocol}//${u.hostname.includes(':') && !u.hostname.startsWith('[') ? `[${u.hostname}]` : u.hostname}:${u.port || '47321'}`;
}

const TIMEOUT_MS = 5000;

export function createRemoteClient(t: RemoteTarget, fetchImpl: typeof fetch = fetch) {
  const get = async <T>(p: string): Promise<T> => {
    const res = await fetchImpl(`${t.url}${p}`, { headers: { authorization: `Bearer ${t.readToken}` }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (res.status === 401) throw new Error('토큰이 맞지 않습니다');
    if (!res.ok) throw new Error(`원격 호스트 응답 ${res.status}`);
    return (await res.json()) as T;
  };
  return {
    state: () => get<AppState>('/v1/state'),
    charts: () => get<ChartsView>('/v1/charts'),
    async post(p: string, body: unknown): Promise<PostResult> {
      if (!t.writeToken) return { error: '읽기 전용으로 연결되어 있습니다 (쓰기 토큰을 넣으면 원격으로 조작할 수 있습니다)' };
      const res = await fetchImpl(`${t.url}${p}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${t.writeToken}`, 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
      const j = (await res.json().catch(() => ({}))) as { needs?: ConfirmKind; detail?: string; message?: string; error?: string };
      if (res.status === 409 && j.needs) return { needs: j.needs, detail: j.detail ?? '' };
      if (res.ok) return { ok: true };
      if (res.status === 401) return { error: '쓰기 토큰이 맞지 않습니다' };
      return { error: j.message ?? j.error ?? `원격 호스트 응답 ${res.status}` };
    },
  };
}

/**
 * 원격 쓰기 + 확인 흐름: 호스트가 확인(동의·위험 정지·끄기)을 요구하면 이 PC 에서 묻고, 받은 확인을 담아 다시 보낸다.
 * 반환은 IPC 와 같은 형식(오류 문장 또는 null).
 */
export async function postWithConfirm(
  client: ReturnType<typeof createRemoteClient>,
  p: string,
  body: Record<string, unknown>,
  ask: (kind: ConfirmKind, detail: string) => Promise<boolean>,
): Promise<string | null> {
  const accept: ConfirmKind[] = [];
  for (let i = 0; i < 4; i++) {
    const r = await client.post(p, { ...body, accept });
    if ('ok' in r) return null;
    if ('error' in r) return r.error;
    if (accept.includes(r.needs) || !(await ask(r.needs, r.detail))) return '취소됨';
    accept.push(r.needs);
  }
  return '확인 단계가 너무 많습니다';
}
