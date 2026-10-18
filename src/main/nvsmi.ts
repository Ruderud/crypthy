import { execFile } from 'node:child_process';

export const NVSMI_FIELDS = [
  'index',
  'name',
  'pci.bus_id',
  'temperature.gpu',
  'fan.speed',
  'power.draw',
  'power.limit',
  'power.min_limit',
  'power.max_limit',
  'utilization.gpu',
  'uuid',
] as const;

export interface NvGpu {
  index: number;
  name: string;
  /** PCI bus id 원문 (예: 00000000:01:00.0) → GPU 식별자로 사용 */
  busId: string;
  /** PCI bus 번호 (00000000:10:00.0 → 16), SRBMiner bus_id 와 매칭용 */
  bus: number | null;
  tempC: number | null;
  fanPct: number | null;
  powerW: number | null;
  powerLimitW: number | null;
  powerMinW: number | null;
  powerMaxW: number | null;
  utilPct: number | null;
  /** GPU UUID (예: GPU-1a2b…). CUDA_VISIBLE_DEVICES 로 채굴할 GPU 를 고를 때 */
  uuid: string | null;
}

function num(v: string | undefined): number | null {
  if (v === undefined) return null;
  const n = Number.parseFloat(v.trim());
  return Number.isFinite(n) ? n : null; // "[N/A]", "[Not Supported]" → null
}

export const BUS_ID_RE = /^[0-9a-f]{4,8}:[0-9a-f]{2}:[0-9a-f]{2}\.[0-9a-f]$/i;

export function parsePciBus(busId: string): number | null {
  // domain:bus:device.function (16진수)
  const m = /^(?:[0-9a-f]+:)?([0-9a-f]{2}):[0-9a-f]{2}\.[0-9a-f]$/i.exec(busId.trim());
  return m ? Number.parseInt(m[1], 16) : null;
}

/** `--format=csv,noheader,nounits` 출력 파싱 */
export function parseNvsmiCsv(out: string): NvGpu[] {
  const gpus: NvGpu[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const c = line.split(',').map((s) => s.trim());
    // uuid 는 0.4.4 에 추가: 열이 하나 모자란 출력(테스트·구버전 형식)도 받는다
    if (c.length < NVSMI_FIELDS.length - 1) continue;
    const index = Number.parseInt(c[0], 10);
    if (!Number.isInteger(index) || !BUS_ID_RE.test(c[2])) continue;
    gpus.push({
      index,
      name: c[1],
      busId: c[2].toUpperCase(),
      bus: parsePciBus(c[2]),
      tempC: num(c[3]),
      fanPct: num(c[4]),
      powerW: num(c[5]),
      powerLimitW: num(c[6]),
      powerMinW: num(c[7]),
      powerMaxW: num(c[8]),
      utilPct: num(c[9]),
      uuid: /^GPU-[0-9a-f-]+$/i.test(c[10] ?? '') ? c[10] : null,
    });
  }
  return gpus;
}

export function queryNvsmi(exe = 'nvidia-smi'): Promise<NvGpu[]> {
  return new Promise((resolve, reject) => {
    execFile(
      exe,
      [`--query-gpu=${NVSMI_FIELDS.join(',')}`, '--format=csv,noheader,nounits'],
      { timeout: 1800, windowsHide: true },
      (err, stdout) => (err ? reject(err) : resolve(parseNvsmiCsv(stdout))),
    );
  });
}
