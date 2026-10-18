import fs from 'node:fs';
import path from 'node:path';
import type { GpuConfig, GpuId, Settings } from '../shared/types';

// 개인 값(지갑·풀)은 기본값이 없다. 처음 설정 화면에서 사용자가 입력한다.
export const DEFAULT_SETTINGS: Settings = {
  coin: 'pearl',
  wallet: '',
  pool: '',
  minerApi: { adapter: 'srbminer', port: 21550 },
  safetyKill: true,
  minerControl: { mode: 'none', taskName: '', unit: '', exe: '', args: '', confirmStop: true, hideWindow: true },
  sharedLedgerDir: '',
  openAtLogin: false,
  loginShowWindow: false,
  autoStartMining: false,
  updateIntervalMin: 60,
  gpus: [],
  safety: { fanStopPowerW: 100, fanStopSeconds: 10, tempWarnC: 80, tempStopC: 85 },
  profit: {
    krwPerKwh: 350,
    krwPerUsd: 1340,
    vastHostShare: 0.75,
    rentalPowerW: 250,
    reviewPrlDropPct: 30,
    vastVerifiedOnly: true,
    vastType: 'on-demand',
    vastRegions: '',
    baselinePrlUsd: 0,
  },
};

const pick = <T extends object>(base: T, patch: unknown): Partial<T> => {
  const out: Partial<T> = {};
  if (patch && typeof patch === 'object') {
    for (const k of Object.keys(base) as (keyof T)[]) if (k in patch) out[k] = (patch as T)[k];
  }
  return out;
};

/**
 * 저장된 값 위에 기본값을 채워 넣는다. 알려진 키만 받으므로 이전 버전(0.1.x)의 채굴기 실행 설정
 * (minerDir, selected, consentAt, srbId 등)은 자연스럽게 버려진다.
 */
export function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  patch = patch && typeof patch === 'object' ? patch : {};
  const known = pick(base, patch);
  delete known.gpus;
  const sample = newGpu('', '');
  // 깨진 항목(id·label 이 문자열이 아님)은 버린다
  const patchGpus = (Array.isArray(patch.gpus) ? patch.gpus : []).filter((p) => p && typeof p.id === 'string' && typeof p.label === 'string');
  const gpus = base.gpus.map((g) => ({ ...g, ...pick(sample, patchGpus.find((p) => p.id === g.id)) }));
  for (const p of patchGpus) if (!gpus.some((g) => g.id === p.id)) gpus.push({ ...newGpu(p.id, p.label), ...pick(sample, p), id: p.id });
  return {
    ...base,
    ...known,
    minerApi: { ...base.minerApi, ...pick(base.minerApi, patch.minerApi) },
    minerControl: { ...base.minerControl, ...pick(base.minerControl, patch.minerControl) },
    safety: { ...base.safety, ...pick(base.safety, patch.safety) },
    profit: { ...base.profit, ...pick(base.profit, patch.profit) },
    gpus,
  };
}

export function newGpu(id: GpuId, label: string): GpuConfig {
  return { id, label, powerLimitW: null, rentalUsdManual: 0, reviewRentalUsd: 0, mine: true };
}

/** nvidia-smi 이름을 짧은 표시명으로 ("NVIDIA GeForce RTX 5090" → "RTX 5090") */
export const shortName = (name: string) => name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '').trim() || name;

const WALLET_RE = /^[a-z0-9]{10,120}(\.[A-Za-z0-9_-]{1,32})?$/;
const POOL_RE = /^[A-Za-z0-9.-]+:\d{2,5}$/;

/** 지갑·풀은 비워 둘 수 있지만, 입력하면 형식을 확인한다 */
export function validateAccount(s: Pick<Settings, 'wallet' | 'pool'>): string | null {
  if (s.wallet && !WALLET_RE.test(s.wallet)) return '지갑 주소 형식이 올바르지 않습니다 (공개 주소[.워커])';
  if (s.pool && !POOL_RE.test(s.pool)) return '풀 주소는 host:port 형식이어야 합니다';
  return null;
}

export function isKryptexPool(pool: string): boolean {
  return /^([a-z0-9-]+\.)*kryptex\.network:\d+$/i.test(pool);
}

/** 기존 채굴기 bat 파일에서 --wallet / --pool 값을 읽는다 (환경변수 %X% 는 무시) */
export function parseBatArgs(bat: string): { wallet?: string; pool?: string } {
  const flat = bat.replace(/\^\r?\n/g, ' ');
  const read = (flag: string) => {
    const v = new RegExp(`--${flag}\\s+("?)([^\\s"]+)\\1`).exec(flat)?.[2];
    return v && !v.includes('%') ? v.replace(/^stratum\+(tcp|ssl):\/\//, '') : undefined;
  };
  return { wallet: read('wallet'), pool: read('pool') };
}

export function readJson<T>(file: string, fallback: T): T {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T;
  } catch {
    return fallback;
  }
}

/** 임시 파일에 쓰고 rename (쓰기 중 종료돼도 원본 보존) */
export function writeJson(file: string, data: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2));
  fs.renameSync(tmp, file);
}
