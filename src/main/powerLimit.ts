// 전력 제한: 앱 본체는 비관리자. 최초 1회 UAC 승인으로 "가장 높은 권한" 예약 작업을 등록하고,
// 이후에는 JSON(숫자만)을 쓰고 schtasks /run 으로 적용한다. 로그온 시 자동 재적용.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import type { GpuConfig } from '../shared/types';

export const POWER_TASK = 'Crypthy-PowerLimit';
export const PROGRAM_DATA_DIR = 'Crypthy';
export const MIN_W = 100;
export const MAX_W = 1000;

/**
 * nvidia-smi -i 는 PCI bus id 도 받으므로 index(바뀔 수 있음) 대신 bus id 로 기록.
 * present 가 있으면 지금 장착된 GPU 만 넣는다 (슬롯을 옮겨 bus id 가 바뀐 옛 항목은 "No devices were found" 로 실패한다)
 */
export function buildLimitsJson(gpus: GpuConfig[], present?: ReadonlySet<string>): { limits: { gpu: string; watts: number }[] } {
  return {
    limits: gpus
      .filter((g) => g.powerLimitW !== null && (!present || present.has(g.id)))
      .map((g) => ({ gpu: g.id, watts: g.powerLimitW as number })),
  };
}

/** followNvidiaLimits 가 보는 nvidia-smi 값 */
export interface LiveLimit {
  busId: string;
  powerLimitW: number | null;
  powerDefaultW: number | null;
  powerMinW?: number | null;
  powerMaxW?: number | null;
}

/**
 * 전력 제한 목표값은 NVIDIA 실제값을 따른다 (nvidia-smi -pl 등 앱 밖에서 바꿔도 설정·로그온 재적용에 반영).
 * - 기본값으로 돌아간 것은 재부팅·드라이버 재시작일 수 있어 따르지 않는다 (목표값을 지우려면 설정에서 비운다)
 * - 앞선 확인 이후 실제값이 그대로면 목표값을 덮지 않는다 (입력했지만 아직 적용하지 않은 값 보존)
 * - 처음 보는 값은 기본값을 알 때만 따른다
 * seen 은 GPU 별 직전 실제값 (앱 실행 중 메모리에만 둔다)
 */
export function followNvidiaLimits(
  gpus: GpuConfig[],
  live: LiveLimit[],
  seen: Readonly<Record<string, number>>,
): { gpus: GpuConfig[]; seen: Record<string, number>; changed: boolean } {
  const next = { ...seen };
  let changed = false;
  const out = gpus.map((g) => {
    const nv = live.find((n) => n.busId === g.id);
    if (!nv || nv.powerLimitW === null) return g;
    const w = Math.round(nv.powerLimitW);
    const prev = seen[g.id];
    next[g.id] = w;
    const atDefault = nv.powerDefaultW !== null && w === Math.round(nv.powerDefaultW);
    const userChange = prev === undefined ? nv.powerDefaultW !== null && !atDefault : w !== prev && !atDefault;
    // 설정에서 저장할 수 없는 값(예: 100W 미만 저전력 카드)은 들이지 않는다: 들이면 이후 설정 저장이 모두 거부된다
    const valid = validateWatts(w, nv.powerMinW ?? null, nv.powerMaxW ?? null) === null;
    if (!userChange || !valid || g.powerLimitW === w) return g;
    changed = true;
    return { ...g, powerLimitW: w };
  });
  return { gpus: out, seen: next, changed };
}

/** min/max 는 nvidia-smi 가 알려 준 GPU 허용 범위 (모르면 100~1000W) */
export function validateWatts(w: unknown, min: number | null = null, max: number | null = null): string | null {
  if (w === null) return null;
  const lo = Math.max(MIN_W, min ?? MIN_W);
  const hi = Math.min(MAX_W, max ?? MAX_W);
  return Number.isInteger(w) && (w as number) >= lo && (w as number) <= hi ? null : `전력 제한은 ${lo}~${hi}W 정수여야 합니다`;
}

const psQuote = (s: string) => `'${s.replace(/'/g, "''")}'`;
const encode = (script: string) => Buffer.from(script, 'utf16le').toString('base64');

/** UAC 승인 프롬프트를 띄우는 비관리자 측 PowerShell 명령 (EncodedCommand 로 따옴표 문제 회피) */
export function buildRegisterCommand(registerScript: string, configPath: string, user: string): string[] {
  for (const p of [registerScript, configPath, user]) {
    // PowerShell 은 ‘ ’ ‚ ‛ 도 작은따옴표로 해석하므로 함께 거부
    if (/["\r\n\u2018-\u201B]/.test(p)) throw new Error(`허용되지 않는 문자가 포함된 경로: ${p}`);
  }
  const inner = `& ${psQuote(registerScript)} -ConfigPath ${psQuote(configPath)} -User ${psQuote(user)}`;
  const outer = [
    '$ErrorActionPreference = "Stop"',
    `$p = Start-Process -FilePath powershell.exe -Verb RunAs -Wait -PassThru -WindowStyle Hidden -ArgumentList '-NoProfile','-ExecutionPolicy','Bypass','-EncodedCommand','${encode(inner)}'`,
    'exit $p.ExitCode',
  ].join('; ');
  return ['-NoProfile', '-NonInteractive', '-EncodedCommand', encode(outer)];
}

function run(cmd: string, args: string[], timeout = 120_000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { timeout, windowsHide: true }, (err, stdout, stderr) =>
      err ? reject(new Error((stderr || err.message).trim())) : resolve(stdout),
    );
  });
}

export async function isPowerTaskRegistered(): Promise<boolean> {
  try {
    await run('schtasks', ['/query', '/tn', POWER_TASK], 5000);
    return true;
  } catch {
    return false;
  }
}

export async function registerPowerTask(resourcesDir: string, configPath: string, user: string): Promise<void> {
  const script = path.join(resourcesDir, 'ps', 'register-power-task.ps1');
  await run('powershell.exe', buildRegisterCommand(script, configPath, user));
}

export async function runPowerTask(): Promise<void> {
  await run('schtasks', ['/run', '/tn', POWER_TASK], 10_000);
}

export function readPowerLog(): string | null {
  try {
    const file = path.join(process.env.ProgramData ?? 'C:\\ProgramData', PROGRAM_DATA_DIR, 'power-limit.log');
    return fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, '').slice(0, 2000);
  } catch {
    return null;
  }
}
