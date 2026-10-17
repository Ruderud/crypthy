// 실제 하드웨어(Windows) 접근과 Mac 개발용 모의 구현을 같은 모양으로 묶는다.
// CRYPTHY_MOCK=1 이면 모의 구현: 외부에서 실행된 SRBMiner 가 두 GPU 로 채굴 중인 상황.
//   CRYPTHY_MOCK_FANSTOP=<nvidia-smi index>  30초 뒤 해당 GPU 팬이 0% (안전 감시 확인용)
//   CRYPTHY_MOCK_KILLFAIL=1                   taskkill 이 실패하는 상황 (권한 부족 재현)
//   CRYPTHY_MOCK_IDLE=1                       채굴기가 실행되지 않은 상태로 시작
import { execFile } from 'node:child_process';
import { parseVendors, type Vendor } from './catalog';
import { killMiner, runningMiners } from './miner';
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

export const realHardware: Hardware = {
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
  minerStats: (adapter, port) => {
    const a = minerApi(adapter);
    return a ? a.fetch(port) : Promise.reject(new Error(`unknown miner API ${adapter}`));
  },
  runningMiners: (known) => runningMiners(known),
  kill: (exe) => killMiner(exe),
};

export function mockHardware(): Hardware {
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
      return mining ? known.filter((k) => k === 'SRBMiner-MULTI.exe') : [];
    },
    async kill() {
      if (killFail && mining) return 'mock: Access is denied.';
      mining = false;
      startedAt = Date.now();
      return null;
    },
  };
}
