// 헤드리스 실행 인자 (crypthy-headless). 설정 파일(remote-api.json)보다 인자가 우선한다.
import os from 'node:os';
import path from 'node:path';
import { STATUS_PORT } from './statusApi';

export interface HeadlessOptions {
  dataDir: string;
  bind: string;
  port: number;
  /** 원격 쓰기(켜기·끄기·설정·보류 해제·매도·소급) 허용 */
  enableWrite: boolean;
  /** 채굴 위험·비용 고지에 동의 (화면이 없으므로 인자로) */
  acceptRisk: boolean;
  printTokens: boolean;
  help: boolean;
}

export const HEADLESS_USAGE = `crypthy-headless — Crypthy without a screen (remote API for another Crypthy)

  --data-dir DIR    settings, ledgers and tokens (default: $CRYPTHY_DATA_DIR or ~/.config/Crypthy)
  --bind IP         address for the remote API (default 127.0.0.1; e.g. this PC's Tailscale IP)
  --port N          port (default ${STATUS_PORT})
  --enable-write    allow remote start/stop, settings, clearing holds (separate write token)
  --accept-risk     accept the mining risk and cost notice (needed before the first start)
  --print-tokens    print the read/write tokens and exit
  --help
`;

/** remote-api.json (선택): { "bind": "100.x.y.z", "port": 47321, "enableWrite": false } */
export interface HeadlessFileConfig {
  bind?: unknown;
  port?: unknown;
  enableWrite?: unknown;
}

export function parseHeadlessArgs(argv: string[], env: NodeJS.ProcessEnv, file: HeadlessFileConfig = {}): HeadlessOptions {
  const flag = (name: string) => argv.includes(name);
  const value = (name: string): string | undefined => {
    const i = argv.indexOf(name);
    if (i === -1) return undefined;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) throw new Error(`${name} 에 값이 필요합니다`);
    return v;
  };
  const known = new Set(['--data-dir', '--bind', '--port', '--enable-write', '--accept-risk', '--print-tokens', '--help', '-h']);
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('-')) continue;
    if (!known.has(argv[i])) throw new Error(`알 수 없는 인자: ${argv[i]}`);
    if (['--data-dir', '--bind', '--port'].includes(argv[i])) i++;
  }
  const portRaw = value('--port') ?? (typeof file.port === 'number' ? String(file.port) : undefined);
  const port = portRaw === undefined ? STATUS_PORT : Number(portRaw);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('포트는 1024~65535 정수여야 합니다');
  return {
    dataDir: path.resolve(value('--data-dir') ?? env.CRYPTHY_DATA_DIR ?? path.join(os.homedir(), '.config', 'Crypthy')),
    bind: value('--bind') ?? (typeof file.bind === 'string' ? file.bind : '127.0.0.1'),
    port,
    enableWrite: flag('--enable-write') || file.enableWrite === true,
    acceptRisk: flag('--accept-risk'),
    printTokens: flag('--print-tokens'),
    help: flag('--help') || flag('-h'),
  };
}
