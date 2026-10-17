// main ↔ renderer 공용 타입. 런타임 코드 없음(renderer에서 import type으로만 사용).

/** GPU 식별자 = nvidia-smi PCI bus id (예: "00000000:01:00.0"). index와 달리 재부팅해도 바뀌지 않는다 */
export type GpuId = string;

export interface GpuConfig {
  id: GpuId;
  label: string;
  /** 전력 제한 목표값(W). null이면 건드리지 않음 */
  powerLimitW: number | null;
  /** 대여 표시가 수동값($/h). 0이면 Vast 공개 검색 중앙값 */
  rentalUsdManual: number;
  /** 대여 표시가가 이 값 이상이면 재검토 알림 ($/h, 0 = 끔) */
  reviewRentalUsd: number;
}

export interface Settings {
  /** 카탈로그 코인 id */
  coin: string;
  /** 공개 지갑 주소 + 워커명 (풀 공개 통계 조회용). 시드·비밀번호 아님. 기본값 없음 */
  wallet: string;
  /** 사용 중인 풀 host:port (풀 통계 API 선택용) */
  pool: string;
  /** 실행 중인 채굴기의 로컬 통계 API */
  minerApi: { adapter: string; port: number };
  /** 위험 조건에서 실행 중인 알려진 채굴기 프로세스를 정지(재시작은 안 함) */
  safetyKill: boolean;
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
  /** 코인 시세 기준값($). 0이면 첫 조회값으로 채움 */
  baselinePrlUsd: number;
}

export interface GpuView {
  id: GpuId;
  label: string;
  index: number | null;
  name: string;
  tempC: number | null;
  fanPct: number | null;
  powerW: number | null;
  powerLimitW: number | null;
  powerMinW: number | null;
  powerMaxW: number | null;
  utilPct: number | null;
  hashrate: number | null;
  mining: boolean;
  /** 안전 보류 사유. 보류 중에는 채굴기가 다시 돌면 다시 정지한다(설정에서 끌 수 있음) */
  hold: string | null;
  present: boolean;
}

export interface Alert {
  ts: number;
  level: 'info' | 'warn' | 'critical';
  code: string;
  gpu?: GpuId;
  message: string;
}

/** Crypthy 는 채굴기를 실행하지 않으므로 실행 중인 채굴기는 항상 'external' */
export type MinerMode = 'external';

export interface MinerView {
  running: boolean;
  mode: MinerMode | null;
  /** 실행 중인 알려진 채굴기 실행 파일 이름 */
  processes: string[];
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
  symbol: string;
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
  walletSet: boolean;
  poolSet: boolean;
  apiConnected: boolean;
}

export type Vendor = 'nvidia' | 'amd' | 'intel';
export type FeeStatus = 'verified' | 'conflict' | 'unverified';

export interface RecommendationView {
  rank: number;
  tool: string;
  name: string;
  /** 저장소 링크. 공식 저장소·배포처를 확인하지 못한 툴은 null */
  repo: string | null;
  repoKind: 'developer' | 'distribution' | 'unverified';
  repoNote: string | null;
  vendors: Vendor[];
  compatible: boolean;
  devFee: { pct: number | null; status: FeeStatus; source: string | null; note?: string };
  note: string;
  apiNote: string;
}

export interface HubView {
  coin: string;
  algorithm: string;
  /** 이 PC 에서 감지한 GPU 벤더 */
  vendors: Vendor[];
  recommendations: RecommendationView[];
  poolSources: string[];
  checkedAt: string;
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
  /** 카탈로그 코인 목록과 선택 코인의 공개 풀 예시 */
  coins: { id: string; name: string; symbol: string; algorithm: string }[];
  poolExamples: string[];
  hub: HubView;
}

export interface Api {
  getState(): Promise<AppState>;
  onState(cb: (s: AppState) => void): void;
  clearHold(id: GpuId): Promise<void>;
  saveSettings(patch: Partial<Settings>): Promise<string | null>;
  importBat(): Promise<string | null>;
  registerPowerTask(): Promise<string | null>;
  applyPowerLimits(): Promise<string | null>;
  checkUpdate(): Promise<void>;
  installUpdate(): Promise<string | null>;
  openLink(url: string): Promise<void>;
}
