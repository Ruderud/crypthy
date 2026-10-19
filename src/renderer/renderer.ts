import type { Api, AppState, ChartsView, GpuConfig, GpuView, Settings } from '../shared/types';

const crypthy = (window as unknown as { crypthy: Api }).crypthy;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n = (v: number | null | undefined, digits = 0, unit = '') =>
  v === null || v === undefined || !Number.isFinite(v) ? '-' : `${v.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit}`;
const th = (h: number | null | undefined) => (h ? `${(h / 1e12).toFixed(1)} TH/s` : '-');
const thShort = (h: number | null | undefined) => (h ? `${Math.round(h / 1e12)}T` : '-');
const krw = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${Math.round(v).toLocaleString('ko-KR')}원`);
const dur = (s: number | null) => {
  if (s === null) return '-';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
};
const stat = (k: string, v: string, cls = '') => `<div><dt>${esc(k)}</dt><dd class="${cls}">${v}</dd></div>`;
const signCls = (v: number | null) => (v === null ? '' : v < 0 ? 'crit' : 'good');

let state: AppState | null = null;
let lastTarget: string | null = null;
const readOnlyRemote = (st: AppState) => !!st.remote && !st.remote.write;
const RO_WHY = '원격 읽기 전용 연결이라 바꿀 수 없습니다 (쓰기 토큰으로 연결하면 조작할 수 있습니다)';

/** localStorage 는 화면 편의 설정만 (탭·테마·읽은 알림). 막혀 있어도 화면은 동작 */
const store = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string): void {
    try {
      localStorage.setItem(k, v);
    } catch {
      // 저장이 막혀 있어도 현재 화면에는 적용
    }
  },
};

function msg(id: string, text: string | null, ok = '완료') {
  const el = $(id);
  el.textContent = text ?? ok;
  el.className = `msg ${text ? 'err' : 'ok'}`;
}

let toastTimer: ReturnType<typeof setTimeout> | null = null;
function toast(text: string, err = false) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    el.setAttribute('role', 'status');
    document.body.append(el);
  }
  el.textContent = text;
  el.className = `toast ${err ? 'err' : 'ok'} show`;
  if (toastTimer) clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el!.classList.remove('show'), 4000);
}

function tempClass(g: GpuView, s: Settings) {
  if (g.tempC === null) return '';
  return g.tempC >= s.safety.tempStopC ? 'crit' : g.tempC >= s.safety.tempWarnC ? 'warn' : 'good';
}

/** GPU 가 "꺼짐인데 채굴 중" (채굴기가 GPU 선택을 따르지 않음) */
const offButMining = (g: GpuView) => g.selectable && !g.mine && (g.hashrate ?? 0) > 0;

// ---------- 탭 ----------

const TABS = ['dash', 'pnl', 'sell', 'miner'] as const;
type Tab = (typeof TABS)[number];
function showTab(t: Tab) {
  document.querySelectorAll<HTMLElement>('#tabbar [data-tab]').forEach((b) => {
    const on = b.dataset.tab === t;
    b.classList.toggle('on', on);
    b.setAttribute('aria-selected', String(on));
  });
  document.querySelectorAll<HTMLElement>('[data-panel]').forEach((p) => (p.hidden = p.dataset.panel !== t));
  store.set('crypthy.tab', t);
  if (t !== 'miner') stopMinerLog();
}
document.addEventListener('click', (e) => {
  const go = (e.target as HTMLElement).closest<HTMLElement>('[data-go]')?.dataset.go;
  if (go && (TABS as readonly string[]).includes(go)) showTab(go as Tab);
  const sec = (e.target as HTMLElement).closest<HTMLElement>('[data-settings]')?.dataset.settings;
  if (sec) {
    for (const d of Array.from(document.querySelectorAll<HTMLDialogElement>('dialog.modal[open]'))) if (!closeModal(d.id)) return;
    openSettings(sec);
  }
});
document.querySelectorAll<HTMLElement>('#tabbar [data-tab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab as Tab)));

// ---------- HUD ----------

function renderHud(st: AppState) {
  const m = st.miner;
  const present = st.gpus.filter((g) => g.present);
  const mining = present.filter((g) => g.mining).length;
  const holds = st.gpus.filter((g) => g.hold);
  const off = present.filter(offButMining);
  const chip = $('hudMining');
  const [text, cls, tip] = st.ts === 0
    ? ['확인 중', '', '']
    : holds.length
      ? [`위험 보류 · ${holds.length}`, 'warn', `안전 보류: ${holds.map((g) => `${g.label} — ${g.hold}`).join(' / ')}`]
      : off.length
        ? ['꺼짐인데 채굴 중', 'warn', `${off.map((g) => g.label).join(', ')}: 채굴기가 GPU 선택을 따르지 않습니다`]
        : m.running
          ? [`채굴 중 · ${mining}/${present.length} GPU`, 'ok', m.processes.join(', ') || (m.apiOk ? '채굴기 API 응답' : '')]
          : ['정지', 'idle', '실행 중인 채굴기가 없습니다'];
  chip.textContent = text;
  chip.className = `chip ${cls}`;
  chip.title = tip ? `${tip} · 대시보드로` : '대시보드로';

  // 켜기·끄기: 지금 상태에 맞는 하나만, 할 수 없으면 비활성 + 이유
  const c = m.control;
  const btn = $<HTMLButtonElement>('hudToggle');
  btn.hidden = c.mode === 'none' && !m.running;
  const stop = m.running;
  btn.textContent = stop ? '끄기' : '켜기';
  btn.className = stop ? '' : 'primary';
  const ro = readOnlyRemote(st);
  btn.disabled = ro || (stop ? !c.canStop : !c.canStart);
  btn.title = ro ? RO_WHY : stop ? (c.canStop ? '채굴 끄기 (정지 명령 + 채굴기 프로세스 정지)' : c.blocker ?? '끌 수 없습니다') : c.blocker ?? (c.consented ? '채굴 켜기' : '처음 켤 때 위험·비용 고지에 동의합니다');

  const p = st.profit;
  const live = $('hudLive').querySelector('b')!;
  live.textContent = p.liveKrwPerH === null ? (p.liveCoinPerH === null ? '계산 대기' : '시세 없음') : `${krw(p.liveKrwPerH)}/h`;
  live.className = p.liveKrwPerH === null ? 'muted' : signCls(p.liveKrwPerH);
  const today = $('hudToday').querySelector('b')!;
  const t = st.pnl.today;
  // Kryptex 풀이 아니면 장부 대신 해시레이트 기반 추정 순수익
  today.innerHTML = !p.supported
    ? p.today.estNetKrw === null
      ? `<span class="muted">${!st.setup.walletSet || !st.setup.poolSet ? '설정 필요' : '-'}</span>`
      : `<span class="${signCls(p.today.estNetKrw)}">${krw(p.today.estNetKrw)}</span><em class="est">추정</em>`
    : t.revenueKrw === 0 && t.unpriced > 0
      ? '<span class="muted">시세 없음</span>'
      : `<span class="${signCls(t.netKrw)}">${krw(t.netKrw)}</span>${t.estimated ? '<em class="est">추정</em>' : ''}`;
  const price = $('hudPrice');
  const pb = price.querySelector('b')!;
  price.querySelector('small')!.textContent = `${p.symbol} 시세`;
  pb.innerHTML = p.price
    ? `$${esc(p.price.usd)} <span class="${(p.change24hPct ?? 0) < 0 ? 'crit' : 'good'}">${n(p.change24hPct, 1, '%')}</span>`
    : '<span class="muted">-</span>';
  price.classList.toggle('stale', !!p.price?.stale);
  price.title = p.price ? `${p.price.stale ? '지난 시세 · ' : ''}${new Date(p.price.at).toLocaleTimeString('ko-KR')} 기준 · 차트 창의 시세` : '차트 창의 시세';

  $('hudGpus').innerHTML = present
    .map((g) => {
      const cls = g.hold ? 'crit' : offButMining(g) ? 'warn' : g.selectable && !g.mine ? 'idle' : tempClass(g, st.settings);
      const tipText = `${g.label} · ${n(g.tempC, 0, '°C')} · ${n(g.powerW, 0, 'W')} · ${th(g.hashrate)}${g.hold ? ` · 보류: ${g.hold}` : ''}${offButMining(g) ? ' · 꺼짐인데 채굴 중' : g.selectable && !g.mine ? ' · 채굴 안 함' : ''}`;
      return `<button type="button" class="gchip ${cls}" data-gpu-go="${esc(g.id)}" title="${esc(tipText)}"><b>${esc(shortLabel(g.label))}</b> <span class="t">${n(g.tempC, 0, '°')}</span><span class="pw"> ${n(g.powerW, 0, 'W')}</span><span class="hs"> ${thShort(g.hashrate)}</span></button>`;
    })
    .join('');

  $('mock').hidden = !st.mock;
  const r = st.remote;
  const rb = $('remoteBadge');
  rb.hidden = !r;
  if (r) {
    rb.textContent = `원격${r.write ? '' : ' · 읽기 전용'}`;
    rb.className = `badge ${r.error ? 'crit' : 'info'}`;
    rb.title = `${r.url.replace(/^https?:\/\//, '')} · ${r.error ? `연결 오류: ${r.error}` : `원격 Crypthy v${r.version ?? '?'} · ${r.at ? new Date(r.at).toLocaleTimeString('ko-KR') : '-'} 받음`} · 설정 › 원격 연결`;
  }
  const u = st.update;
  $('updateDot').hidden = !(u.prompt || u.status === 'available' || u.status === 'ready' || u.status === 'downloading');

  const seen = Number(store.get('crypthy.alertsSeen') ?? 0);
  const unread = st.alerts.filter((a) => a.ts > seen);
  $('hudAlertCount').textContent = String(unread.length);
  $('hudAlerts').className = `icon-btn ${unread.some((a) => a.level === 'critical') ? 'crit' : unread.some((a) => a.level === 'warn') ? 'warn' : unread.length ? 'info' : ''}`;
}

/** "NVIDIA GeForce RTX 5090" → "5090" (HUD 칩은 짧게) */
const shortLabel = (label: string) => /(\d{4}\s*(Ti|Super|XT|XTX)?)\b/i.exec(label)?.[1] ?? label.slice(0, 10);

$('hudGpus').addEventListener('click', (e) => {
  const id = (e.target as HTMLElement).closest<HTMLElement>('[data-gpu-go]')?.dataset.gpuGo;
  if (!id) return;
  showTab('dash');
  document.querySelector(`[data-gpu-card="${CSS.escape(id)}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
});
$('hudToggle').addEventListener('click', () => {
  const run = state?.miner.running ? crypthy.stopMining() : crypthy.startMining();
  void run.then((err) => {
    if (err && err !== '취소됨') toast(err, true);
    return refresh();
  });
});
$('hudPrice').addEventListener('click', () => void crypthy.openCharts('price'));
$('openCharts').addEventListener('click', () => void crypthy.openCharts());
$('sparkBig').addEventListener('click', () => void crypthy.openCharts('gpu'));
$('remoteBadge').addEventListener('click', () => openSettings('remote'));
$('updateDot').addEventListener('click', () => flashUpdateBanner());
$('hudAlerts').addEventListener('click', () => openAlerts());
$('allAlerts').addEventListener('click', () => openAlerts());
$('openSettings').addEventListener('click', () => openSettings());

function openAlerts() {
  if (!state) return;
  const max = Math.max(0, ...state.alerts.map((a) => a.ts));
  store.set('crypthy.alertsSeen', String(max));
  renderHud(state);
  openModal('alertsModal');
}

// ---------- 대시보드 ----------

function renderSetup(st: AppState) {
  const s = st.setup;
  const need = !s.walletSet || !s.poolSet;
  $('setupStrip').hidden = !need && s.apiConnected;
  $('setupStripText').textContent = need
    ? '지갑·풀을 아직 설정하지 않았습니다. 수익·풀 통계를 보려면 처음 설정을 마쳐 주세요.'
    : '채굴기 통계 API 가 응답하지 않습니다. SRBMiner-MULTI 는 --api-enable --api-port 21550 옵션으로 실행하고, 포트는 설정 › 채굴기에서 맞추세요.';
  $<HTMLButtonElement>('openWizard').disabled = readOnlyRemote(st);
  const mark = (id: string, ok: boolean, okText = '완료', noText = '필요') => {
    const el = document.querySelector(`#${id} .state`)!;
    el.textContent = ok ? okText : noText;
    el.className = `state badge ${ok ? 'ok' : 'warn'}`;
  };
  mark('stepWallet', s.walletSet && s.poolSet, '완료', '필요');
  mark('stepApi', s.apiConnected, '연결됨', '응답 없음');
  mark('stepControl', st.miner.control.mode !== 'none', '설정됨', '선택');
}

function renderGpus(st: AppState) {
  const ro = readOnlyRemote(st);
  $('gpus').innerHTML = st.gpus
    .filter((g) => g.present || g.hold)
    .map((g) => {
      const fanCls = g.fanPct === 0 && (g.powerW ?? 0) > st.settings.safety.fanStopPowerW ? 'crit' : '';
      // GPU 별 채굴 선택: 실행 파일 방식에서만, 원격 읽기 전용이면 바꿀 수 없음
      const why = !g.selectable ? 'GPU 별 채굴은 "실행 파일 직접 실행" 방식에서만 적용됩니다' : ro ? RO_WHY : g.mine ? '이 GPU 로 채굴하지 않기 (채굴 중이면 다시 시작)' : '이 GPU 로 채굴 (채굴 중이면 다시 시작)';
      const toggle = `<label class="toggle mini" title="${esc(why)}"><input type="checkbox" data-gpu-mine="${esc(g.id)}" ${g.mine ? 'checked' : ''} ${!g.selectable || ro ? 'disabled' : ''} /><span>채굴</span></label>`;
      return `<article class="card gpu ${g.hold ? 'excluded' : ''}" data-gpu-card="${esc(g.id)}">
        <h2>${esc(g.label)} <span class="muted small">#${esc(g.index ?? '-')}</span>
          ${offButMining(g)
            ? '<span class="badge warn" title="채굴기가 GPU 선택을 따르지 않습니다">꺼짐인데 채굴 중</span>'
            : `<span class="badge ${g.mining ? 'ok' : ''}">${g.mining ? '채굴 중' : g.selectable && !g.mine ? '채굴 안 함' : g.present ? '대기' : '인식 안 됨'}</span>`}
          <span class="spacer"></span>${toggle}</h2>
        <div class="gpu-body">
          <div class="big ${tempClass(g, st.settings)}">${n(g.tempC, 0, '°C')}</div>
          <dl class="stats tight">
            ${stat('팬', n(g.fanPct, 0, '%'), fanCls)}
            ${stat('전력 / 한도', `${n(g.powerW, 0)} / ${n(g.powerLimitW, 0, ' W')}`)}
            ${stat('사용률', n(g.utilPct, 0, '%'))}
            ${stat('해시레이트', th(g.hashrate))}
          </dl>
        </div>
        ${g.hold ? `<div class="banner">안전 보류: ${esc(g.hold)} — 보류 중에는 채굴기가 다시 실행되면 정지합니다 <button data-clear="${esc(g.id)}" ${ro ? `disabled title="${esc(RO_WHY)}"` : ''}>원인 해결 · 보류 해제</button></div>` : ''}
      </article>`;
    })
    .join('') || '<article class="card muted">인식된 GPU 가 없습니다</article>';
}

function renderDash(st: AppState) {
  const p = st.profit;
  const sym = esc(p.symbol);
  $('poolSub').textContent = p.supported ? '' : '(Kryptex 풀이 아니면 풀 통계 없음)';
  $('poolStats').innerHTML = p.supported
    ? [
        stat('풀 잔고 (미지급)', `${n(p.balanceCoin, 4)} ${sym}`),
        stat('지급 완료 / 지급 중', `${n(p.paidCoin === null ? null : p.paidCoin - p.payingCoin, 4)} / ${n(p.payingCoin, 4)}`),
        stat('이번 달 순익', `<span class="${signCls(st.pnl.month.netKrw)}">${krw(st.pnl.month.netKrw)}</span>${st.pnl.month.estimated ? ' <span class="warn small">추정</span>' : ''}`),
      ].join('')
    : [stat('지갑', st.setup.walletSet ? '설정됨' : '<span class="warn">필요</span>'), stat('풀', st.setup.poolSet ? esc(st.settings.pool) : '<span class="warn">필요</span>')].join('');
  const a = st.autoSell;
  const c = st.settings.autoSell;
  const l = a.last;
  $('dashSell').innerHTML = [
    stat('상태', !c.enabled ? '<span class="muted">꺼짐</span>' : c.dryRun ? '<span class="warn">모의 실행</span>' : '<span class="good">실제 매도</span>'),
    stat('다음 실행', a.nextRunAt ? new Date(a.nextRunAt).toLocaleString('ko-KR', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '-'),
    stat('마지막', l ? `<span class="${l.status === 'error' || l.status === 'skipped' ? 'warn' : ''}">${esc(AS_STATUS[l.status] ?? l.status)}</span>` : '-'),
    stat('SafeTrade 잔고', a.balance ? `${n(a.balance.prl, 2)} PRL · ${n(a.balance.usdt, 2)} USDT` : '<span class="muted">조회 전</span>'),
  ].join('');
  const items = st.alerts.slice(0, 3);
  $('dashAlerts').innerHTML = items.length
    ? items.map((x) => `<li class="${esc(x.level)}"><time>${new Date(x.ts).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' })}</time> ${esc(x.message)}</li>`).join('')
    : '<li class="muted">알림 없음</li>';
  const sel = st.miner.gpuSelection;
  const dm = $('dashMinerMsg');
  dm.hidden = !(sel && !sel.applied && st.miner.running);
  if (sel && !sel.applied) {
    dm.className = 'small warn';
    dm.textContent = `카드 선택을 적용할 수 없음 — 모든 카드로 채굴 중 (${sel.reason})`;
  }
}

/** 대시보드의 최근 1시간 해시 추이선 (차트 창 데이터의 GPU 합계) */
function renderSpark(v: ChartsView) {
  const since = Date.now() - 3600_000;
  const sum = new Map<number, number>();
  for (const g of v.gpus) for (const p of g.points) if (p.t >= since && p.hash !== null) sum.set(Math.round(p.t / 60_000), (sum.get(Math.round(p.t / 60_000)) ?? 0) + (p.hash as number));
  const pts = [...sum.entries()].sort((a, z) => a[0] - z[0]);
  const svg = $('spark');
  if (pts.length < 2) {
    svg.innerHTML = '<text x="300" y="34" text-anchor="middle" class="spark-empty">기록이 쌓이면 표시합니다 (1분마다)</text>';
    $('sparkNow').textContent = '';
    return;
  }
  const t0 = pts[0][0];
  const t1 = pts[pts.length - 1][0];
  const max = Math.max(...pts.map((p) => p[1]));
  const min = Math.min(...pts.map((p) => p[1]));
  const span = max - min || max || 1;
  const xy = pts.map(([t, h]) => `${((t - t0) / Math.max(1, t1 - t0)) * 600},${56 - ((h - min) / span) * 50}`);
  svg.innerHTML = `<polyline class="spark-area" points="0,60 ${xy.join(' ')} 600,60" /><polyline class="spark-line" points="${xy.join(' ')}" />`;
  $('sparkNow').textContent = `지금 ${th(pts[pts.length - 1][1])} · 범위 ${th(min)} ~ ${th(max)}`;
}

$('gpus').addEventListener('click', async (e) => {
  const id = (e.target as HTMLElement).dataset.clear;
  if (id && confirm('보류 원인(팬 막힘·과열 등)을 해결했나요? 해제해도 앱은 채굴기를 시작하지 않습니다.')) {
    await crypthy.clearHold(id);
    await refresh();
  }
});
// GPU 별 채굴 켜기·끄기 (카드는 상태가 올 때마다 다시 그려지므로 위임)
$('gpus').addEventListener('change', (e) => {
  const input = e.target as HTMLInputElement;
  const id = input.dataset.gpuMine;
  if (!id) return;
  input.disabled = true;
  void crypthy.setGpuMining(id, input.checked).then((err) => {
    if (err && err !== '취소됨') toast(err, true);
    return refresh();
  });
});

// ---------- 수익·장부 ----------

/** 오늘·이번 달 수익 = (풀 확정 + 소급 + 실시간 추정) × 시세 − 같은 기간 전력비. 세부는 보조 줄과 툴팁으로 */
function periodProfit(v: AppState['pnl']['month'], sym: string): string {
  const parts = `확정 ${n(v.confirmed, 4)} · 소급 ${n(v.backfill, 4)} · 실시간 추정 ${n(v.pending, 4)} ${sym}`;
  const tip = esc(`${parts}\n매출 ${krw(v.revenueKrw)} − 전력비 ${krw(v.energyCostKrw)}\n소급·실시간 추정분은 추정값이고, 실시간 추정분은 풀에 반영되면 확정분으로 바뀝니다.`);
  const net = v.revenueKrw === 0 && v.unpriced > 0
    ? '<span class="muted">시세 없음</span>'
    : `<span class="${signCls(v.netKrw)} big-num">${krw(v.netKrw)}</span>${v.estimated ? ' <span class="warn small">추정 포함</span>' : ''}`;
  return `<div title="${tip}">${net}<div class="muted small">${n(v.mined, 4)} ${sym} (${parts}) · 전력비 ${krw(v.energyCostKrw)}</div></div>`;
}

function renderProfit(p: AppState['profit'], pnl: AppState['pnl']): string {
  const sym = esc(p.symbol);
  const price = p.price
    ? `$${esc(p.price.usd)} <span class="${(p.change24hPct ?? 0) < 0 ? 'crit' : 'good'} small">${n(p.change24hPct, 1, '%')} 24h</span>` +
      `<div class="small ${p.price.stale ? 'warn' : 'muted'}">${p.price.stale ? '지난 시세 · ' : ''}${new Date(p.price.at).toLocaleTimeString('ko-KR')} 기준</div>`
    : '<span class="muted">시세 없음</span>';
  const live = p.liveKrwPerH === null
    ? `<span class="muted">${p.liveCoinPerH === null ? '해시레이트·풀 통계 필요' : '시세 없음'}</span>`
    : `<span class="${signCls(p.liveKrwPerH)} big-num">${krw(p.liveKrwPerH)}/h</span> <span class="muted small">${n(p.liveCoinPerH, 3)} ${sym}/h</span>`;
  const est = (v: AppState['profit']['today']) =>
    v.estNetKrw === null ? '<span class="muted">-</span>' : `<span class="${signCls(v.estNetKrw)}">${krw(v.estNetKrw)}</span> <span class="muted small">${n(v.estCoin, 3)} ${sym} · ${n(v.kwh, 2)} kWh</span>`;
  const rows = [stat('실시간 추정 순수익', live), stat(`${p.symbol} 시세`, price)];
  if (p.supported) {
    rows.push(
      stat('오늘 수익', periodProfit(pnl.today, sym)),
      stat('이번 달 수익', periodProfit(pnl.month, sym)),
      stat('풀 누적 채굴량 (지급 + 풀 잔고)', `${n(p.lifetimeCoin, 4)} ${sym}`),
      stat('지급 완료 / 지급 중 / 풀 잔고(미지급)', `${n(p.paidCoin === null ? null : p.paidCoin - p.payingCoin, 4)} / ${n(p.payingCoin, 4)} / ${n(p.balanceCoin, 4)} ${sym}`),
    );
  } else {
    rows.push(
      stat('오늘 추정 순수익', est(p.today)),
      stat('이번 달 추정 순수익', est(p.month)),
      stat('풀 확정 채굴량', '지갑과 Kryptex 풀(*.kryptex.network)을 입력하면 표시합니다'),
    );
  }
  return rows.join('');
}

/** 공유 장부 상태: 폴더·인스턴스·마지막 동기화, 쓸 수 없으면 경고 */
function renderShared(st: AppState) {
  const sh = st.sharedLedger;
  const el = $('sharedInfo');
  el.hidden = !sh;
  if (!sh) return;
  const others = sh.instances.filter((i) => i !== sh.instanceId);
  el.className = `small ${sh.ok && !sh.overlaps ? 'muted' : 'warn'}`;
  el.textContent = sh.ok
    ? `공유 장부 ${sh.dir} · 이 PC ${sh.instanceId}${others.length ? ` + ${others.join(', ')}` : ' (다른 OS 기록 아직 없음)'} · ${sh.at ? new Date(sh.at).toLocaleTimeString('ko-KR') : '-'} 동기화${sh.overlaps ? ` · 전력 기록 시간 겹침 ${sh.overlaps}곳` : ''}`
    : `공유 장부 ${sh.dir} 를 쓸 수 없어 이 PC 에만 기록 중 (${sh.error ?? ''}). 폴더가 다시 보이면 밀린 기록을 옮깁니다.`;
}

/** 0.3.4 에서 적용해 떼어 내지 못한 소급분은 다시 계산할 수 없다 */
const canBootstrap = (p: AppState['pnl']) => p.trackStart !== null && !(p.bootstrapped && !p.backfill);

function renderPnl(st: AppState) {
  renderShared(st);
  const p = st.pnl;
  const sym = esc(p.symbol);
  const est = (on: boolean) => (on ? ' <span class="warn small">추정</span>' : '');
  $('pnlSub').textContent = '매출 = 채굴 시점 시세, 미실현 = 보유량 × 현재가, 총 PnL = 실현 + 미실현 − 전력비';
  $('pnlSummary').innerHTML = [
    stat('총 PnL', p.totalPnlKrw === null ? '<span class="muted">시세 없음</span>' : `<span class="${signCls(p.totalPnlKrw)} big-num">${krw(p.totalPnlKrw)}</span>${est(p.estimated)}`),
    stat('누적 채굴량', `${n(p.all.confirmed + p.all.backfill, 4)} ${sym}${p.all.pending > 0 ? ` <span class="muted small" title="풀에 아직 반영되지 않은 실시간 추정분">+ 추정 ${n(p.all.pending, 4)}</span>` : ''}`),
    stat('보유 / 매도', `${n(p.holdings, 4)} / ${n(p.soldQty, 4)} ${sym}`),
    stat('실현 손익', krw(p.realizedKrw)),
    stat('미실현 손익', p.unrealizedKrw === null ? '<span class="muted">시세 없음</span>' : krw(p.unrealizedKrw)),
    stat('누적 전력비', krw(p.all.energyCostKrw)),
  ].join('');
  const row = (name: string, v: AppState['pnl']['all']) =>
    `<tr><td>${name}</td><td>${n(v.mined, 4)} ${sym}</td><td>${krw(v.revenueKrw)}</td><td>${krw(v.energyCostKrw)}</td><td class="${signCls(v.netKrw)}">${krw(v.netKrw)}${est(v.estimated)}</td></tr>`;
  $('pnlTable').innerHTML = `<tr><th>기간</th><th>채굴량</th><th>매출(채굴 시점)</th><th>전력비</th><th>순익</th></tr>${row('오늘', p.today)}${row('이번 달', p.month)}${row('최근 7일', p.d7)}${row('최근 30일', p.d30)}${row('전체', p.all)}`;
  const ro = readOnlyRemote(st);
  const boot = $<HTMLButtonElement>('openBootstrap');
  boot.hidden = !canBootstrap(p);
  boot.textContent = p.backfill ? '소급 다시 계산' : '소급 적용';
  for (const id of ['openSale', 'openBootstrap']) {
    $<HTMLButtonElement>(id).disabled = ro;
    $(id).title = ro ? RO_WHY : '';
  }
  $<HTMLButtonElement>('pnlExport').disabled = !!st.remote;
  $<HTMLButtonElement>('pnlFolder').disabled = !!st.remote;
  $('pnlFolder').title = st.remote ? '원격 연결 중에는 이 PC 로 돌아와 여세요' : '';
  $('pnlExport').title = st.remote ? '원격 연결 중에는 이 PC 로 돌아와 내보내세요' : '';
  $('saleSym').textContent = p.symbol;

  const pr = st.settings.profit;
  const pf = st.profit;
  $('profitSub').textContent = `${pf.symbol} · 추정 = 실측 해시레이트 × 풀 통계, 확정 = 풀 누적(잔액+지급)`;
  $('profit').innerHTML = renderProfit(pf, p);
  $('profitErr').textContent = pf.error ?? '';
  const vastCell = (r: AppState['profit']['compare'][number]) => {
    const v = r.vast;
    const meta = v ? `<div class="muted small">${v.status === 'ok' ? `하위 25% $${esc(v.p25?.toFixed(3))} · ` : ''}표본 ${esc(v.n)}/${esc(v.total)} · ${new Date(v.at).toLocaleTimeString('ko-KR')}</div>` : '';
    if (r.rentalSource === 'manual') return `$${esc(r.rentalUsd?.toFixed(3))}/h <span class="muted small">수동</span>${meta}`;
    if (!v) return '<span class="muted">조회 전</span>';
    if (v.status === 'insufficient') return `<span class="warn">데이터 부족</span>${meta}`;
    return `$${esc(v.median?.toFixed(3))}/h <span class="muted small">Vast 중앙값</span>${meta}`;
  };
  const filterText = `${pr.vastVerifiedOnly ? '인증 매물만' : '전체 매물'} · ${pr.vastType === 'interruptible' ? '중단 가능(입찰)' : '온디맨드'} · ${pr.vastRegions.trim() ? `지역 ${esc(pr.vastRegions)}` : '전체 지역'} · DLPerf 중앙값 80% 미만 제외`;
  $('compare').innerHTML = `<tr><th>GPU</th><th>채굴 순수익</th><th>대여 표시가</th><th>대여 순수익</th><th>판정</th></tr>${pf.compare
    .filter((r) => st.gpus.find((g) => g.id === r.id)?.present)
    .map((r) => {
      const verdict = r.miningKrwPerH !== null && r.rentalKrwPerH !== null ? (r.miningKrwPerH >= r.rentalKrwPerH ? '채굴 유리' : '대여 유리 → 재검토') : '-';
      return `<tr><td>${esc(r.label)}</td><td>${krw(r.miningKrwPerH)}/h</td>
        <td>${vastCell(r)}</td>
        <td>${krw(r.rentalKrwPerH)}/h</td><td class="${verdict.startsWith('대여') ? 'warn' : 'good'}">${verdict}</td></tr>`;
    })
    .join('')}<tr><td colspan="5" class="muted small">Vast 시세: ${filterText}. 가정: 호스트 몫 ${esc(Math.round(pr.vastHostShare * 100))}%, 임대 중 ${esc(pr.rentalPowerW)}W, ${esc(pr.krwPerKwh)}원/kWh, ${esc(pr.krwPerUsd)}원/$. 비교·재검토 알림은 이 필터의 중앙값 기준입니다. 값은 설정 › 수익 계산·GPU 에서 바꿉니다.</td></tr>`;
}

$('openSale').addEventListener('click', () => openModal('saleModal'));
$('openBootstrap').addEventListener('click', () => openModal('bootstrapModal', fillBootstrap));
$('pnlExport').addEventListener('click', () => void crypthy.exportPnl().then((e) => e && e !== '취소됨' && msg('pnlMsg', e)));
$('pnlFolder').addEventListener('click', () => void crypthy.openPnlFolder());
$('appLogFolder').addEventListener('click', () => void crypthy.openPnlFolder());

function fillBootstrap() {
  const p = state!.pnl;
  if (!canBootstrap(p)) return;
  const b = p.backfill;
  $('bootstrapInfo').textContent = b
    ? `앱 기록 전 채굴분 ${n(b.qty, 4)} ${p.symbol} 를 ${b.auto ? '자동 추정한' : '입력한'} 시작 ${new Date(b.from).toLocaleString('ko-KR')} · ${n(b.watts)}W 로 소급했습니다(추정). 시작 시각·전력을 고쳐 다시 계산할 수 있습니다.`
    : `앱 기록 전 채굴분 ${n(p.trackStart!.total, 4)} ${p.symbol} 를 채굴 시작~${new Date(p.trackStart!.at).toLocaleString('ko-KR')} 에 시간 비율로 나누고, 전력비는 W×시간으로 추정합니다 (모두 "추정" 표시). 해시레이트·풀 통계가 잡히면 자동으로 적용합니다.`;
  $('bootstrapSubmit').textContent = b ? '다시 계산' : '소급 적용';
  const from = $<HTMLInputElement>('bootstrapFrom');
  const w = $<HTMLInputElement>('bootstrapWatts');
  if (b) {
    from.value = new Date(b.from - new Date(b.from).getTimezoneOffset() * 60_000).toISOString().slice(0, 16);
    w.value = String(Math.round(b.watts));
  } else {
    from.value = '';
    w.value = String(p.currentWatts || '');
  }
}

onSubmit('saleForm', () => {
  if (!validateForm($<HTMLFormElement>('saleForm'))) return;
  const v = (id: string) => $<HTMLInputElement>(id).value.trim();
  void crypthy.addSale({ qty: Number(v('saleQty')), proceedsKrw: Number(v('saleProceeds')), feeKrw: Number(v('saleFee') || 0), venue: v('saleVenue'), note: v('saleNote') }).then((err) => {
    if (err) return msg('saleMsg', err);
    $<HTMLFormElement>('saleForm').reset();
    closeModal('saleModal', true);
    toast('기록했습니다');
    void refresh();
    void refreshSpark();
  });
});
onSubmit('bootstrapForm', () => {
  if (!validateForm($<HTMLFormElement>('bootstrapForm'))) return;
  const from = new Date($<HTMLInputElement>('bootstrapFrom').value).getTime();
  const watts = Number($<HTMLInputElement>('bootstrapWatts').value);
  if (!confirm('앱 기록 전 채굴분을 추정값으로 소급합니다. 이미 소급한 값은 새 값으로 바뀝니다. 진행할까요?')) return;
  void crypthy.bootstrapPnl(from, watts).then((err) => {
    if (err) return msg('bootstrapMsg', err);
    closeModal('bootstrapModal', true);
    toast('소급 적용했습니다');
    void refresh();
  });
});

// ---------- 매도·현금화 ----------

const AS_STATUS: Record<string, string> = { sold: '매도', partial: '일부 매도', nothing: '안 팔림', skipped: '건너뜀', error: '오류', planned: '계획(모의)' };
/** 오류 문장에 맞는 확인할 점 */
const keyHint = (reason: string) =>
  /Cloudflare/i.test(reason)
    ? 'SafeTrade 가 이 PC 의 요청을 막았습니다. 잠시 뒤 다시 시도하고, 계속되면 데스크톱 앱에서 실행하세요'
    : /record\.not_found|401|signature|unauthorized/i.test(reason)
      ? 'API 키를 찾을 수 없거나 서명이 맞지 않습니다. 키·시크릿을 다시 넣거나 SafeTrade 에서 키가 살아 있는지 확인하세요'
      : /403|IP|forbidden/i.test(reason)
        ? '키의 IP 제한이나 권한(거래)을 SafeTrade 에서 확인하세요'
        : 'API 키와 SafeTrade 상태를 확인하세요';
/** 인증 실패·IP 차단·Cloudflare 차단처럼 키·접속 확인이 필요한 오류 */
const KEY_TROUBLE = /401|403|인증|키|key|signature|Cloudflare|IP|record\.not_found|forbidden|unauthorized/i;

function renderAutoSell(st: AppState) {
  const a = st.autoSell;
  const c = st.settings.autoSell;
  const canWrite = !readOnlyRemote(st);
  const mode = !c.enabled ? '<span class="muted">꺼짐</span>' : c.dryRun ? '<span class="warn">켜짐 · 모의 실행</span>' : '<span class="good">켜짐 · 실제 매도</span>';
  const bal = a.balance ? `${n(a.balance.prl, 4)} PRL · ${n(a.balance.usdt, 2)} USDT <span class="muted small">${new Date(a.balance.at).toLocaleString('ko-KR')}</span>` : '<span class="muted">아직 조회 안 함</span>';
  const l = a.last;
  $('asStatus').innerHTML = [
    stat('상태', `${mode}${a.running ? ' <span class="warn">진행 중…</span>' : ''}`),
    stat('다음 실행', a.nextRunAt ? new Date(a.nextRunAt).toLocaleString('ko-KR') : '-'),
    stat('오늘 판 양', `${n(a.todaySoldPrl, 4)} / ${n(c.dailyMaxPrl)} PRL`),
    stat('하한가 (마지막 실행)', l?.floorUsd !== null && l?.floorUsd !== undefined ? `$${n(l.floorUsd, 4)}` : c.floorUsd > 0 ? `최저가 $${n(c.floorUsd, 2)}` : '<span class="warn">최저가 미설정</span>'),
    stat('SafeTrade 잔고', bal),
    stat('API 키', a.keySet ? `저장됨 <span class="muted small">${esc(a.keyStore ?? '')}</span>` : '<span class="warn">없음</span>'),
  ].join('');
  const lastEl = $('asLast');
  lastEl.className = `small ${l && (l.status === 'error' || l.status === 'skipped') ? 'warn' : 'muted'}`;
  lastEl.textContent = l
    ? `마지막 실행 ${new Date(l.at).toLocaleString('ko-KR')}${l.dryRun ? ' (모의)' : ''}: ${AS_STATUS[l.status] ?? l.status}` +
      (l.plan ? ` · 계획 ${n(l.plan.amount, 4)} PRL @ $${n(l.plan.price, 4)}` : '') +
      (l.floorUsd !== null ? ` · 하한가 $${n(l.floorUsd, 4)}` : '') +
      (l.refUsd !== null ? ` · 기준가 $${n(l.refUsd, 4)}` : '') +
      (l.reason ? ` · ${l.reason}` : '')
    : '아직 실행한 적 없습니다. 먼저 "모의 실행"으로 계획을 확인하세요.';
  // 인증 실패·차단: 상태 카드 위에 오류와 "API 키 확인"
  const trouble = !!l && l.status === 'error' && KEY_TROUBLE.test(l.reason ?? '');
  $('asError').hidden = !trouble;
  if (trouble) $('asErrorText').textContent = `자동 매도 오류: ${l!.reason} — ${keyHint(l!.reason ?? '')}`;
  $<HTMLButtonElement>('asErrorKey').disabled = !!st.remote;
  const rows = a.history.filter((r) => !r.dryRun || r === l).slice(0, 7);
  $('asHistory').innerHTML = rows.length
    ? `<tr><th>시각</th><th>결과</th><th>판 양</th><th>평균가</th><th>받은 USDT</th><th>수수료</th></tr>${rows
        .map((r) => `<tr><td>${new Date(r.at).toLocaleString('ko-KR')}${r.dryRun ? ' <span class="muted small">모의</span>' : ''}</td><td>${esc(AS_STATUS[r.status] ?? r.status)}</td><td>${n(r.soldPrl, 4)}</td><td>${r.soldPrl > 0 ? `$${n(r.proceedsUsdt / r.soldPrl, 4)}` : '-'}</td><td>${n(r.proceedsUsdt, 2)}</td><td>${n(r.feeUsdt, 4)}</td></tr>`)
        .join('')}`
    : '';
  const why = !canWrite ? RO_WHY : !a.keySet ? 'SafeTrade API 키가 없습니다 (API 키에서 입력)' : a.running ? '자동 매도가 진행 중입니다' : '';
  for (const id of ['asDryRun', 'asRealRun']) {
    $<HTMLButtonElement>(id).disabled = !!why;
    $(id).title = why;
  }
  $<HTMLButtonElement>('openAutoSell').disabled = !canWrite;
  $('openAutoSell').title = canWrite ? '' : RO_WHY;
  $<HTMLButtonElement>('openCashout').disabled = !canWrite;
  $('openCashout').title = canWrite ? '' : RO_WHY;
  // 키는 이 PC 에서만 넣는다 (원격 호스트의 키는 그 호스트에서 install.sh --safetrade-key)
  $('keyState').textContent = a.keySet ? `· 저장됨 (${a.keyStore ?? ''})` : '· 없음';
  for (const id of ['exKey', 'exSecret', 'exKeyClear', 'exKeySave']) ($(id) as HTMLInputElement).disabled = !!st.remote;
  $('keyHelp').textContent = st.remote
    ? '원격 호스트에 연결 중입니다. 호스트의 키는 그 호스트에서 install.sh --safetrade-key 로 넣습니다 (키는 원격 API 로 오가지 않습니다).'
    : '키는 이 PC 의 OS 보안 저장소로 암호화해 저장하고, 화면·원격 화면·로그·상태 API 로 내보내지 않습니다. 저장한 값은 다시 보여 주지 않습니다. 헤드리스(Ubuntu)는 install.sh --safetrade-key 파일 (root 0600, systemd LoadCredential) 로 넣습니다.';

  const co = st.settings.cashout;
  $('cashoutSub').textContent = `측정일 ${co.measuredAt} · 수수료·최소 수량은 바뀔 수 있으니 거래소에서 다시 확인하세요`;
  const suggest = a.balance && a.balance.usdt >= co.withdrawSuggestUsdt ? ` <span class="warn">지금 SafeTrade USDT ${n(a.balance.usdt, 2)} — 이번 주 출금 권장</span>` : '';
  $('cashoutSteps').innerHTML = [
    `<b>Pearl 지갑 → SafeTrade</b> PEARL(PRL) 입금 (네트워크 Pearl, prl1… 주소). 수수료 0, 최소 ${esc(co.prlDepositMin)} PRL, ${esc(co.prlConfirmations)} 컨펌(약 30분). 지갑 송금은 직접 합니다.`,
    `<b>SafeTrade 에서 매도</b> PEARL/USDT (2026-10-18 에 PRL/USDT 에서 이름이 바뀜, 스프레드 약 0.5%). PEARL/USDC·PEARL/BTC 도 있습니다. 매도 수수료 ${esc(co.sellFeePct)}% (2026-10-19 실측). 자동 매도는 매일 이 단계만 합니다.`,
    `<b>SafeTrade → 바이낸스</b> USDT 출금 ${esc(co.withdrawNetwork)} (수수료 ${esc(co.withdrawFeeUsdt)} USDT 고정, 최소 ${esc(co.withdrawMinUsdt)} USDT). TRON 도 됩니다. 고정 수수료라 <b>매도는 매일, 출금은 주 1회</b> (잔고 ${esc(co.withdrawSuggestUsdt)} USDT 이상이면 일요일에 알림). 출금은 직접 합니다.${suggest}`,
    `<b>바이낸스 → 업비트·빗썸</b> 트래블룰에 따라 이체한 뒤 원화로 매도.`,
  ].map((t) => `<li>${t}</li>`).join('');
}

function fillSubForm(id: string, obj: object) {
  for (const el of formFields($<HTMLFormElement>(id))) {
    const v = (obj as Record<string, unknown>)[el.name];
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v ?? '');
  }
}

function readSubForm<T extends object>(id: string, base: T): T {
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const el of formFields($<HTMLFormElement>(id))) out[el.name] = fieldValue(el);
  return out as T;
}

$('openAutoSell').addEventListener('click', () =>
  openModal('autoSellModal', () => {
    const st = state!;
    fillSubForm('autoSellForm', st.settings.autoSell);
    // 원격 화면에서는 켜기·모의 실행·시각만 바꾼다 (하한가·한도는 키가 있는 호스트에서)
    for (const el of formFields($<HTMLFormElement>('autoSellForm'))) {
      const hostOnly = !!st.remote && !['enabled', 'dryRun', 'time'].includes(el.name);
      el.disabled = hostOnly;
      el.title = hostOnly ? '하한가·한도는 원격 호스트에서만 바꿀 수 있습니다' : '';
    }
    $('asRemoteNote').textContent = st.remote ? '원격: 켜기·모의 실행·시각만 바꿀 수 있습니다' : '';
  }),
);
onSubmit('autoSellForm', () => {
  if (!validateForm($<HTMLFormElement>('autoSellForm'))) {
    // 접힌 고급 항목에 틀린 값이 있으면 펼쳐서 보여 준다
    const adv = $('autoSellForm').querySelector<HTMLDetailsElement>('details.adv');
    if (adv?.querySelector('.invalid')) adv.open = true;
    return msg('asSaveMsg', '틀린 값을 고쳐 주세요');
  }
  void crypthy.saveSettings({ autoSell: readSubForm('autoSellForm', state!.settings.autoSell) }).then((err) => {
    if (err) return msg('asSaveMsg', err === '취소됨' ? '저장하지 않았습니다' : err);
    closeModal('autoSellModal', true);
    toast('자동 매도 설정을 저장했습니다');
    void refresh();
  });
});
$('openCashout').addEventListener('click', () => openModal('cashoutModal', () => fillSubForm('cashoutForm', state!.settings.cashout)));
onSubmit('cashoutForm', () => {
  if (!validateForm($<HTMLFormElement>('cashoutForm'))) return msg('cashoutMsg', '틀린 값을 고쳐 주세요');
  void crypthy.saveSettings({ cashout: readSubForm('cashoutForm', state!.settings.cashout) }).then((err) => {
    if (err) return msg('cashoutMsg', err);
    closeModal('cashoutModal', true);
    toast('현금화 경로 메모를 저장했습니다');
    void refresh();
  });
});
const openKey = () =>
  openModal('keyModal', () => {
    // 저장한 값은 다시 보여 주지 않는다: 열 때마다 빈 칸
    $<HTMLInputElement>('exKey').value = '';
    $<HTMLInputElement>('exSecret').value = '';
    $('keyMsg').textContent = '';
  });
$('openKey').addEventListener('click', openKey);
$('keyModal').addEventListener('close', () => {
  $<HTMLInputElement>('exKey').value = '';
  $<HTMLInputElement>('exSecret').value = '';
});
$('asErrorKey').addEventListener('click', openKey);
onSubmit('keyForm', () => {
  const key = $<HTMLInputElement>('exKey');
  const secret = $<HTMLInputElement>('exSecret');
  void crypthy.setExchangeKey(key.value, secret.value).then((err) => {
    key.value = '';
    secret.value = '';
    if (err) return msg('keyMsg', err);
    closeModal('keyModal', true);
    toast('키를 저장했습니다 (OS 보안 저장소)');
    void refresh();
  });
});
$('exKeyClear').addEventListener('click', () => {
  if (!confirm('저장한 SafeTrade API 키를 이 PC 에서 지울까요? (SafeTrade 에서도 키를 삭제하는 것이 안전합니다)')) return;
  void crypthy.setExchangeKey('', '').then((err) => {
    if (err) return msg('keyMsg', err);
    closeModal('keyModal', true);
    toast('키를 지웠습니다');
    void refresh();
  });
});
$('asDryRun').addEventListener('click', () => void act('asMsg', () => crypthy.runAutoSell(true), '모의 실행 완료 (아래 계획 확인)'));
$('asRealRun').addEventListener('click', () => void act('asMsg', () => crypthy.runAutoSell(false), '실행 완료'));

// ---------- 채굴기 탭 ----------

/** 켜기·끄기 안내 줄 (버튼은 HUD) */
function renderControl(st: AppState) {
  const m = st.miner;
  const sel = m.gpuSelection;
  const selEl = $('gpuSelInfo');
  selEl.hidden = !sel || !m.running;
  if (sel) {
    selEl.className = `small ${sel.applied ? 'muted' : 'warn'}`;
    selEl.textContent = sel.applied ? `카드 선택 적용: ${sel.via}` : `카드 선택을 적용할 수 없음 — 모든 카드로 채굴 중 (${sel.reason})`;
  }
  const c = m.control;
  const modeName = { none: '사용 안 함', task: 'Windows 예약 작업', systemd: 'systemd --user 유닛', direct: '실행 파일 직접 실행' }[c.mode] ?? c.mode;
  $('minerControlInfo').textContent =
    c.mode === 'none'
      ? '켜기·끄기 방식이 없습니다. "제어 방식 설정"에서 방식(예약 작업·systemd 유닛·실행 파일)을 고르면 HUD 와 트레이에서 켜고 끌 수 있습니다.'
      : `켜기·끄기 방식: ${modeName}${c.mode === 'direct' ? ` (${st.settings.minerControl.exe || '실행 파일 미지정'})` : c.mode === 'task' ? ` (${st.settings.minerControl.taskName})` : c.mode === 'systemd' ? ` (${st.settings.minerControl.unit})` : ''} · ` +
        (c.starting
          ? '켜는 중… 채굴기가 감지되면 상태가 바뀝니다.'
          : m.running
            ? m.mode === 'external' ? '외부에서 실행한 채굴기가 돌고 있습니다. 끌 수는 있고, 켜기는 꺼진 뒤에 됩니다.' : '이 앱에서 켠 채굴기가 실행 중입니다.'
            : c.blocker ?? '꺼져 있습니다. HUD 의 "켜기"로 켭니다.');
  $('minerStats').innerHTML = [
    stat('감지된 채굴기', esc(m.processes.join(', ') || (m.apiOk ? '(API 응답)' : '없음'))),
    stat('통계 API', m.apiOk ? '연결' : '응답 없음', m.running && !m.apiOk ? 'warn' : ''),
    stat('풀', esc(m.pool ?? '-')),
    stat('지연', n(m.latencyMs, 0, ' ms')),
    stat('가동', dur(m.uptimeS)),
    stat('accepted / rejected', `${n(m.accepted)} / ${n(m.rejected)}`, (m.rejected ?? 0) > 0 ? 'warn' : ''),
    stat('총 해시', th(m.totalHashrate)),
  ].join('');
}

/** 실행 파일 방식인데 예전 예약 작업이 아직 켜져 있으면 끄기를 권한다 (로그온 때 채굴기가 콘솔 창과 함께 하나 더 뜰 수 있음) */
function renderTaskNotice(st: AppState) {
  const t = st.minerTask;
  const on = !!t && st.settings.minerControl.mode === 'direct' && t.status !== null && !/disabled|사용 안 함|無効|禁用|deaktiviert/i.test(t.status);
  const text = on ? `예약 작업 "${t!.name}" 이 아직 켜져 있습니다 (${t!.status}). 로그온할 때 채굴기를 콘솔 창과 함께 따로 띄울 수 있습니다.` : '';
  $('taskOnRow').hidden = !on || !!st.remote;
  $('taskOnText').textContent = text;
  $('taskStrip').hidden = !on || !!st.remote;
  $('taskStripText').textContent = text;
}

/** 채굴 창 보기: 채굴기 출력(logs/miner.log)의 끝부분을 2초마다 */
let minerLogTimer: ReturnType<typeof setInterval> | null = null;
async function refreshMinerLog() {
  const r = await crypthy.minerLog();
  const view = $('minerLogView');
  view.textContent = r.text
    ? r.text
    : r.available
      ? `아직 출력이 없습니다 (${r.path || 'logs/miner.log'}). 이 앱에서 켠 채굴기의 출력만 보입니다.`
      : '채굴기 출력은 "실행 파일 직접 실행" 방식으로 이 앱에서 켰을 때만 볼 수 있습니다 (원격 호스트 연결 중에는 볼 수 없음).';
  view.scrollTop = view.scrollHeight;
}
function stopMinerLog() {
  if (minerLogTimer) clearInterval(minerLogTimer);
  minerLogTimer = null;
  $('minerLogView').hidden = true;
  $('minerLogBtn').textContent = '채굴 창 보기';
}
$('minerLogBtn').addEventListener('click', () => {
  const opening = $('minerLogView').hidden;
  stopMinerLog();
  if (!opening) return;
  $('minerLogView').hidden = false;
  $('minerLogBtn').textContent = '채굴 창 닫기';
  void refreshMinerLog();
  minerLogTimer = setInterval(() => void refreshMinerLog(), 2000);
});

// ---------- 업데이트 ----------

function renderUpdate(st: AppState) {
  const u = st.update;
  const status: Record<typeof u.status, string> = {
    disabled: `v${st.appVersion}`,
    idle: `v${st.appVersion} · 최신`,
    checking: `v${st.appVersion} · 확인 중…`,
    available: `v${st.appVersion} · 새 버전 v${u.version}`,
    downloading: `v${st.appVersion} · v${u.version} 받는 중 ${u.progressPct ?? 0}%`,
    ready: `v${st.appVersion} · v${u.version} 설치 준비됨`,
    error: `v${st.appVersion} · 확인 실패`,
  };
  $('updateInfo').textContent = status[u.status];
  $('updateInfo').title = u.error ?? (u.checkedAt ? `마지막 확인 ${new Date(u.checkedAt).toLocaleString('ko-KR')} · ${u.intervalMin}분마다 확인` : '');
  const btn = $<HTMLButtonElement>('checkUpdateBtn');
  btn.disabled = u.status === 'disabled' || u.status === 'checking' || u.status === 'downloading';
  btn.title = u.status === 'disabled' ? '이 빌드는 자동 업데이트를 지원하지 않습니다 (설치형 Windows · Linux AppImage 만 지원)' : '지금 업데이트 확인';

  // 안내 배너: 새 버전 발견(받기/나중에) → 받는 중 → 받아 둠(재시작해 설치/나중에)
  const show = u.prompt !== null || u.status === 'downloading';
  $('updateBanner').hidden = !show;
  if (!show) return;
  const notes = $('updateNotes');
  notes.hidden = !u.notes;
  notes.textContent = u.notes ?? '';
  const primary = $<HTMLButtonElement>('updatePrimary');
  const later = $<HTMLButtonElement>('updateLater');
  if (u.status === 'downloading') {
    $('updateTitle').textContent = `v${u.version} 내려받는 중… ${u.progressPct ?? 0}%`;
    $('updateDetail').textContent = '다 받으면 재시작해 설치할지 다시 묻습니다.';
    primary.hidden = later.hidden = true;
  } else if (u.prompt === 'ready') {
    $('updateTitle').textContent = `v${u.version} 설치 준비됨`;
    $('updateDetail').textContent =
      '재시작하면 몇 초 뒤 새 버전으로 다시 열립니다. 채굴기는 앱과 따로 실행되므로 재시작해도 채굴은 계속됩니다 (재시작하는 동안 안전 감시만 잠시 멈춥니다).';
    primary.textContent = '지금 재시작해 설치';
    primary.hidden = later.hidden = false;
  } else {
    $('updateTitle').textContent = `새 버전 v${u.version} 이 있습니다 (현재 v${st.appVersion})`;
    $('updateDetail').textContent = '받기를 누르면 백그라운드로 내려받습니다. 설치는 다 받은 뒤 다시 묻습니다.';
    primary.textContent = '받기';
    primary.hidden = later.hidden = false;
  }
}

function flashUpdateBanner() {
  window.scrollTo({ top: 0, behavior: 'smooth' });
  const b = $('updateBanner');
  b.classList.remove('flash');
  void b.offsetWidth; // 애니메이션 다시 시작
  b.classList.add('flash');
}

$('checkUpdateBtn').addEventListener('click', () => void crypthy.checkUpdate().then(refresh));
$('updatePrimary').addEventListener('click', async () => {
  if (state?.update.prompt === 'ready') {
    const err = await crypthy.installUpdate();
    if (err) $('updateDetail').textContent = err;
  } else {
    await crypthy.downloadUpdate();
  }
  await refresh();
});
$('updateLater').addEventListener('click', () => void crypthy.dismissUpdate().then(refresh));
crypthy.onFocusUpdate(flashUpdateBanner);

// ---------- 폼 공통: 값 읽기·검증·바뀐 값 ----------

type Field = HTMLInputElement | HTMLSelectElement;
const formFields = (form: HTMLElement) => Array.from(form.querySelectorAll<Field>('input[name], select[name]'));
const fieldValue = (el: Field) => (el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el instanceof HTMLInputElement && el.type === 'number' ? Number(el.value) : el.value.trim());

/** 폼 안 모든 입력의 현재 값 (바뀐 값 확인용) */
const snapshot = (root: HTMLElement) =>
  JSON.stringify(Array.from(root.querySelectorAll<Field>('input, select')).map((el) => (el instanceof HTMLInputElement && el.type === 'checkbox' ? el.checked : el.value)));

/** 칸 아래에 오류 문구, 하나라도 틀리면 false */
function validateForm(form: HTMLElement): boolean {
  let ok = true;
  for (const el of Array.from(form.querySelectorAll<Field>('input, select'))) {
    if (el.disabled) continue;
    let err = el.checkValidity() ? '' : validationText(el);
    const lt = el.dataset.lt && form.querySelector<HTMLInputElement>(`[name="${el.dataset.lt}"]`);
    if (!err && lt && Number(el.value) >= Number(lt.value)) err = '정지 온도보다 낮아야 합니다';
    const holder = el.closest('.field, td') ?? el.parentElement!;
    let box = holder.querySelector<HTMLElement>(':scope > .err-text');
    if (err && !box) {
      box = document.createElement('span');
      box.className = 'err-text';
      holder.append(box);
    }
    if (box) box.textContent = err;
    el.classList.toggle('invalid', !!err);
    if (err) ok = false;
  }
  return ok;
}
function validationText(el: Field): string {
  const v = el.validity;
  if (v.valueMissing) return '값을 입력하세요';
  if (el instanceof HTMLInputElement) {
    if (v.rangeUnderflow) return `${el.min} 이상이어야 합니다`;
    if (v.rangeOverflow) return `${el.max} 이하여야 합니다`;
    if (v.stepMismatch) return el.step === '1' ? '정수여야 합니다' : '단위가 맞지 않습니다';
    if (v.badInput) return '숫자를 입력하세요';
    if (v.patternMismatch) return '형식이 올바르지 않습니다';
  }
  return el.validationMessage || '값이 올바르지 않습니다';
}

/** 모드 선택(select.seg)을 세그먼트 버튼으로 (값은 select 에 그대로 두어 읽기·채우기는 바뀌지 않는다) */
function segmentize(root: ParentNode) {
  root.querySelectorAll<HTMLSelectElement>('select.seg').forEach((sel) => {
    const bar = document.createElement('div');
    bar.className = 'segbar';
    for (const o of Array.from(sel.options)) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = o.textContent;
      b.dataset.value = o.value;
      b.addEventListener('click', () => {
        if (sel.disabled) return;
        sel.value = o.value;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
        sel.dispatchEvent(new Event('input', { bubbles: true }));
      });
      bar.append(b);
    }
    sel.hidden = true;
    sel.after(bar);
    const sync = () => bar.querySelectorAll<HTMLButtonElement>('button').forEach((b) => {
      b.classList.toggle('on', b.dataset.value === sel.value);
      b.disabled = sel.disabled;
    });
    sel.addEventListener('change', sync);
    (sel as HTMLSelectElement & { syncSeg?: () => void }).syncSeg = sync;
    sync();
  });
}
const syncSegs = (root: ParentNode) => root.querySelectorAll<HTMLSelectElement & { syncSeg?: () => void }>('select.seg').forEach((s) => s.syncSeg?.());

// ---------- 모달 ----------

/** 폼 제출(저장 버튼·Enter) — 화면 이동 없이 */
function onSubmit(formId: string, fn: () => void) {
  $(formId).addEventListener('submit', (e) => {
    e.preventDefault();
    fn();
  });
}

const modalSnap = new Map<string, string>();
function openModal(id: string, fill?: () => void) {
  const d = $<HTMLDialogElement>(id);
  fill?.();
  d.querySelectorAll('.err-text').forEach((e) => (e.textContent = ''));
  d.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
  d.querySelectorAll('.msg').forEach((e) => (e.textContent = ''));
  syncSegs(d);
  if (!d.open) d.showModal();
  modalSnap.set(id, snapshot(d));
  d.querySelector<HTMLElement>('input:not([disabled]):not([type=hidden]), select:not([disabled])')?.focus();
}
/** 입력한 값이 있으면 확인 후 닫기 */
function closeModal(id: string, force = false): boolean {
  const d = $<HTMLDialogElement>(id);
  if (!force && modalSnap.get(id) !== snapshot(d) && !confirm('입력한 내용을 버리고 닫을까요?')) return false;
  d.close();
  return true;
}
document.querySelectorAll<HTMLDialogElement>('dialog.modal').forEach((d) => {
  // Esc 는 keydown 에서 직접 처리한다 (브라우저의 cancel 은 반복되면 막을 수 없어 확인 없이 닫힐 수 있다)
  d.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    closeModal(d.id);
  });
  d.addEventListener('cancel', (e) => e.preventDefault());
  // 바깥(배경) 클릭으로 닫기
  d.addEventListener('mousedown', (e) => {
    if (e.target !== d) return;
    const r = d.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeModal(d.id);
  });
  d.querySelectorAll<HTMLElement>('[data-close]').forEach((b) => b.addEventListener('click', () => closeModal(d.id)));
  d.addEventListener('input', () => validateForm(d));
});

// ---------- 첫 실행 마법사 ----------

let wizardShown = false;
function maybeWizard(st: AppState) {
  if (wizardShown || st.ts === 0) return;
  wizardShown = true;
  if ((!st.setup.walletSet || !st.setup.poolSet) && !st.remote && store.get('crypthy.wizardLater') !== st.appVersion) openWizard();
}
function openWizard() {
  openModal('wizardModal', () => {
    const st = state!;
    $<HTMLInputElement>('wizWallet').value = st.settings.wallet;
    $<HTMLInputElement>('wizPool').value = st.settings.pool;
    const ro = readOnlyRemote(st);
    for (const id of ['wizWallet', 'wizPool', 'wizSave']) {
      $<HTMLInputElement>(id).disabled = ro;
      $(id).title = ro ? RO_WHY : '';
    }
    $<HTMLButtonElement>('wizBat').disabled = !!st.remote;
    $('wizBat').title = st.remote ? '원격 호스트에서는 bat 파일을 가져올 수 없습니다' : '';
  });
}
$('openWizard').addEventListener('click', openWizard);
$('wizardModal').addEventListener('close', () => {
  if (state && (!state.setup.walletSet || !state.setup.poolSet)) store.set('crypthy.wizardLater', state.appVersion);
});
$('wizSave').addEventListener('click', () =>
  void crypthy.saveSettings({ wallet: $<HTMLInputElement>('wizWallet').value.trim(), pool: $<HTMLInputElement>('wizPool').value.trim() }).then((err) => {
    msg('wizMsg', err, '저장됨');
    if (!err) modalSnap.set('wizardModal', snapshot($('wizardModal')));
    return refresh();
  }),
);
$('wizBat').addEventListener('click', () =>
  void crypthy.importBat().then((err) => {
    msg('wizMsg', err, 'bat 에서 가져왔습니다');
    return refresh().then(() => {
      $<HTMLInputElement>('wizWallet').value = state?.settings.wallet ?? '';
      $<HTMLInputElement>('wizPool').value = state?.settings.pool ?? '';
      modalSnap.set('wizardModal', snapshot($('wizardModal')));
    });
  }),
);

// ---------- 설정 시트 ----------

type Sec = 'miner' | 'gpu' | 'safety' | 'profit' | 'app' | 'remote' | 'hub';
const sheet = $<HTMLDialogElement>('settingsSheet');
const secForm = (s: string) => sheet.querySelector<HTMLFormElement>(`form.sec[data-sec="${s}"]`)!;
const SECS = Array.from(sheet.querySelectorAll<HTMLFormElement>('form.sec')).map((f) => f.dataset.sec as Sec);
/** 저장·취소를 하는 섹션 (원격 연결은 자체 연결 버튼, 코인·채굴기 목록은 읽기 전용) */
const SAVABLE: Sec[] = ['miner', 'gpu', 'safety', 'profit', 'app'];
const secSnap = new Map<Sec, string>();
let activeSec: Sec = 'miner';
/** 원격 화면에서 호스트에서만 바꾸는 항목 (원격 쓰기 토큰으로 임의 프로그램 실행·안전 정지 끄기 방지) */
const HOST_ONLY = /^(minerControl\.|safety|openAtLogin|loginShowWindow|autoStartMining|sharedLedgerDir)/;

const dirty = (s: Sec) => SAVABLE.includes(s) && secSnap.has(s) && secSnap.get(s) !== snapshot(secForm(s));

function fillSection(s: Sec) {
  const st = state!;
  const set = st.settings;
  const form = secForm(s);
  if (s === 'gpu') renderGpuTable(st);
  if (s === 'profit') {
    $<HTMLSelectElement>('coinSelect').innerHTML = st.coins
      .map((c) => `<option value="${esc(c.id)}" ${c.id === set.coin ? 'selected' : ''}>${esc(c.name)} (${esc(c.symbol)}) · ${esc(c.algorithm)}</option>`)
      .join('');
  }
  if (s === 'app') $('poolExamples').innerHTML = st.poolExamples.map((p) => `<option value="${esc(p)}"></option>`).join('');
  for (const el of formFields(form)) {
    const [a, b] = el.name.split('.');
    const v = b ? (set as unknown as Record<string, Record<string, unknown>>)[a]?.[b] : (set as unknown as Record<string, unknown>)[a];
    if (el instanceof HTMLInputElement && el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v ?? '');
  }
  applyLocks(s);
  if (s === 'miner') showControlFields();
  syncSegs(form);
  form.querySelectorAll('.err-text').forEach((e) => (e.textContent = ''));
  form.querySelectorAll('.invalid').forEach((e) => e.classList.remove('invalid'));
  secSnap.set(s, snapshot(form));
  markDirty();
}

/** 원격 읽기 전용이면 전부, 원격이면 호스트 전용 항목을 잠근다 */
function applyLocks(s: Sec) {
  const st = state!;
  if (s === 'remote') return;
  const ro = readOnlyRemote(st);
  const form = secForm(s);
  for (const el of Array.from(form.querySelectorAll<HTMLInputElement | HTMLSelectElement | HTMLButtonElement>('input, select, button'))) {
    const name = 'name' in el ? el.name : '';
    const hostOnly = !!st.remote && (HOST_ONLY.test(name) || !!el.dataset.pick || ['importTask', 'disableTask', 'powerRegister', 'powerApply', 'importBat', 'appLogFolder'].includes(el.id));
    const lock = ro || hostOnly;
    el.disabled = lock;
    el.title = ro ? RO_WHY : hostOnly ? '원격 호스트에서만 바꿀 수 있습니다' : '';
  }
  form.querySelectorAll<HTMLElement>('[data-theme-set]').forEach((b) => ((b as HTMLButtonElement).disabled = false));
}

function sheetNote(st: AppState) {
  $('settingsRO').textContent = readOnlyRemote(st) ? RO_WHY : st.remote ? '원격 호스트 설정 · 채굴기 실행 방식·안전·로그인 시 실행은 호스트에서만' : '';
}

function showSec(s: Sec) {
  activeSec = s;
  sheet.querySelectorAll<HTMLElement>('#settingsNav [data-sec]').forEach((b) => b.classList.toggle('on', b.dataset.sec === s));
  SECS.forEach((x) => (secForm(x).hidden = x !== s));
  $('settingsFoot').hidden = !SAVABLE.includes(s);
  $('settingsMsg').textContent = '';
  if (s === 'remote') void refreshRemoteSettings();
  if (s === 'hub') renderHub(state!);
  updateSaveButton();
}

function markDirty() {
  sheet.querySelectorAll<HTMLElement>('#settingsNav [data-sec]').forEach((b) => b.classList.toggle('dirty', dirty(b.dataset.sec as Sec)));
  updateSaveButton();
}
function updateSaveButton() {
  const ro = !!state && readOnlyRemote(state);
  const valid = SAVABLE.includes(activeSec) ? validateForm(secForm(activeSec)) : true;
  $<HTMLButtonElement>('secSave').disabled = ro || !valid || !dirty(activeSec);
  $<HTMLButtonElement>('secCancel').disabled = !dirty(activeSec);
}

function openSettings(s?: string) {
  if (!state) return;
  for (const x of SECS) if (!dirty(x)) fillSection(x);
  sheetNote(state);
  showSec((SECS as string[]).includes(s ?? '') ? (s as Sec) : activeSec);
  if (!sheet.open) sheet.showModal();
  sheet.querySelector<HTMLElement>('#settingsNav button.on')?.focus();
}

/** 저장하지 않은 변경이 있으면 확인 후 닫기 (취소하면 입력값은 그대로) */
function closeSettings(): boolean {
  const changed = SAVABLE.filter(dirty);
  if (changed.length && !confirm('저장하지 않은 변경이 있습니다. 버리고 닫을까요?')) return false;
  for (const s of changed) fillSection(s);
  sheet.close();
  return true;
}
sheet.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    e.preventDefault();
    closeSettings();
  } else if (e.key === 'Enter' && e.target instanceof HTMLInputElement && e.target.type !== 'checkbox' && SAVABLE.includes(activeSec)) {
    // 설정 칸에서 Enter = 그 섹션 저장
    e.preventDefault();
    if (!$<HTMLButtonElement>('secSave').disabled) void saveSection(activeSec);
  }
});
sheet.addEventListener('cancel', (e) => e.preventDefault());
sheet.addEventListener('mousedown', (e) => {
  if (e.target !== sheet) return;
  const r = sheet.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeSettings();
});
sheet.querySelector('[data-close]')!.addEventListener('click', () => closeSettings());
sheet.querySelectorAll<HTMLElement>('#settingsNav [data-sec]').forEach((b) => b.addEventListener('click', () => showSec(b.dataset.sec as Sec)));
sheet.addEventListener('input', () => markDirty());
sheet.addEventListener('change', () => markDirty());
$('secCancel').addEventListener('click', () => fillSection(activeSec));
$('secSave').addEventListener('click', () => void saveSection(activeSec));

/** 섹션의 입력만 패치로 (묶음 설정은 지금 값 위에 덮어 다른 섹션 값은 그대로) */
function sectionPatch(s: Sec): Partial<Settings> {
  if (s === 'gpu') return { gpus: readGpuTable() };
  const set = state!.settings as unknown as Record<string, unknown>;
  const patch: Record<string, unknown> = {};
  for (const el of formFields(secForm(s))) {
    if (el.disabled) continue;
    const v = fieldValue(el);
    const [a, b] = el.name.split('.');
    if (b) patch[a] = { ...(set[a] as object), ...(patch[a] as object), [b]: v };
    else patch[a] = v;
  }
  return patch as Partial<Settings>;
}

async function saveSection(s: Sec): Promise<boolean> {
  if (!validateForm(secForm(s))) return false;
  const err = await crypthy.saveSettings(sectionPatch(s));
  if (err) {
    msg('settingsMsg', err === '취소됨' ? '저장하지 않았습니다' : err);
    return false;
  }
  await refresh();
  fillSection(s);
  msg('settingsMsg', null, s === 'gpu' ? '저장했습니다 (전력 제한은 "지금 적용")' : '저장했습니다');
  return true;
}

/** 설정의 켜기·끄기 방식에 맞는 입력칸만 보이기 */
function showControlFields() {
  const mode = $<HTMLSelectElement>('controlMode').value;
  secForm('miner').querySelectorAll<HTMLElement>('[data-ctl]').forEach((el) => {
    el.hidden = !(el.dataset.ctl ?? '').split(' ').includes(mode);
  });
  renderTaskNotice(state!);
}
$('controlMode').addEventListener('change', showControlFields);

function renderGpuTable(st: AppState) {
  const rows = st.settings.gpus.map((g) => {
    const v = st.gpus.find((x) => x.id === g.id);
    const range = v?.powerMinW && v.powerMaxW ? `${v.powerMinW}~${v.powerMaxW}` : '';
    return `<tr data-gpu="${esc(g.id)}">
      <td><input data-f="label" value="${esc(g.label)}" maxlength="40" required /></td>
      <td>${esc(v?.index ?? '-')}</td>
      <td><code>${esc(g.id)}</code></td>
      <td><span class="unit"><input data-f="powerLimitW" type="number" step="1" ${v?.powerMinW ? `min="${esc(v.powerMinW)}"` : ''} ${v?.powerMaxW ? `max="${esc(v.powerMaxW)}"` : ''} value="${esc(g.powerLimitW ?? '')}" placeholder="변경 안 함" /><i>W</i></span> <span class="muted small">${esc(range)}</span></td>
      <td><span class="unit"><input data-f="rentalUsdManual" type="number" step="any" min="0" value="${esc(g.rentalUsdManual)}" /><i>$/h</i></span></td>
      <td><span class="unit"><input data-f="reviewRentalUsd" type="number" step="any" min="0" value="${esc(g.reviewRentalUsd)}" /><i>$/h</i></span></td>
    </tr>`;
  });
  $('gpuTable').innerHTML = `<tr><th>이름</th><th>#</th><th>PCI bus id</th><th>전력 제한</th><th>대여가 수동 (0=Vast)</th><th>재검토 대여가 (0=끔)</th></tr>${rows.join('') || '<tr><td colspan="6" class="muted">인식된 GPU 없음</td></tr>'}`;
  const linux = st.platform === 'linux';
  $('powerRegister').textContent = linux ? '전력 제한 서비스 설치 (관리자 인증 1회)' : '전력 제한 예약 작업 등록 (UAC 1회)';
  $('powerTask').textContent = st.power.registered
    ? linux ? '전력 제한 서비스 설치됨: 부팅 시 자동 적용 (systemd crypthy-power-limit.service)' : '전력 제한 예약 작업 등록됨: 로그온 30초 뒤 자동 재적용'
    : linux ? '전력 제한 서비스 미설치: 설치 시 관리자 인증(pkexec) 창이 1회 뜹니다' : '전력 제한 예약 작업 미등록: 등록 시 Windows UAC 승인 창이 1회 뜹니다';
  $('powerLog').textContent = st.power.lastLog ?? '';
}

function readGpuTable(): GpuConfig[] {
  return state!.settings.gpus.map((g) => {
    const row = document.querySelector(`tr[data-gpu="${CSS.escape(g.id)}"]`);
    // 표에 아직 없는 GPU(표를 연 뒤 새로 인식) 는 그대로 둔다
    if (!row) return g;
    const f = (name: string) => row?.querySelector<HTMLInputElement>(`input[data-f="${name}"]`)?.value.trim() ?? '';
    return {
      ...g,
      label: f('label') || g.label,
      powerLimitW: f('powerLimitW') === '' ? null : Number(f('powerLimitW')),
      rentalUsdManual: Number(f('rentalUsdManual') || 0),
      reviewRentalUsd: Number(f('reviewRentalUsd') || 0),
    };
  });
}

/** 전력 제한 등록·적용은 GPU 표를 먼저 저장한다 (등록은 확인 후) */
async function powerAction(fn: () => Promise<string | null>, ok: string, ask?: string) {
  if (ask && !confirm(ask)) return;
  if (dirty('gpu') && !(await saveSection('gpu'))) return;
  msg('gpuMsg', null, '진행 중…');
  msg('gpuMsg', await fn(), ok);
  await refresh();
  fillSection('gpu');
}
$('powerRegister').addEventListener('click', () =>
  void powerAction(() => crypthy.registerPowerTask(), '등록·적용 완료', state?.platform === 'linux'
    ? '전력 제한 서비스를 설치합니다. 관리자 인증(pkexec) 창이 1회 뜹니다. 진행할까요?'
    : '전력 제한 예약 작업을 등록합니다. Windows UAC 승인 창이 1회 뜹니다. 진행할까요?'),
);
$('powerApply').addEventListener('click', () => void powerAction(() => crypthy.applyPowerLimits(), '적용 요청 완료 (아래 로그 확인)'));

$('importBat').addEventListener('click', () =>
  void crypthy.importBat().then(async (err) => {
    msg('walletMsg', err, 'bat 에서 가져왔습니다');
    await refresh();
    if (!err) fillSection('app');
  }),
);
$('importTask').addEventListener('click', () =>
  void crypthy.importMinerTask().then(async (err) => {
    msg('importTaskMsg', err, '실행 파일 방식으로 바꿨습니다 — 예약 작업은 아래에서 끄세요');
    await refresh();
    if (!err) fillSection('miner');
  }),
);
$('disableTask').addEventListener('click', () => void act('disableTaskMsg', () => crypthy.disableMinerTask(), '작업을 껐습니다'));
sheet.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) =>
  b.addEventListener('click', async () => {
    const input = sheet.querySelector<HTMLInputElement>(`[name="${b.dataset.for}"]`);
    if (!input) return;
    const picked = await crypthy.pickPath(b.dataset.pick === 'folder' ? 'folder' : 'exe', input.value.trim());
    if (picked) {
      input.value = picked;
      markDirty();
    }
  }),
);

// 원격 연결 (자체 연결 버튼)
async function refreshRemoteSettings() {
  const v = await crypthy.getRemote();
  const url = $<HTMLInputElement>('remoteUrl');
  if (document.activeElement !== url && !url.value) url.value = v.url.replace(/^https?:\/\//, '');
  $('remoteInfo').textContent = v.enabled
    ? `연결됨: ${v.url}. 토큰은 ${v.encrypted ? 'OS 보안 저장소로 암호화해 저장했습니다' : '이 사용자만 읽을 수 있는 파일에 읽기 토큰만 저장했습니다 (OS 보안 저장소를 쓸 수 없어 쓰기 토큰은 이번 실행 동안만 기억)'}. 토큰 칸을 비워 두면 저장된 값을 씁니다. 채굴 켜기·끄기 방식·안전 설정·로그인 시 실행은 호스트에서만 바꿀 수 있습니다.`
    : '연결 안 함 — 이 PC 의 상태를 보여 줍니다. 호스트에서 crypthy-headless --print-tokens 로 토큰을 확인하세요.';
}
$('remoteForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = (id: string) => $<HTMLInputElement>(id).value.trim();
  void act('remoteMsg', () => crypthy.connectRemote(v('remoteUrl'), v('remoteRead'), v('remoteWrite')), '연결됨').then(() => {
    $<HTMLInputElement>('remoteRead').value = '';
    $<HTMLInputElement>('remoteWrite').value = '';
    void refreshRemoteSettings();
    void refreshSpark();
    for (const s of SECS) if (!dirty(s)) fillSection(s);
  });
});
$('remoteOff').addEventListener('click', () =>
  void crypthy.disconnectRemote().then(async () => {
    await refresh();
    void refreshRemoteSettings();
    void refreshSpark();
    for (const s of SECS) if (!dirty(s)) fillSection(s);
  }),
);

// 코인·채굴기 목록 (읽기 전용)
const VENDOR_LABEL: Record<string, string> = { nvidia: 'NVIDIA', amd: 'AMD', intel: 'Intel' };
const REPO_KIND: Record<string, string> = { developer: '개발자 저장소', distribution: '배포처 저장소(개발자 미확인)', unverified: '미확인' };
let hubKey = '';
function feeText(r: AppState['hub']['recommendations'][number]) {
  const f = r.devFee;
  if (f.status === 'verified') return `${esc(f.pct)}%`;
  if (f.status === 'conflict') return `<span class="warn">출처 불일치</span>`;
  return '<span class="muted">미확인</span>';
}
function renderHub(st: AppState) {
  const h = st.hub;
  const key = JSON.stringify(h);
  if (key === hubKey) return;
  hubKey = key;
  $('hubSub').textContent = `카탈로그 확인일 ${h.checkedAt}`;
  $('hubInfo').textContent = `알고리즘 ${h.algorithm} · 이 PC 의 GPU: ${h.vendors.map((v) => VENDOR_LABEL[v]).join(', ') || '감지 안 됨(전체 표시)'}`;
  const link = (url: string | null, label: string) => (url ? `<a href="#" data-link="${esc(url)}">${esc(label)}</a>` : '');
  $('hubTable').innerHTML = `<tr><th>추천</th><th>채굴 툴</th><th>지원 GPU</th><th>dev fee</th><th>저장소</th><th>비고</th></tr>${h.recommendations
    .map(
      (r) => `<tr class="${r.compatible ? '' : 'muted'}">
        <td>${r.compatible ? `#${r.rank}` : '호환 안 됨'}</td>
        <td><b>${esc(r.name)}</b><div class="small muted">${esc(r.apiNote)}</div></td>
        <td>${r.vendors.map((v) => esc(VENDOR_LABEL[v])).join(', ')}</td>
        <td>${feeText(r)} ${r.devFee.source ? link(r.devFee.source, '출처') : ''}${r.devFee.note ? `<div class="small muted">${esc(r.devFee.note)}</div>` : ''}</td>
        <td>${r.repo ? link(r.repo, r.repo.replace('https://github.com/', '')) : '<span class="muted">링크 없음(미확인)</span>'}<div class="small muted">${esc(REPO_KIND[r.repoKind])}${r.repoNote ? ` · ${esc(r.repoNote)}` : ''}</div></td>
        <td class="small">${esc(r.note)}</td>
      </tr>`,
    )
    .join('')}<tr><td colspan="6" class="small muted">풀 안내: ${h.poolSources.map((u) => link(u, u.replace(/^https:\/\//, ''))).join(' · ')}</td></tr>`;
}
// 카탈로그·라이선스 링크만 기본 브라우저로 (main 에서도 허용 목록으로 다시 확인)
document.addEventListener('click', (e) => {
  const url = (e.target as HTMLElement).closest<HTMLElement>('[data-link]')?.dataset.link;
  if (!url) return;
  e.preventDefault();
  void crypthy.openLink(url);
});

// ---------- 테마 (화면별 편의 설정이라 localStorage 에만: dark → light → system) ----------

const THEMES = ['dark', 'light', 'system'] as const;
type Theme = (typeof THEMES)[number];
const readTheme = (): Theme => {
  const t = store.get('crypthy.theme');
  return THEMES.includes(t as Theme) ? (t as Theme) : 'dark';
};
function applyTheme(t: Theme) {
  document.documentElement.dataset.theme = t;
  store.set('crypthy.theme', t);
  document.querySelectorAll<HTMLElement>('[data-theme-set]').forEach((b) => b.classList.toggle('on', b.dataset.themeSet === t));
}
document.querySelectorAll<HTMLElement>('[data-theme-set]').forEach((b) => b.addEventListener('click', () => applyTheme(b.dataset.themeSet as Theme)));
applyTheme(readTheme());

// ---------- 그리기 ----------

function render(st: AppState) {
  state = st;
  $('updated').textContent = st.ts ? new Date(st.ts).toLocaleTimeString('ko-KR') : '';
  renderHud(st);
  renderUpdate(st);
  renderSetup(st);
  renderGpus(st);
  renderDash(st);
  renderPnl(st);
  renderAutoSell(st);
  renderControl(st);
  renderTaskNotice(st);
  $('alerts').innerHTML = st.alerts.length
    ? st.alerts.slice(0, 30).map((a) => `<li class="${esc(a.level)}"><time>${new Date(a.ts).toLocaleString('ko-KR')}</time> ${esc(a.message)}</li>`).join('')
    : '<li class="muted">알림 없음</li>';
  // 원격 대상이 바뀌면(연결·해제) 설정 시트의 바뀐 값은 다른 기기의 것이라 버리고 전부 다시 채운다
  const target = st.remote ? `${st.remote.url}|${st.remote.write}` : '';
  if (target !== lastTarget) {
    const hadDirty = SAVABLE.some(dirty);
    lastTarget = target;
    for (const s of SECS) if (secSnap.has(s)) fillSection(s);
    if (hadDirty) toast('연결 대상이 바뀌어 저장하지 않은 설정 변경을 버렸습니다', true);
  }
  // 설정 시트: 바뀐 값이 없는 섹션만 새 상태로 다시 채운다 (입력 중인 값은 건드리지 않음)
  if (sheet.open) {
    sheetNote(st);
    for (const s of SECS) if (!dirty(s) && !secForm(s).contains(document.activeElement)) fillSection(s);
  }
  maybeWizard(st);
}

async function refresh() {
  render(await crypthy.getState());
}

async function act(msgId: string, fn: () => Promise<string | null>, ok: string) {
  msg(msgId, null, '진행 중…');
  msg(msgId, await fn(), ok);
  await refresh();
}

async function refreshSpark() {
  renderSpark(await crypthy.getCharts());
}

segmentize(document);
showTab((TABS as readonly string[]).includes(store.get('crypthy.tab') ?? '') ? (store.get('crypthy.tab') as Tab) : 'dash');
crypthy.onState(render);
void refresh();
void refreshSpark();
setInterval(() => void refreshSpark(), 60_000);
