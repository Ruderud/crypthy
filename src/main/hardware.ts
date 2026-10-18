// 실제 하드웨어(Windows) 접근과 Mac 개발용 모의 구현을 같은 모양으로 묶는다.
// CRYPTHY_MOCK=1 이면 모의 구현: 외부에서 실행된 SRBMiner 가 두 GPU 로 채굴 중인 상황.
//   CRYPTHY_MOCK_FANSTOP=<nvidia-smi index>  30초 뒤 해당 GPU 팬이 0% (안전 감시 확인용)
//   CRYPTHY_MOCK_KILLFAIL=1                   taskkill 이 실패하는 상황 (권한 부족 재현)
//   CRYPTHY_MOCK_IDLE=1                       채굴기가 실행되지 않은 상태로 시작
//   CRYPTHY_MOCK_UNNAMED=1                    프로세스 이름을 모르는 채굴기 (API 로만 감지)
//   CRYPTHY_MOCK_TASKLISTFAIL=1               tasklist 가 항상 실패
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import { parseVendors, vendorsFromPciIds, type Vendor } from './catalog';
import { killMiner, runningMiners } from './miner';
import { killMinerLinux, runningMinersLinux } from './procLinux';
import { minerApi, type MinerStats } from './minerApi';
import { queryNvsmi, type NvGpu } from './nvsmi';

export interface Hardware {
  queryGpus(): Promise<NvGpu[]>;
  /** 모든 그래픽 어댑터의 벤더 (nvidia-smi 는 NVIDIA 만 보이므로 Win32_VideoController 사용) */
  gpuVendors(): Promise<Vendor[]>;
  minerStats(adapter: string, port: number): Promise<MinerStats>;
  runningMiners(known: string[]): Promise<string[]>;
  kill(exe: string): Promise<string | null>;
}

function minerStatsVia(adapter: string, port: number): Promise<MinerStats> {
  const a = minerApi(adapter);
  return a ? a.fetch(port) : Promise.reject(new Error(`unknown miner API ${adapter}`));
}

/** Windows: tasklist/taskkill, Win32_VideoController */
export const windowsHardware: Hardware = {
  queryGpus: () => queryNvsmi(),
  gpuVendors: () =>
    new Promise((resolve, reject) =>
      execFile(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-Command', '(Get-CimInstance Win32_VideoController).Name'],
        { timeout: 15_000, windowsHide: true },
        (err, stdout) => (err ? reject(err) : resolve(parseVendors(stdout))),
      ),
    ),
  minerStats: minerStatsVia,
  runningMiners: (known) => runningMiners(known),
  kill: (exe) => killMiner(exe),
};

/** Linux: /proc 스캔(컨테이너 제외), sysfs 벤더 id */
export function linuxHardware(known: () => string[], trusted: () => string[] = () => []): Hardware {
  return {
    queryGpus: () => queryNvsmi(),
    gpuVendors: async () => {
      const ids: string[] = [];
      for (const card of fs.readdirSync('/sys/class/drm').filter((d) => /^card\d+$/.test(d))) {
        try {
          ids.push(fs.readFileSync(`/sys/class/drm/${card}/device/vendor`, 'utf8'));
        } catch {
          // 가상 카드 등 vendor 파일이 없는 항목은 건너뜀
        }
      }
      return vendorsFromPciIds(ids);
    },
    minerStats: minerStatsVia,
    runningMiners: async (names) => runningMinersLinux(names, trusted()),
    kill: (name) => killMinerLinux(name, known(), trusted()),
  };
}

/** 모의 모드의 start 는 채굴 켜기(예약 작업·직접 실행)를 흉내 낸다 */
export function mockHardware(): Hardware & { start(): void } {
  const t0 = Date.now();
  let mining = process.env.CRYPTHY_MOCK_IDLE !== '1';
  let startedAt = Date.now();
  let accepted = 0;
  const fanStop = process.env.CRYPTHY_MOCK_FANSTOP;
  const killFail = process.env.CRYPTHY_MOCK_KILLFAIL === '1';
  const base = [
    { index: 0, srbId: 1, name: 'NVIDIA GeForce RTX 5090', busId: '00000000:01:00.0', bus: 1, limit: 600, power: 588, temp: 63, hash: 354e12 },
    { index: 1, srbId: 2, name: 'NVIDIA GeForce RTX 5080', busId: '00000000:10:00.0', bus: 16, limit: 280, power: 279, temp: 68, hash: 226e12 },
  ];
  const wobble = (n: number) => n * (1 + 0.02 * Math.sin(Date.now() / 3000 + n));
  const fanFor = (index: number) => (fanStop === String(index) && Date.now() - t0 > 30_000 ? 0 : mining ? 70 : 30);

  return {
    async queryGpus() {
      return base.map((g) => ({
        index: g.index,
        name: g.name,
        busId: g.busId,
        bus: g.bus,
        tempC: Math.round(mining ? wobble(g.temp) : 38),
        fanPct: fanFor(g.index),
        powerW: mining ? Math.round(wobble(g.power)) : g.index === 0 ? 89 : 12,
        powerLimitW: g.limit,
        powerMinW: 150,
        powerMaxW: g.index === 0 ? 600 : 400,
        utilPct: mining ? 100 : 3,
        uuid: `GPU-0000000${g.index}-mock`,
        driver: '999.99',
      }));
    },
    async gpuVendors() {
      return ['nvidia', 'amd'];
    },
    async minerStats() {
      if (!mining) throw new Error('mock: miner stopped');
      accepted += 1;
      return {
        uptimeS: Math.round((Date.now() - startedAt) / 1000),
        algorithm: 'pearlhash',
        pool: 'prl.kryptex.network:8048',
        latencyMs: 38,
        accepted,
        rejected: Math.floor(accepted / 200),
        totalHashrate: base.reduce((s, g) => s + g.hash, 0),
        devices: base.map((g) => ({ id: g.srbId, bus: g.bus, model: g.name, tempC: g.temp, fanPct: 70, powerW: g.power, hashrate: wobble(g.hash) })),
      };
    },
    async runningMiners(known) {
      if (process.env.CRYPTHY_MOCK_TASKLISTFAIL === '1') throw new Error('mock: tasklist timeout');
      if (process.env.CRYPTHY_MOCK_UNNAMED === '1') return [];
      return mining ? known.filter((k) => k === 'SRBMiner-MULTI.exe') : [];
    },
    async kill() {
      if (process.env.CRYPTHY_MOCK_UNNAMED === '1') return 'mock: process not found';
      if (killFail && mining) return 'mock: Access is denied.';
      mining = false;
      startedAt = Date.now();
      return null;
    },
    start() {
      mining = true;
      startedAt = Date.now();
    },
  };
}

/** 모의 모드 전용: 차트가 비어 보이지 않게 최근 6시간 GPU 기록과 14일 장부를 합성한다 */
export function mockSeed(now: number): { gpus: { id: string; points: { t: number; hash: number; temp: number; power: number }[] }[]; days: Record<string, { prl: number; kwh: number }> } {
  const minute = 60_000;
  const start = Math.floor(now / minute) * minute - 6 * 60 * minute;
  const gpu = (id: string, hash: number, temp: number, power: number, phase: number) => ({
    id,
    points: Array.from({ length: 6 * 60 }, (_, i) => {
      const w = Math.sin(i / 37 + phase) * 0.03 + Math.sin(i / 7) * 0.01;
      return { t: start + i * minute, hash: hash * (1 + w), temp: Math.round((temp + w * 60) * 10) / 10, power: Math.round(power * (1 + w / 2)) };
    }),
  });
  const days: Record<string, { prl: number; kwh: number }> = {};
  for (let d = 13; d >= 0; d--) {
    const t = new Date(now - d * 86_400_000);
    const key = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`;
    days[key] = { prl: Math.round((5.6 + Math.sin(d / 2) * 0.6) * 1000) / 1000, kwh: Math.round((20.5 + Math.cos(d) * 0.8) * 10) / 10 };
  }
  return { gpus: [gpu('00000000:01:00.0', 354e12, 63, 588, 0), gpu('00000000:10:00.0', 226e12, 68, 279, 1.3)], days };
}
