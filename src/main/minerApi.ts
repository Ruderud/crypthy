// 실행 중인 채굴기의 로컬 통계 API 어댑터. 통계는 읽기만 한다.
// 새 채굴기를 지원하려면 MinerStats 를 돌려주는 어댑터를 MINER_APIS 에 추가한다.
import { fetchSrbStatus, type SrbStatus } from './srbminer';

/** 채굴기 공통 통계 (devices[].bus 는 PCI bus 번호, nvidia-smi 와 매칭용) */
export type MinerStats = SrbStatus;

export interface MinerApiAdapter {
  id: string;
  label: string;
  defaultPort: number;
  fetch(port: number): Promise<MinerStats>;
}

export const MINER_APIS: Record<string, MinerApiAdapter> = {
  srbminer: {
    id: 'srbminer',
    label: 'SRBMiner-MULTI (--api-enable --api-port)',
    defaultPort: 21550,
    fetch: (port) => fetchSrbStatus(port),
  },
};

export function minerApi(id: string): MinerApiAdapter | null {
  return Object.hasOwn(MINER_APIS, id) ? MINER_APIS[id] : null;
}
