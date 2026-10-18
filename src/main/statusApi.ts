import http from 'node:http';
import type { AppState } from '../shared/types';

export const STATUS_PORT = 47321;
const MAX_GPUS = 8;
const MAX_ALERTS = 20;
const MAX_STR = 120;

const s = (v: string | null | undefined) => (v == null ? null : v.slice(0, MAX_STR));
const round = (v: number, digits: number) => (Number.isFinite(v) ? Math.round(v * 10 ** digits) / 10 ** digits : null);

/** GET /v1/status 응답 (크기 제한된 JSON) */
export function buildStatus(st: AppState) {
  return {
    ts: st.ts,
    miner: {
      running: st.miner.running,
      mode: st.miner.mode,
      pool: s(st.miner.pool),
      uptime_s: st.miner.uptimeS,
      accepted: st.miner.accepted,
      rejected: st.miner.rejected,
    },
    gpus: st.gpus.slice(0, MAX_GPUS).map((g) => ({
      index: g.index,
      name: s(g.name),
      temp_c: g.tempC,
      fan_pct: g.fanPct,
      power_w: g.powerW,
      power_limit_w: g.powerLimitW,
      util_pct: g.utilPct,
      hashrate: g.hashrate,
    })),
    // 누적 손익 집계값만 (원시 로그·지갑 주소 없음)
    pnl: st.pnl
      ? {
          currency: 'KRW',
          coin: s(st.pnl.symbol),
          mined_coin: round(st.pnl.all.mined, 8),
          holdings_coin: round(st.pnl.holdings, 8),
          revenue_krw: round(st.pnl.all.revenueKrw, 0),
          energy_cost_krw: round(st.pnl.all.energyCostKrw, 0),
          realized_krw: round(st.pnl.realizedKrw, 0),
          unrealized_krw: st.pnl.unrealizedKrw === null ? null : round(st.pnl.unrealizedKrw, 0),
          total_pnl_krw: st.pnl.totalPnlKrw === null ? null : round(st.pnl.totalPnlKrw, 0),
          estimated: st.pnl.estimated,
        }
      : null,
    alerts: st.alerts.slice(0, MAX_ALERTS).map((a) => ({
      ts: a.ts,
      level: a.level,
      code: a.code,
      gpu: a.gpu ?? null,
      message: s(a.message),
    })),
  };
}

const ALLOWED_HOSTS = new Set([`127.0.0.1:${STATUS_PORT}`, `localhost:${STATUS_PORT}`]);

/** 127.0.0.1 전용, 읽기 전용. Host 헤더 검사로 DNS rebinding 차단 */
export function startStatusServer(getState: () => AppState, onError: (e: Error) => void): http.Server {
  const server = http.createServer((req, res) => {
    const send = (code: number, body: unknown) => {
      res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
      res.end(JSON.stringify(body));
    };
    if (!ALLOWED_HOSTS.has(req.headers.host ?? '')) return send(403, { error: 'forbidden' });
    if (req.method !== 'GET') return send(405, { error: 'method_not_allowed' });
    if (req.url !== '/v1/status') return send(404, { error: 'not_found' });
    send(200, buildStatus(getState()));
  });
  server.on('error', onError);
  server.listen(STATUS_PORT, '127.0.0.1');
  return server;
}
