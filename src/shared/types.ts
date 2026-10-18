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
  /** 로그인 시 앱 자동 실행 */
  openAtLogin: boolean;
  /** 업데이트 확인 주기(분). 30~1440, 기본 60 */
  updateIntervalMin: number;
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
  /** Vast 시세: 인증(verified) 매물만 */
  vastVerifiedOnly: boolean;
  vastType: 'on-demand' | 'interruptible';
  /** Vast 시세 지역 필터: 국가 코드 쉼표 목록(예: "KR,JP"). 비우면 전체 */
  vastRegions: string;
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
  /** 비교·재검토 기준 대여가: 수동값 또는 Vast 필터 후 중앙값 */
  rentalUsd: number | null;
  rentalSource: 'manual' | 'vast' | null;
  /** Vast 조회 결과 (수동값이어도 참고로 표시) */
  vast: { status: 'ok' | 'insufficient'; median: number | null; p25: number | null; n: number; total: number; at: number } | null;
}

/** 기간(오늘·이번 달) 요약. confirmed = 풀 확정, est = 해시레이트 추정 */
export interface PeriodView {
  /** 풀 확정 채굴량 (업데이트 이전 장부 몫 포함) */
  confirmedCoin: number;
  /** 전력 구간을 짝지은 확정 채굴량·전력량·시간 */
  matchedCoin: number;
  matchedKwh: number;
  matchedHours: number;
  /** 짝지은 구간의 순수익. 구간이 짧거나(집계 중) 시세가 없으면 null */
  confirmedNetKrw: number | null;
  estCoin: number;
  kwh: number;
  estNetKrw: number | null;
  status: 'ok' | 'collecting' | 'noPrice';
}

export interface ProfitView {
  supported: boolean;
  symbol: string;
  /** 시세. 조회 실패 시 마지막 정상 시세(at 시각, stale=true). 한 번도 못 받았으면 null */
  price: { usd: number; at: number; stale: boolean } | null;
  change24hPct: number | null;
  balanceCoin: number | null;
  /** 최근 지급 내역 페이지 합 */
  paidCoin: number | null;
  /** 풀 누적 채굴량 (미지급 잔액 + 지금까지 본 지급). 앱을 켜기 전 채굴분도 포함 */
  lifetimeCoin: number | null;
  /** 실시간 추정: 실측 해시레이트 × 풀 통계 기대 채굴량 × 시세 − 실측 GPU 전력비 */
  liveCoinPerH: number | null;
  liveKrwPerH: number | null;
  today: PeriodView;
  month: PeriodView;
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
  /** available = 새 버전 발견(아직 안 받음), ready = 받아 둠(재시작하면 설치) */
  status: 'disabled' | 'idle' | 'checking' | 'available' | 'downloading' | 'ready' | 'error';
  version: string | null;
  /** 릴리스 노트 요약(텍스트, 길이 제한) */
  notes: string | null;
  progressPct: number | null;
  error: string | null;
  checkedAt: number | null;
  /** 지금 사용자에게 띄울 안내. "나중에" 를 누르면 다음 확인 주기까지 null */
  prompt: 'available' | 'ready' | null;
  intervalMin: number;
}

/** 1분 평균 (null = 그 분에 값 없음) */
export interface ChartPoint {
  t: number;
  hash: number | null;
  temp: number | null;
  power: number | null;
}

export interface DailyPoint {
  day: string;
  coin: number;
  kwh: number;
  netKrw: number | null;
}

export interface PnlPeriodView {
  mined: number;
  revenueKrw: number;
  energyCostKrw: number;
  netKrw: number;
  estimated: boolean;
}

/** 누적 손익. 매출은 채굴 시점 시세, 미실현은 현재가 기준 */
export interface PnlView {
  symbol: string;
  today: PnlPeriodView;
  d7: PnlPeriodView;
  d30: PnlPeriodView;
  all: PnlPeriodView;
  holdings: number;
  soldQty: number;
  realizedKrw: number;
  unrealizedKrw: number | null;
  totalPnlKrw: number | null;
  estimated: boolean;
  /** 추적 시작(이전 채굴분은 소급 대상) */
  trackStart: { at: number; total: number } | null;
  bootstrapped: boolean;
  /** 소급 전력 추정 기본값(현재 GPU 전력 합) */
  currentWatts: number;
  logDir: string;
}

export interface SaleInput {
  qty: number;
  proceedsKrw: number;
  feeKrw: number;
  venue: string;
  note: string;
}

export interface ChartsView {
  gpus: { id: GpuId; label: string; points: ChartPoint[] }[];
  price: { t: number; usd: number }[];
  daily: DailyPoint[];
  pnl: { day: string; netKrw: number; cumulativeKrw: number; estimated: boolean }[];
  symbol: string;
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
  platform: 'windows' | 'linux' | 'other';
  settings: Settings;
  /** 카탈로그 코인 목록과 선택 코인의 공개 풀 예시 */
  coins: { id: string; name: string; symbol: string; algorithm: string }[];
  poolExamples: string[];
  hub: HubView;
  pnl: PnlView;
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
  downloadUpdate(): Promise<void>;
  dismissUpdate(): Promise<void>;
  installUpdate(): Promise<string | null>;
  openLink(url: string): Promise<void>;
  getCharts(): Promise<ChartsView>;
  addSale(sale: SaleInput): Promise<string | null>;
  bootstrapPnl(fromMs: number, watts: number): Promise<string | null>;
  exportPnl(): Promise<string | null>;
  openPnlFolder(): Promise<void>;
}
