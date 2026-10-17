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

/** nvidia-smi -i 는 PCI bus id 도 받으므로 index(바뀔 수 있음) 대신 bus id 로 기록 */
export function buildLimitsJson(gpus: GpuConfig[]): { limits: { gpu: string; watts: number }[] } {
  return {
    limits: gpus.filter((g) => g.powerLimitW !== null).map((g) => ({ gpu: g.id, watts: g.powerLimitW as number })),
  };
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
