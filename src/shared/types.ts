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
  /** 이 GPU 로 채굴 (실행 파일 방식에서 GPU 별로 고를 때). 기본 true */
  mine: boolean;
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
  /** 채굴 켜기·끄기 (사용자가 구성한 채굴기만 실행·정지) */
  minerControl: MinerControlConfig;
  /** 공유 장부 폴더 (듀얼부팅 등 여러 OS 가 같은 PnL 을 쓸 때). 비우면 이 PC 장부만. 기기별 설정 */
  sharedLedgerDir: string;
  /** SafeTrade 자동 매도 (기기별: 한 기기에서만 켠다) */
  autoSell: AutoSellConfig;
  cashout: CashoutConfig;
  /** 로그인 시 앱 자동 실행 */
  openAtLogin: boolean;
  /** 로그인 시 창을 띄운다 (false 면 트레이에만) */
  loginShowWindow: boolean;
  /** Crypthy 가 시작될 때 채굴 자동 시작 (동의·안전 보류·최근 위험 정지·이미 실행 중이면 하지 않음). 기기별 */
  autoStartMining: boolean;
  /** 업데이트 확인 주기(분). 30~1440, 기본 60 */
  updateIntervalMin: number;
  gpus: GpuConfig[];
  safety: SafetyConfig;
  profit: ProfitConfig;
}

export interface MinerControlConfig {
  /** none: 켜기·끄기 안 씀, task: Windows 예약 작업, systemd: Linux systemd --user 유닛, direct: 실행 파일 직접 실행 */
  mode: 'none' | 'task' | 'systemd' | 'direct';
  taskName: string;
  unit: string;
  /** direct 의 실행 파일(절대 경로). 다른 방식에서는 감지·정지할 프로세스 이름으로만 쓴다 */
  exe: string;
  /** direct 의 인자 (셸 없이 나눔) */
  args: string;
  /** 끄기 전에 한 번 확인 */
  confirmStop: boolean;
  /** 직접 실행할 때 콘솔 창 숨기기 (Windows) */
  hideWindow: boolean;
}

export interface AutoSellConfig {
  enabled: boolean;
  /** 주문하지 않고 계획만 (처음엔 켜 둔다) */
  dryRun: boolean;
  /** 매일 실행 시각 HH:MM (로컬) */
  time: string;
  market: string;
  /** 남겨 둘 PRL */
  reservePrl: number;
  /** 사용자 최저가 (USDT). 0 이면 기준가 하락률만 */
  floorUsd: number;
  /** 기준가 대비 최대 하락률 % (이보다 싸면 팔지 않음) */
  maxDropPct: number;
  /** 최우선 매도·매수호가 차이 % 상한 */
  maxSpreadPct: number;
  /** 최우선 매수호가에서 5% 안의 매수 호가 합 (USDT) 하한 */
  minBidDepthUsd: number;
  /** 하루 최대 매도량 (PRL) */
  dailyMaxPrl: number;
  /** 주문 1건 최대 금액 (USDT) */
  orderMaxUsd: number;
  /** 다시 가격을 매기기까지 기다리는 분 */
  repriceMinutes: number;
  /** 한 번에 내리는 비율 % */
  repriceStepPct: number;
  /** 최대 재가격 횟수 */
  maxReprices: number;
}

/** 현금화 경로 메모의 수수료·조건 (실측 날짜와 함께, 바꿀 수 있음) */
export interface CashoutConfig {
  /** SafeTrade PRL 입금 최소 수량 */
  prlDepositMin: number;
  /** PRL 입금 컨펌 수 */
  prlConfirmations: number;
  /** SafeTrade → 바이낸스 USDT 출금 네트워크 */
  withdrawNetwork: string;
  withdrawFeeUsdt: number;
  withdrawMinUsdt: number;
  /** 이 이상 쌓이면 주 1회(일요일) 출금 권장 알림 */
  withdrawSuggestUsdt: number;
  /** 위 값을 확인한 날짜 */
  measuredAt: string;
}

export interface SellOrderRecord {
  id: number;
  price: number;
  amount: number;
  filled: number;
  avgPrice: number;
}

export interface SellResult {
  day: string;
  at: number;
  dryRun: boolean;
  status: 'sold' | 'partial' | 'nothing' | 'skipped' | 'error' | 'planned';
  reason: string | null;
  floorUsd: number | null;
  refUsd: number | null;
  /** dry-run 계획 또는 첫 주문 */
  plan: { price: number; amount: number } | null;
  orders: SellOrderRecord[];
  soldPrl: number;
  proceedsUsdt: number;
  feeUsdt: number;
}

export interface AutoSellView {
  /** API 키가 저장돼 있는지 (키 자체는 화면·원격·로그에 내보내지 않는다) */
  keySet: boolean;
  /** 키 보관 방식 */
  keyStore: string | null;
  running: boolean;
  nextRunAt: number | null;
  todaySoldPrl: number;
  last: SellResult | null;
  history: SellResult[];
  /** 마지막으로 읽은 SafeTrade 잔고 */
  balance: { prl: number; usdt: number; at: number } | null;
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
  /** 채굴할 GPU 로 골랐는지 (설정의 mine) */
  mine: boolean;
  /** GPU 별 채굴 선택이 실제로 적용되는지 (실행 파일 방식 + NVIDIA) */
  selectable: boolean;
}

export interface Alert {
  ts: number;
  level: 'info' | 'warn' | 'critical';
  code: string;
  gpu?: GpuId;
  message: string;
}

/** external: 앱 밖에서 실행됨, app: 이 앱의 켜기로 실행됨 */
export type MinerMode = 'external' | 'app';

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
  /** GPU 별 채굴 선택을 마지막으로 켤 때 실제로 적용했는지 (null: 선택 없음 = 모든 카드) */
  gpuSelection: { applied: boolean; via: string | null; reason: string | null } | null;
  control: {
    mode: MinerControlConfig['mode'];
    canStart: boolean;
    canStop: boolean;
    /** 켜기를 막는 이유 (버튼 툴팁·안내) */
    blocker: string | null;
    starting: boolean;
    consented: boolean;
  };
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
  /** 확정 + 소급 + 실시간 추정 */
  mined: number;
  confirmed: number;
  backfill: number;
  pending: number;
  revenueKrw: number;
  unpriced: number;
  energyCostKrw: number;
  netKrw: number;
  estimated: boolean;
}

/** 누적 손익. 매출은 채굴 시점 시세, 미실현은 현재가 기준 */
export interface PnlView {
  symbol: string;
  today: PnlPeriodView;
  month: PnlPeriodView;
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
  /** 적용된 소급(시작 시각·전력은 고쳐서 다시 계산 가능). 0.3.4 에서 적용해 떼어 내지 못했으면 null */
  backfill: { from: number; to: number; qty: number; watts: number; auto: boolean } | null;
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

export interface SharedLedgerView {
  dir: string;
  /** 폴더가 보이고 읽기·쓰기가 되는지 */
  ok: boolean;
  error: string | null;
  instanceId: string;
  /** 공유 폴더에 이벤트 파일이 있는 인스턴스 id 들 */
  instances: string[];
  /** 마지막 동기화 시각 */
  at: number | null;
  /** 서로 다른 인스턴스의 전력 기록이 시간상 겹친 구간 수 (0 이 정상) */
  overlaps: number;
}

/** 원격 호스트(헤드리스 Crypthy)에 붙어 있을 때 */
export interface RemoteView {
  url: string;
  /** 쓰기 토큰이 있어 원격으로 조작할 수 있는지 */
  write: boolean;
  /** 마지막으로 상태를 받은 시각 (못 받았으면 null) */
  at: number | null;
  error: string | null;
  /** 원격 호스트의 Crypthy 버전 */
  version: string | null;
}

export interface RemoteSettingsView {
  url: string;
  enabled: boolean;
  hasRead: boolean;
  hasWrite: boolean;
  /** 토큰을 OS 보안 저장소(safeStorage)로 암호화해 저장하는지 */
  encrypted: boolean;
}

export interface AppState {
  ts: number;
  mock: boolean;
  /** 원격 호스트 화면을 보고 있으면 그 정보, 이 PC 화면이면 null */
  remote?: RemoteView | null;
  /** 공유 장부 상태 (켜져 있을 때) */
  sharedLedger: SharedLedgerView | null;
  autoSell: AutoSellView;
  /** 설정한 Windows 예약 작업의 상태 (status 는 schtasks 표기 그대로, 예: Ready·Running·Disabled / 준비·실행 중·사용 안 함) */
  minerTask: { name: string; status: string | null; at: number } | null;
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
  /** OS 알림·트레이에서 업데이트 안내로 왔을 때 (배너로 스크롤·강조) */
  onFocusUpdate(cb: () => void): void;
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
  getRemote(): Promise<RemoteSettingsView>;
  connectRemote(url: string, readToken: string, writeToken: string): Promise<string | null>;
  disconnectRemote(): Promise<void>;
  startMining(): Promise<string | null>;
  stopMining(): Promise<string | null>;
  importMinerTask(): Promise<string | null>;
  disableMinerTask(): Promise<string | null>;
  /** SafeTrade API 키 저장 (이 PC 에서만, 원격 불가). 빈 값이면 지운다 */
  setExchangeKey(key: string, secret: string): Promise<string | null>;
  /** 자동 매도 지금 한 번 (dryRun 이 아니면 확인 대화상자) */
  runAutoSell(dryRun: boolean): Promise<string | null>;
  /** GPU 별 채굴 켜기·끄기 (채굴 중이면 선택을 바꿔 다시 시작) */
  setGpuMining(id: GpuId, mine: boolean): Promise<string | null>;
  minerLog(): Promise<{ text: string; path: string; at: number | null; available: boolean }>;
  /** 찾아보기: kind 'exe' 는 실행 파일, 'folder' 는 폴더. 취소하면 null */
  pickPath(kind: 'exe' | 'folder', current: string): Promise<string | null>;
}
