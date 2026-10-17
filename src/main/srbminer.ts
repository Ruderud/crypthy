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

/** nvidia-smi GPU와 채굴기 장치 매칭: PCI bus 기준 (채굴기가 bus 를 알려 주지 않으면 매칭하지 않음) */
export function matchSrbDevice(devices: SrbDevice[], bus: number | null): SrbDevice | undefined {
  return bus === null ? undefined : devices.find((d) => d.bus === bus);
}
