import { execFile, spawn } from 'node:child_process';
import path from 'node:path';
import type { CoinId, GpuConfig, GpuId, Settings } from '../shared/types';

export interface CoinPreset {
  label: string;
  algorithm: string;
  tls: boolean;
  /** Kryptex 풀 API 경로의 티커 (풀이 *.kryptex.network 일 때만 수익 조회) */
  kryptexTicker: string;
  coingeckoId: string;
  enabled: boolean;
}

export const COIN_PRESETS: Record<CoinId, CoinPreset> = {
  pearl: {
    label: 'Pearl (PRL) · pearlhash',
    algorithm: 'pearlhash',
    tls: true,
    kryptexTicker: 'prl',
    coingeckoId: 'pearl-2',
    enabled: true,
  },
  // 알고리즘·풀·시세 ID 검증 전이라 비활성. 검증 후 값 채우고 enabled: true.
  quantus: {
    label: 'Quantus (검증 전)',
    algorithm: '',
    tls: true,
    kryptexTicker: '',
    coingeckoId: '',
    enabled: false,
  },
};

/** 선택한 GPU 중 안전 제외되지 않은 것의 SRBMiner --gpu-id 목록 (매핑 안 된 GPU는 null) */
export function gpuIdsFor(selected: GpuId[], gpus: GpuConfig[], excluded: ReadonlySet<GpuId>): (number | null)[] {
  return gpus
    .filter((g) => selected.includes(g.id) && !excluded.has(g.id))
    .map((g) => g.srbId)
    .sort((a, b) => (a ?? -1) - (b ?? -1));
}

const WALLET_RE = /^[a-z0-9]{10,120}(\.[A-Za-z0-9_-]{1,32})?$/;
const POOL_RE = /^[A-Za-z0-9.-]+:\d{2,5}$/;
const EXE_RE = /^[\w.-]+\.exe$/i;

export function validateMinerSettings(s: Pick<Settings, 'wallet' | 'pool' | 'coin' | 'apiPort' | 'minerExe' | 'minerDir'>): string | null {
  if (!COIN_PRESETS[s.coin]?.enabled) return `코인 프리셋 '${s.coin}'은(는) 비활성 상태입니다`;
  if (!WALLET_RE.test(s.wallet)) return '지갑 주소 형식이 올바르지 않습니다 (공개 주소[.워커])';
  if (!POOL_RE.test(s.pool)) return '풀 주소는 host:port 형식이어야 합니다';
  if (!Number.isInteger(s.apiPort) || s.apiPort < 1024 || s.apiPort > 65535) return 'API 포트는 1024~65535 정수여야 합니다';
  if (!EXE_RE.test(s.minerExe)) return '채굴기 실행 파일 이름이 올바르지 않습니다';
  if (!s.minerDir) return 'SRBMiner 폴더를 지정해 주세요';
  return null;
}

export function isKryptexPool(pool: string): boolean {
  return /^([a-z0-9-]+\.)*kryptex\.network:\d+$/i.test(pool);
}

/** SRBMiner 인자 조립 (shell 미사용, 배열로 전달). gpuIds 가 비면 모든 GPU (매핑 감지용) */
export function buildMinerArgs(s: Settings, gpuIds: number[]): string[] {
  const preset = COIN_PRESETS[s.coin];
  return [
    '--disable-cpu',
    '--algorithm', preset.algorithm,
    '--pool', s.pool,
    '--tls', String(preset.tls),
    '--wallet', s.wallet,
    ...(gpuIds.length ? ['--gpu-id', gpuIds.join(',')] : []),
    '--api-enable',
    '--api-port', String(s.apiPort),
    '--log-file', path.win32.join(s.minerDir, 'logs', 'srb.log'),
  ];
}

/** 기존 SRBMiner bat 파일에서 --wallet / --pool 값을 읽는다 (환경변수 %X% 는 무시) */
export function parseBatArgs(bat: string): { wallet?: string; pool?: string } {
  const flat = bat.replace(/\^\r?\n/g, ' ');
  const pick = (flag: string) => {
    const v = new RegExp(`--${flag}\\s+("?)([^\\s"]+)\\1`).exec(flat)?.[2];
    return v && !v.includes('%') ? v : undefined;
  };
  return { wallet: pick('wallet'), pool: pick('pool') };
}

/** `tasklist /fo csv /nh` 출력에서 해당 이미지의 PID 목록 */
export function parseTasklistPids(out: string, exe: string): number[] {
  const pids: number[] = [];
  for (const line of out.split(/\r?\n/)) {
    const m = /^"([^"]+)","(\d+)"/.exec(line.trim());
    if (m && m[1].toLowerCase() === exe.toLowerCase()) pids.push(Number(m[2]));
  }
  return pids;
}

// ---- 프로세스 제어 (Windows) ----

function run(cmd: string, args: string[], timeout = 5000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    );
  });
}

export async function minerPids(exe: string): Promise<number[]> {
  return parseTasklistPids(await run('tasklist', ['/fi', `imagename eq ${exe}`, '/fo', 'csv', '/nh']), exe);
}

/** taskkill 결과는 호출부가 minerPids 로 다시 확인한다 (권한 부족 등으로 실패할 수 있음) */
export async function killMiner(exe: string): Promise<string | null> {
  try {
    await run('taskkill', ['/im', exe, '/f']);
    return null;
  } catch (e) {
    return (e as Error).message;
  }
}

/** 채굴기를 앱과 분리된 프로세스로 실행하고 PID 를 돌려준다 */
export function launchMiner(s: Settings, gpuIds: number[]): number | null {
  const child = spawn(path.win32.join(s.minerDir, s.minerExe), buildMinerArgs(s, gpuIds), {
    cwd: s.minerDir,
    detached: true, // 앱을 종료해도 채굴은 계속
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => undefined); // 실행 실패는 다음 폴링의 minerPids 로 감지
  child.unref();
  return child.pid ?? null;
}
