import fs from 'node:fs';
import path from 'node:path';
import type { GpuConfig, GpuId, Settings } from '../shared/types';

// 개인 값(지갑·풀·채굴기 경로·GPU 매핑)은 기본값이 없다. 첫 실행 화면에서 사용자가 입력한다.
export const DEFAULT_SETTINGS: Settings = {
  minerDir: '',
  minerExe: 'SRBMiner-MULTI.exe',
  apiPort: 21550,
  coin: 'pearl',
  wallet: '',
  pool: '',
  selected: [],
  consentAt: null,
  autoStartMining: false,
  openAtLogin: false,
  gpus: [],
  safety: { fanStopPowerW: 100, fanStopSeconds: 10, tempWarnC: 80, tempStopC: 85 },
  profit: {
    krwPerKwh: 350,
    krwPerUsd: 1340,
    vastHostShare: 0.75,
    rentalPowerW: 250,
    reviewPrlDropPct: 30,
    baselinePrlUsd: 0,
  },
};

/** 저장된 값 위에 기본값을 채워 넣는다 (safety·profit 은 1단계 병합, gpus 는 id 기준 병합) */
export function mergeSettings(base: Settings, patch: Partial<Settings>): Settings {
  const gpus = base.gpus.map((g) => ({ ...g, ...patch.gpus?.find((p) => p.id === g.id) }));
  for (const p of patch.gpus ?? []) if (!gpus.some((g) => g.id === p.id)) gpus.push({ ...newGpu(p.id, p.label), ...p });
  return {
    ...base,
    ...patch,
    safety: { ...base.safety, ...patch.safety },
    profit: { ...base.profit, ...patch.profit },
    gpus,
  };
}

export function newGpu(id: GpuId, label: string): GpuConfig {
  return { id, label, srbId: null, powerLimitW: null, rentalUsdManual: 0, reviewRentalUsd: 0 };
}

/** nvidia-smi 이름을 짧은 표시명으로 ("NVIDIA GeForce RTX 5090" → "RTX 5090") */
export const shortName = (name: string) => name.replace(/^NVIDIA\s+/i, '').replace(/^GeForce\s+/i, '').trim() || name;

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
