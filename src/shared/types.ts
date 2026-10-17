// main ↔ renderer 공용 타입. 런타임 코드 없음(renderer에서 import type으로만 사용).

/** GPU 식별자 = nvidia-smi PCI bus id (예: "00000000:01:00.0"). index와 달리 재부팅해도 바뀌지 않는다 */
export type GpuId = string;
export type CoinId = 'pearl' | 'quantus';

export interface GpuConfig {
  id: GpuId;
  label: string;
  /** SRBMiner --gpu-id 값. nvidia-smi index와 다를 수 있다. 채굴 중 API의 PCI bus로 자동 학습 */
  srbId: number | null;
  /** 전력 제한 목표값(W). null이면 건드리지 않음 */
  powerLimitW: number | null;
  /** 대여 표시가 수동값($/h). 0이면 Vast 공개 검색 중앙값 */
  rentalUsdManual: number;
  /** 대여 표시가가 이 값 이상이면 재검토 알림 ($/h, 0 = 끔) */
  reviewRentalUsd: number;
}

export interface Settings {
  /** SRBMiner-MULTI 설치 폴더 (첫 실행 때 지정하거나 공식 릴리스를 내려받음) */
  minerDir: string;
  minerExe: string;
  apiPort: number;
  coin: CoinId;
  /** 공개 지갑 주소 + 워커명 (예: prl1....worker). 시드·비밀번호 아님. 기본값 없음 */
  wallet: string;
  pool: string;
  /** 채굴할 GPU */
  selected: GpuId[];
  /** 채굴 위험·비용 고지에 동의한 시각. null이면 채굴을 시작하지 않는다 */
  consentAt: number | null;
  /** 앱 시작 시 채굴기가 꺼져 있으면 자동 시작 (동의 후에만) */
  autoStartMining: boolean;
  /** Windows 로그인 시 앱 자동 실행 */
  openAtLogin: boolean;
  gpus: GpuConfig[];
  safety: SafetyConfig;
  profit: ProfitConfig;
}

export interface SafetyConfig {
  fanStopPowerW: number;
  fanStopSeconds: number;
  tempWarnC: number;
  tempStopC: number;
}

export interface ProfitConfig {
  krwPerKwh: number;
  krwPerUsd: number;
  vastHostShare: number;
  rentalPowerW: number;
  reviewPrlDropPct: number;
  /** PRL 시세 기준값($). 0이면 첫 조회값으로 채움 */
  baselinePrlUsd: number;
}

export interface GpuView {
  id: GpuId;
  label: string;
  index: number | null;
  name: string;
  srbId: number | null;
  tempC: number | null;
  fanPct: number | null;
  powerW: number | null;
  powerLimitW: number | null;
  powerMinW: number | null;
  powerMaxW: number | null;
  utilPct: number | null;
  hashrate: number | null;
  selected: boolean;
  mining: boolean;
  excluded: string | null;
  present: boolean;
}

export interface Alert {
  ts: number;
  level: 'info' | 'warn' | 'critical';
  code: string;
  gpu?: GpuId;
  message: string;
}

/** 'all' = 인식된 GPU 전부, 'partial' = 일부, 'external' = 앱 밖(bat 등)에서 실행됨 */
export type MinerMode = 'all' | 'partial' | 'external';

export interface MinerView {
  running: boolean;
  mode: MinerMode | null;
  gpuIds: number[];
  pool: string | null;
  latencyMs: number | null;
  uptimeS: number | null;
  accepted: number | null;
  rejected: number | null;
  totalHashrate: number | null;
  apiOk: boolean;
}

export interface CompareRow {
  id: GpuId;
  label: string;
  miningKrwPerH: number | null;
  rentalKrwPerH: number | null;
  rentalUsd: number | null;
  rentalSource: 'manual' | 'vast' | null;
}

export interface ProfitView {
  supported: boolean;
  prlUsd: number | null;
  prlChange24hPct: number | null;
  balancePrl: number | null;
  paidPrl: number | null;
  todayPrl: number;
  monthPrl: number;
  todayKwh: number;
  monthKwh: number;
  todayNetKrw: number | null;
  monthNetKrw: number | null;
  compare: CompareRow[];
  updatedAt: number | null;
  error: string | null;
}

export interface SetupView {
  minerFound: boolean;
  walletSet: boolean;
  poolSet: boolean;
  gpusMapped: boolean;
  consented: boolean;
}

export interface UpdateView {
  status: 'disabled' | 'idle' | 'checking' | 'downloading' | 'ready' | 'error';
  version: string | null;
  progressPct: number | null;
  error: string | null;
  checkedAt: number | null;
}

export interface AppState {
  ts: number;
  mock: boolean;
  setup: SetupView;
  miner: MinerView;
  gpus: GpuView[];
  alerts: Alert[];
  profit: ProfitView;
  power: { registered: boolean; lastLog: string | null };
  update: UpdateView;
  appVersion: string;
  settings: Settings;
}

export interface Api {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): void;
  start(selection: GpuId[]): Promise<string | null>;
  stop(): Promise<string | null>;
  clearExclusion(id: GpuId): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<string | null>;
  consent(): Promise<string | null>;
  pickMinerDir(): Promise<string | null>;
  importBat(): Promise<string | null>;
  detectMapping(): Promise<string | null>;
  registerPowerTask(): Promise<string | null>;
  applyPowerLimits(): Promise<string | null>;
  checkUpdate(): Promise<void>;
  installUpdate(): Promise<string | null>;
}
