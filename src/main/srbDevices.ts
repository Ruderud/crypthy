// SRBMiner 장치 번호(--gpu-id) ↔ 실제 카드(PCI bus) 매핑.
//
// SRBMiner 의 GPU 번호는 nvidia-smi 번호와 다르다 (내장 GPU 등 다른 장치까지 세고, 1부터일 수도 있다).
// 예: RUD 실측 API 응답은 RTX 5090 = id 1 (bus 1), RTX 5080 = id 2 (bus 16).
// 매핑 출처: ① 채굴기 통계 API 의 gpu_devices[].id / bus_id (돌고 있을 때 가장 확실)
//          ② `SRBMiner-MULTI --list-devices` 출력 (처음 한 번, 형식 차이에 관대하게 읽는다)
// 결과는 채굴기 경로·카드 구성·드라이버 버전을 키로 캐시하고, 키가 바뀌면 다시 확인한다.

export interface SrbMapEntry {
  /** SRBMiner 장치 번호 (--gpu-id 에 넣는 값) */
  srbId: number;
  /** PCI bus 번호 (nvidia-smi pci.bus_id 의 bus, 10진수) */
  bus: number;
}

export interface SrbDeviceCache {
  key: string;
  map: SrbMapEntry[];
  source: 'api' | 'list-devices';
  at: number;
}

/** 캐시 키: 채굴기 실행 파일 + NVIDIA 카드(bus·UUID) + 드라이버 버전 */
export function srbCacheKey(exe: string, gpus: { busId: string; uuid: string | null; driver: string | null }[]): string {
  const cards = gpus.map((g) => `${g.busId}|${g.uuid ?? ''}`).sort().join(',');
  return `${exe.toLowerCase()}#${cards}#${gpus.find((g) => g.driver)?.driver ?? ''}`;
}

/** 통계 API 의 장치 목록에서 (id 와 bus 가 모두 있는 것만) */
export function mapFromApi(devices: { id: number; bus: number | null }[]): SrbMapEntry[] {
  return devices.filter((d) => Number.isInteger(d.id) && d.id >= 0 && d.bus !== null && Number.isInteger(d.bus)).map((d) => ({ srbId: d.id, bus: d.bus as number }));
}

export interface ListedDevice {
  srbId: number;
  /** bus 후보 (출력이 10진수인지 16진수인지 모를 때 둘 다) */
  buses: number[];
  line: string;
}

const PCI_FULL = /\b(?:[0-9a-f]{4,8}:)?([0-9a-f]{2}):[0-9a-f]{2}\.[0-9a-f]\b/i;
const BUS_FIELD = /\bbus(?:[\s_-]*id)?\s*[:=#]?\s*\[?\s*(?:0x)?([0-9a-f]{1,4})\b/i;
const GPU_INDEX = [/\bGPU\s*#?\s*(\d{1,3})\b/i, /\[\s*(\d{1,3})\s*\]/, /^\s*(?:id\s*[:=]?\s*)?(\d{1,3})\s*[:|)\-]/i, /\bid\s*[:=]\s*(\d{1,3})\b/i];

/**
 * `--list-devices` 출력에서 장치 번호와 bus. 형식이 버전마다 달라 줄마다 관대하게 찾는다:
 * 번호는 "GPU1", "[1]", "1:", "id: 1" 등, bus 는 "0000:10:00.0" / "10:00.0" (16진수) 또는 "BUS: 16"·"bus_id 10" (10·16진 모두 후보).
 */
export function parseListDevices(text: string): ListedDevice[] {
  const out: ListedDevice[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '').trim();
    if (!line || !/bus/i.test(line) && !PCI_FULL.test(line)) continue;
    let srbId: number | null = null;
    for (const re of GPU_INDEX) {
      const m = re.exec(line);
      if (m) {
        srbId = Number(m[1]);
        break;
      }
    }
    if (srbId === null) continue;
    const buses: number[] = [];
    const full = PCI_FULL.exec(line);
    if (full) buses.push(Number.parseInt(full[1], 16));
    else {
      const f = BUS_FIELD.exec(line);
      if (!f) continue;
      if (/^\d+$/.test(f[1])) buses.push(Number.parseInt(f[1], 10));
      const hex = Number.parseInt(f[1], 16);
      if (!buses.includes(hex)) buses.push(hex);
    }
    if (!out.some((d) => d.srbId === srbId)) out.push({ srbId, buses, line });
  }
  return out;
}

/** --list-devices 결과를 실제 NVIDIA 카드 bus 에 맞춰 매핑 (bus 후보 중 실제로 있는 것, 한 카드에 하나만) */
export function mapFromListed(listed: ListedDevice[], nvBuses: number[]): SrbMapEntry[] {
  const out: SrbMapEntry[] = [];
  for (const d of listed) {
    const bus = d.buses.find((b) => nvBuses.includes(b) && !out.some((e) => e.bus === b));
    if (bus !== undefined) out.push({ srbId: d.srbId, bus });
  }
  return out;
}

/** 고른 카드들의 SRBMiner 번호. 하나라도 매핑이 없으면 이유와 함께 실패 */
export function resolveGpuIds(chosenBuses: number[], map: SrbMapEntry[]): { ids: number[] } | { error: string } {
  const ids: number[] = [];
  for (const bus of chosenBuses) {
    const hits = map.filter((e) => e.bus === bus);
    if (hits.length !== 1) return { error: hits.length ? `bus ${bus} 에 SRBMiner 장치가 여럿입니다` : `bus ${bus} 카드의 SRBMiner 장치 번호를 모릅니다` };
    ids.push(hits[0].srbId);
  }
  return { ids: ids.sort((a, b) => a - b) };
}

/** 캐시에 새 매핑을 합친다 (같은 bus·같은 번호는 새 값으로) */
export function mergeMap(old: SrbMapEntry[], add: SrbMapEntry[]): SrbMapEntry[] {
  const out = old.filter((o) => !add.some((a) => a.bus === o.bus || a.srbId === o.srbId));
  return [...out, ...add].sort((a, b) => a.srbId - b.srbId);
}
