// 실제 하드웨어(Windows) 접근과 Mac 개발용 모의 구현을 같은 모양으로 묶는다.
// CRYPTHY_MOCK=1 이면 모의 구현.
//   CRYPTHY_MOCK_FANSTOP=<nvidia-smi index>  30초 뒤 해당 GPU 팬이 0% (안전 감시 확인용)
//   CRYPTHY_MOCK_KILLFAIL=1                   taskkill 이 실패하는 상황 (권한 부족 재현)
import type { Settings } from '../shared/types';
import { killMiner, launchMiner, minerPids } from './miner';
import { queryNvsmi, type NvGpu } from './nvsmi';
import { fetchSrbStatus, type SrbStatus } from './srbminer';

export interface Hardware {
  queryGpus(): Promise<NvGpu[]>;
  minerStatus(port: number): Promise<SrbStatus>;
  minerPids(exe: string): Promise<number[]>;
  launch(s: Settings, gpuIds: number[]): number | null;
  kill(exe: string): Promise<string | null>;
}

export const realHardware: Hardware = {
  queryGpus: () => queryNvsmi(),
  minerStatus: (port) => fetchSrbStatus(port),
  minerPids: (exe) => minerPids(exe),
  launch: (s, ids) => launchMiner(s, ids),
  kill: (exe) => killMiner(exe),
};

export function mockHardware(): Hardware {
  const t0 = Date.now();
  let ids: number[] = [];
  let pid = 0;
  let startedAt = 0;
  let accepted = 0;
  const fanStop = process.env.CRYPTHY_MOCK_FANSTOP;
  const killFail = process.env.CRYPTHY_MOCK_KILLFAIL === '1';
  // SRBMiner id 가 nvidia-smi index 와 다른 실제 사례(내장 GPU가 0번)를 흉내 낸다
  const base = [
    { index: 0, srbId: 1, name: 'NVIDIA GeForce RTX 5090', busId: '00000000:01:00.0', bus: 1, limit: 600, power: 588, temp: 63, hash: 354e12 },
    { index: 1, srbId: 2, name: 'NVIDIA GeForce RTX 5080', busId: '00000000:10:00.0', bus: 16, limit: 280, power: 279, temp: 68, hash: 226e12 },
  ];
  const wobble = (n: number) => n * (1 + 0.02 * Math.sin(Date.now() / 3000 + n));
  const fanFor = (index: number, mining: boolean) => (fanStop === String(index) && Date.now() - t0 > 30_000 ? 0 : mining ? 70 : 30);

  return {
    async queryGpus() {
      return base.map((g) => {
        const mining = ids.includes(g.srbId);
        return {
          index: g.index,
          name: g.name,
          busId: g.busId,
          bus: g.bus,
          tempC: Math.round(mining ? wobble(g.temp) : 38),
          fanPct: fanFor(g.index, mining),
          powerW: mining ? Math.round(wobble(g.power)) : g.index === 0 ? 89 : 12,
          powerLimitW: g.limit,
          powerMinW: 150,
          powerMaxW: g.index === 0 ? 600 : 400,
          utilPct: mining ? 100 : 3,
        };
      });
    },
    async minerStatus() {
      if (ids.length === 0) throw new Error('mock: miner stopped');
      accepted += 1;
      const mining = base.filter((g) => ids.includes(g.srbId));
      return {
        uptimeS: Math.round((Date.now() - startedAt) / 1000),
        algorithm: 'pearlhash',
        pool: 'prl.kryptex.network:8048',
        latencyMs: 38,
        accepted,
        rejected: Math.floor(accepted / 200),
        totalHashrate: mining.reduce((s, g) => s + g.hash, 0),
        devices: mining.map((g) => ({ id: g.srbId, bus: g.bus, model: g.name, tempC: g.temp, fanPct: 70, powerW: g.power, hashrate: wobble(g.hash) })),
      };
    },
    async minerPids() {
      return ids.length ? [pid] : [];
    },
    launch(_s, gpuIds) {
      ids = gpuIds.length ? [...gpuIds] : base.map((g) => g.srbId);
      pid = 1000 + Math.floor(Math.random() * 9000);
      startedAt = Date.now();
      accepted = 0;
      return pid;
    },
    async kill() {
      if (killFail && ids.length) return 'mock: Access is denied.';
      ids = [];
      return null;
    },
  };
}
