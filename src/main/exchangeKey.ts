// SafeTrade API 키 입력 확인·헤드리스 키 파일 읽기.
// 키는 사용자가 직접 넣는다: 데스크톱은 화면 입력 → OS 보안 저장소(safeStorage), 헤드리스는 0600 파일이나 systemd credential.
// 이 모듈은 키 값을 로그·오류 문장에 넣지 않는다 (오류에는 파일 경로와 이유만).
import fs from 'node:fs';
import path from 'node:path';
import type { ExchangeKey } from './safetrade';

const KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** 화면에서 받은 키·시크릿 확인. 문제가 있으면 오류 문장 (값은 넣지 않는다) */
export function parseKeyInput(key: unknown, secret: unknown): ExchangeKey | string {
  const k = typeof key === 'string' ? key.trim() : '';
  const s = typeof secret === 'string' ? secret.trim() : '';
  if (!KEY_RE.test(k)) return 'API 키 형식이 올바르지 않습니다 (영문·숫자 8~128자)';
  if (!KEY_RE.test(s)) return '시크릿 형식이 올바르지 않습니다 (영문·숫자 8~128자)';
  if (k === s) return 'API 키와 시크릿이 같습니다';
  return { key: k, secret: s };
}

/**
 * 헤드리스: 키 파일 {"key": "...", "secret": "..."} 을 읽는다.
 * systemd LoadCredential 로 받은 파일($CREDENTIALS_DIRECTORY)을 먼저, 없으면 데이터 폴더의 safetrade-key.json.
 * 데이터 폴더의 파일은 소유자만 읽을 수 있어야 한다 (0600 보다 넓으면 쓰지 않는다).
 */
export function loadKeyFile(dataDir: string, env: NodeJS.ProcessEnv = process.env): { key: ExchangeKey | null; store: string | null; error: string | null } {
  const cred = env.CREDENTIALS_DIRECTORY ? path.join(env.CREDENTIALS_DIRECTORY, 'safetrade-key.json') : null;
  const own = path.join(dataDir, 'safetrade-key.json');
  const file = cred && fs.existsSync(cred) ? cred : fs.existsSync(own) ? own : null;
  if (!file) return { key: null, store: null, error: null };
  const store = file === cred ? 'systemd credential' : '0600 파일';
  try {
    if (file === own && process.platform !== 'win32') {
      const mode = fs.statSync(file).mode & 0o777;
      if (mode & 0o077) return { key: null, store, error: `${file} 권한이 ${mode.toString(8)} 입니다 — chmod 600 으로 소유자만 읽게 하세요` };
    }
    const j = JSON.parse(fs.readFileSync(file, 'utf8')) as { key?: unknown; secret?: unknown };
    const k = parseKeyInput(j.key, j.secret);
    return typeof k === 'string' ? { key: null, store, error: `${file}: ${k}` } : { key: k, store, error: null };
  } catch {
    return { key: null, store, error: `${file} 를 읽을 수 없습니다 (JSON {"key": "...", "secret": "..."})` };
  }
}
