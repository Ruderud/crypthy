// 트레이 툴팁 문구 (게임 중에도 트레이에 마우스만 올리면 상태·수익이 보이게). Windows 툴팁은 127자 제한
import type { AppState } from '../shared/types';

const won = (v: number) => `${v < 0 ? '-' : ''}₩${Math.abs(Math.round(v)).toLocaleString('ko-KR')}`;
const short = (label: string) => /(\d{4}\s*(Ti|Super|XT|XTX)?)\b/i.exec(label)?.[1] ?? label.slice(0, 10);

export function trayTooltip(st: AppState, app = 'Crypthy'): string {
  const present = st.gpus.filter((g) => g.present);
  const mining = present.filter((g) => g.mining).length;
  const hold = st.gpus.some((g) => g.hold);
  const status = hold ? '위험 보류' : st.miner.running ? `채굴 중 ${mining}/${present.length} GPU` : '정지';
  const p = st.profit;
  const live = p.liveKrwPerH === null ? '실시간 -' : `${won(p.liveKrwPerH)}/h`;
  const t = st.pnl.today;
  // Kryptex 풀이 아니면 장부 대신 해시레이트 기반 추정 순수익 (화면 HUD 와 같게)
  const today = p.supported === false
    ? p.today?.estNetKrw === null || p.today?.estNetKrw === undefined ? '오늘 -' : `오늘 ${won(p.today.estNetKrw)}(추정)`
    : t.revenueKrw === 0 && t.unpriced > 0 ? '오늘 시세 없음' : `오늘 ${won(t.netKrw)}${t.estimated ? '(추정)' : ''}`;
  const temps = present.map((g) => `${short(g.label)} ${g.tempC ?? '-'}°C${g.hold ? ' 보류' : ''}`).join(' / ');
  const head = st.remote ? `${app} · 원격 · ${status}` : `${app} · ${status}`;
  return [head, `${live} · ${today}`, temps].filter(Boolean).join('\n').slice(0, 127);
}
