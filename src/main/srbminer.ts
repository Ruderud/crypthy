// SRBMiner-MULTI API(`--api-enable --api-port N`) 응답 파싱.
// 필드명은 3.7.x 응답(gpu_devices.fan_speed_percent/temperature/asic_power, algorithms.hashrate/shares/pool)
// 기준이며, 버전 차이에 대비해 없는 필드는 null로 둔다.

export interface SrbDevice {
  id: number;
  bus: number | null;
  model: string;
  tempC: number | null;
  fanPct: number | null;
  powerW: number | null;
  hashrate: number | null;
}

export interface SrbStatus {
  uptimeS: number | null;
  algorithm: string | null;
  pool: string | null;
  latencyMs: number | null;
  accepted: number | null;
  rejected: number | null;
  totalHashrate: number | null;
  devices: SrbDevice[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === 'string' ? v : null);

export function parseSrbStatus(json: unknown): SrbStatus {
  const root = isObj(json) ? json : {};
  const algos = Array.isArray(root.algorithms) ? root.algorithms.filter(isObj) : [];
  const algo = algos[0] ?? {};
  const pool = isObj(algo.pool) ? algo.pool : {};
  const shares = isObj(algo.shares) ? algo.shares : {};
  const hr = isObj(algo.hashrate) ? algo.hashrate : {};
  const gpuHr = isObj(hr.gpu) ? hr.gpu : {};

  const devices: SrbDevice[] = (Array.isArray(root.gpu_devices) ? root.gpu_devices : [])
    .filter(isObj)
    .map((d) => {
      const id = num(d.id) ?? -1;
      return {
        id,
        bus: num(d.bus_id),
        model: str(d.model) ?? str(d.device) ?? `GPU${id}`,
        tempC: num(d.temperature),
        fanPct: num(d.fan_speed_percent),
        powerW: num(d.asic_power),
        hashrate: num(gpuHr[`gpu${id}`]) ?? num(gpuHr[String(id)]),
      };
    });

  return {
    uptimeS: num(root.mining_time) ?? num(pool.uptime),
    algorithm: str(algo.name),
    pool: str(pool.pool),
    latencyMs: num(pool.latency),
    accepted: num(shares.accepted),
    rejected: num(shares.rejected),
    totalHashrate: num(gpuHr.total) ?? num(hr.now),
    devices,
  };
}

export async function fetchSrbStatus(port: number): Promise<SrbStatus> {
  const res = await fetch(`http://127.0.0.1:${port}`, { signal: AbortSignal.timeout(1500) });
  if (!res.ok) throw new Error(`SRBMiner API HTTP ${res.status}`);
  return parseSrbStatus(await res.json());
}

/** nvidia-smi GPU와 SRBMiner 장치 매칭: PCI bus 우선, 장치에 bus 정보가 없을 때만 설정의 srbId */
export function matchSrbDevice(devices: SrbDevice[], bus: number | null, srbId: number | null): SrbDevice | undefined {
  if (bus !== null && devices.some((d) => d.bus !== null)) return devices.find((d) => d.bus === bus);
  return srbId === null ? undefined : devices.find((d) => d.id === srbId);
}

/**
 * 채굴 중인 SRBMiner 장치의 PCI bus로 GPU별 SRBMiner id 를 학습한다.
 * 반환: 바뀐 항목 목록 (설정 반영·알림은 호출부에서)
 */
export function learnSrbIds(
  gpus: { id: string; srbId: number | null }[],
  busOf: (gpuId: string) => number | null,
  devices: SrbDevice[],
): { id: string; from: number | null; to: number }[] {
  const changes: { id: string; from: number | null; to: number }[] = [];
  for (const g of gpus) {
    const bus = busOf(g.id);
    const dev = bus === null ? undefined : devices.find((d) => d.bus === bus);
    if (dev && dev.id >= 0 && dev.id !== g.srbId) changes.push({ id: g.id, from: g.srbId, to: dev.id });
  }
  return changes;
}
