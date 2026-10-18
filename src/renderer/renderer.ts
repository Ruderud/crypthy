import type { Api, AppState, GpuConfig, GpuView, Settings } from '../shared/types';
import { createCharts } from './charts.js';

const crypthy = (window as unknown as { crypthy: Api }).crypthy;
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

const esc = (v: unknown) =>
  String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const n = (v: number | null | undefined, digits = 0, unit = '') =>
  v === null || v === undefined || !Number.isFinite(v) ? '-' : `${v.toLocaleString('ko-KR', { maximumFractionDigits: digits, minimumFractionDigits: digits })}${unit}`;
const th = (h: number | null | undefined) => (h ? `${(h / 1e12).toFixed(1)} TH/s` : '-');
const krw = (v: number | null | undefined) => (v === null || v === undefined ? '-' : `${Math.round(v).toLocaleString('ko-KR')}원`);
const dur = (s: number | null) => {
  if (s === null) return '-';
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}시간 ${m}분` : `${m}분`;
};
const stat = (k: string, v: string, cls = '') => `<div><dt>${esc(k)}</dt><dd class="${cls}">${v}</dd></div>`;

let state: AppState | null = null;
let filledSettings = '';

function msg(id: string, text: string | null, ok = '완료') {
  const el = $(id);
  el.textContent = text ?? ok;
  el.className = `msg ${text ? 'err' : 'ok'}`;
}

const editing = () => document.activeElement instanceof HTMLInputElement || document.activeElement instanceof HTMLSelectElement;

function tempClass(g: GpuView, s: Settings) {
  if (g.tempC === null) return '';
  return g.tempC >= s.safety.tempStopC ? 'crit' : g.tempC >= s.safety.tempWarnC ? 'warn' : 'good';
}

function renderSetup(st: AppState) {
  const s = st.setup;
  $('setupCard').hidden = s.walletSet && s.poolSet && s.apiConnected;
  const mark = (id: string, ok: boolean, okText = '완료', noText = '필요') => {
    const el = document.querySelector(`#${id} .state`)!;
    el.textContent = ok ? okText : noText;
    el.className = `state badge ${ok ? 'ok' : 'warn'}`;
  };
  mark('stepWallet', s.walletSet && s.poolSet, '완료', '선택');
  mark('stepApi', s.apiConnected, '연결됨', '응답 없음');
}

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

const signCls = (v: number | null) => (v === null ? '' : v < 0 ? 'crit' : 'good');

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
      stat('풀 누적 채굴량', `${n(p.lifetimeCoin, 4)} ${sym}`),
      stat('미지급 잔액 / 최근 지급', `${n(p.balanceCoin, 3)} / ${n(p.paidCoin, 3)} ${sym}`),
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

function renderPnl(st: AppState) {
  const p = st.pnl;
  const sym = esc(p.symbol);
  const est = (on: boolean) => (on ? ' <span class="warn small">추정</span>' : '');
  $('pnlSub').textContent = '매출 = 채굴 시점 시세, 미실현 = 보유량 × 현재가, 총 PnL = 실현 + 미실현 − 전력비';
  $('pnlSummary').innerHTML = [
    stat('총 PnL', p.totalPnlKrw === null ? '<span class="muted">시세 없음</span>' : `<span class="${signCls(p.totalPnlKrw)} big-num">${krw(p.totalPnlKrw)}</span>${est(p.estimated)}`),
    stat('누적 채굴량', `${n(p.all.mined, 4)} ${sym}`),
    stat('보유 / 매도', `${n(p.holdings, 4)} / ${n(p.soldQty, 4)} ${sym}`),
    stat('실현 손익', krw(p.realizedKrw)),
    stat('미실현 손익', p.unrealizedKrw === null ? '<span class="muted">시세 없음</span>' : krw(p.unrealizedKrw)),
    stat('누적 전력비', krw(p.all.energyCostKrw)),
  ].join('');
  const row = (name: string, v: AppState['pnl']['all']) =>
    `<tr><td>${name}</td><td>${n(v.mined, 4)} ${sym}</td><td>${krw(v.revenueKrw)}</td><td>${krw(v.energyCostKrw)}</td><td class="${signCls(v.netKrw)}">${krw(v.netKrw)}${est(v.estimated)}</td></tr>`;
  $('pnlTable').innerHTML = `<tr><th>기간</th><th>채굴량</th><th>매출(채굴 시점)</th><th>전력비</th><th>순익</th></tr>${row('오늘', p.today)}${row('이번 달', p.month)}${row('최근 7일', p.d7)}${row('최근 30일', p.d30)}${row('전체', p.all)}`;
  // 0.3.4 에서 적용해 떼어 내지 못한 소급분은 다시 계산할 수 없다
  const canBootstrap = p.trackStart !== null && !(p.bootstrapped && !p.backfill);
  $('bootstrapForm').hidden = !canBootstrap;
  if (canBootstrap) {
    const span = `채굴 시작~${new Date(p.trackStart!.at).toLocaleString('ko-KR')}`;
    const b = p.backfill;
    $('bootstrapInfo').textContent = b
      ? `앱 기록 전 채굴분 ${n(b.qty, 4)} ${p.symbol} 를 ${b.auto ? '자동 추정한' : '입력한'} 시작 ${new Date(b.from).toLocaleString('ko-KR')} · ${n(b.watts)}W 로 소급했습니다(추정). 시작 시각·전력을 고쳐 다시 계산할 수 있습니다.`
      : `앱 기록 전 채굴분 ${n(p.trackStart!.total, 4)} ${p.symbol} 를 ${span} 에 시간 비율로 나누고, 전력비는 W×시간으로 추정합니다 (모두 "추정" 표시). 해시레이트·풀 통계가 잡히면 자동으로 적용합니다.`;
    $('bootstrapSubmit').textContent = b ? '다시 계산' : '소급 적용';
    const from = $<HTMLInputElement>('bootstrapFrom');
    const w = $<HTMLInputElement>('bootstrapWatts');
    const key = b ? `${b.from}|${b.watts}` : '';
    // 적용된 값이 바뀌면(자동 소급 등) 입력칸도 맞춘다. 입력 중이면 건드리지 않는다
    if (from.dataset.applied !== key && document.activeElement !== from && document.activeElement !== w) {
      from.dataset.applied = key;
      if (b) {
        const d = new Date(b.from - new Date(b.from).getTimezoneOffset() * 60_000);
        from.value = d.toISOString().slice(0, 16);
        w.value = String(Math.round(b.watts));
      }
    }
    if (!w.value && document.activeElement !== w) w.value = String(p.currentWatts || '');
  }
}

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

function renderGpus(st: AppState) {
  $('gpus').innerHTML = st.gpus
    .filter((g) => g.present || g.hold)
    .map((g) => {
      const fanCls = g.fanPct === 0 && (g.powerW ?? 0) > st.settings.safety.fanStopPowerW ? 'crit' : '';
      return `<article class="card gpu ${g.hold ? 'excluded' : ''}">
        <h2>${esc(g.label)} <span class="muted small">nvidia-smi #${esc(g.index ?? '-')}</span>
          <span class="badge ${g.mining ? 'ok' : ''}">${g.mining ? '채굴 중' : g.present ? '대기' : '인식 안 됨'}</span></h2>
        <div class="big ${tempClass(g, st.settings)}">${n(g.tempC, 0, '°C')}</div>
        <dl class="stats">
          ${stat('팬', n(g.fanPct, 0, '%'), fanCls)}
          ${stat('전력 / 한도', `${n(g.powerW, 0)} / ${n(g.powerLimitW, 0, ' W')}`)}
          ${stat('사용률', n(g.utilPct, 0, '%'))}
          ${stat('해시레이트', th(g.hashrate))}
        </dl>
        ${g.hold ? `<div class="banner">안전 보류: ${esc(g.hold)} — 보류 중에는 채굴기가 다시 실행되면 정지합니다 <button data-clear="${esc(g.id)}">원인 해결 · 보류 해제</button></div>` : ''}
      </article>`;
    })
    .join('');
}

function renderGpuTable(st: AppState) {
  const rows = st.settings.gpus.map((g) => {
    const v = st.gpus.find((x) => x.id === g.id);
    const range = v?.powerMinW && v.powerMaxW ? `${v.powerMinW}~${v.powerMaxW}` : '';
    return `<tr data-gpu="${esc(g.id)}">
      <td><input data-f="label" value="${esc(g.label)}" maxlength="40" /></td>
      <td>${esc(v?.index ?? '-')}</td>
      <td><code>${esc(g.id)}</code></td>
      <td><input data-f="powerLimitW" type="number" step="5" value="${esc(g.powerLimitW ?? '')}" placeholder="변경 안 함" /> <span class="muted small">${esc(range)}</span></td>
      <td><input data-f="rentalUsdManual" type="number" step="0.01" value="${esc(g.rentalUsdManual)}" /></td>
      <td><input data-f="reviewRentalUsd" type="number" step="0.01" value="${esc(g.reviewRentalUsd)}" /></td>
    </tr>`;
  });
  $('gpuTable').innerHTML = `<tr><th>이름</th><th>nvidia-smi #</th><th>PCI bus id</th><th>전력 제한(W)</th><th>대여가 수동($/h, 0=Vast)</th><th>재검토 대여가($/h, 0=끔)</th></tr>${rows.join('') || '<tr><td colspan="6" class="muted">인식된 GPU 없음</td></tr>'}`;
}

/** 켜기·끄기: 상태에 따라 하나만 활성. 막는 이유는 툴팁과 안내 줄로 */
function renderControl(m: AppState['miner']) {
  const c = m.control;
  const start = $<HTMLButtonElement>('minerStart');
  const stop = $<HTMLButtonElement>('minerStop');
  start.disabled = !c.canStart;
  stop.disabled = !c.canStop;
  start.title = c.blocker ?? (c.consented ? '채굴 켜기' : '처음 켤 때 위험·비용 고지에 동의합니다');
  stop.title = m.running ? '채굴 끄기 (정지 명령 + 채굴기 프로세스 정지)' : '실행 중인 채굴기가 없습니다';
  $('minerControlInfo').textContent =
    c.mode === 'none'
      ? '설정 → 채굴 켜기·끄기에서 방식(예약 작업·systemd 유닛·실행 파일)을 고르면 여기와 트레이에서 켜고 끌 수 있습니다.'
      : c.starting
        ? '켜는 중… 채굴기가 감지되면 상태가 바뀝니다.'
        : m.running
          ? m.mode === 'external' ? '외부에서 실행한 채굴기가 돌고 있습니다. 끌 수는 있고, 켜기는 꺼진 뒤에 됩니다.' : '이 앱에서 켠 채굴기가 실행 중입니다.'
          : c.blocker ?? '';
}

/** 설정의 켜기·끄기 방식에 맞는 입력칸만 보이기 */
function showControlFields() {
  const mode = $<HTMLSelectElement>('controlMode').value;
  document.querySelectorAll<HTMLElement>('[data-ctl]').forEach((el) => {
    el.hidden = !(el.dataset.ctl ?? '').split(' ').includes(mode);
  });
}

function render(st: AppState) {
  state = st;
  const m = st.miner;
  $('mock').hidden = !st.mock;
  const badge = $('minerBadge');
  badge.textContent = m.running ? `채굴기 실행 중${m.mode === 'external' ? '(외부 실행)' : ''}${m.processes.length ? ` · ${m.processes.join(', ')}` : ''}` : '채굴기 없음';
  renderControl(m);
  badge.className = `badge ${m.running ? 'ok' : ''}`;
  $('updated').textContent = new Date(st.ts).toLocaleTimeString('ko-KR');

  renderUpdate(st);

  renderHub(st);
  renderPnl(st);
  renderSetup(st);

  $('minerStats').innerHTML = [
    stat('감지된 채굴기', esc(m.processes.join(', ') || (m.apiOk ? '(API 응답)' : '없음'))),
    stat('통계 API', m.apiOk ? '연결' : '응답 없음', m.running && !m.apiOk ? 'warn' : ''),
    stat('풀', esc(m.pool ?? '-')),
    stat('지연', n(m.latencyMs, 0, ' ms')),
    stat('가동', dur(m.uptimeS)),
    stat('accepted / rejected', `${n(m.accepted)} / ${n(m.rejected)}`, (m.rejected ?? 0) > 0 ? 'warn' : ''),
    stat('총 해시', th(m.totalHashrate)),
  ].join('');

  renderGpus(st);

  $('alerts').innerHTML = st.alerts.length
    ? st.alerts.slice(0, 30).map((a) => `<li class="${a.level}"><time>${new Date(a.ts).toLocaleString('ko-KR')}</time> ${esc(a.message)}</li>`).join('')
    : '<li class="muted">알림 없음</li>';

  const p = st.profit;
  $('profitSub').textContent = `${p.symbol} · 추정 = 실측 해시레이트 × 풀 통계, 확정 = 풀 누적(잔액+지급)`;
  $('profit').innerHTML = renderProfit(p, st.pnl);
  $('profitErr').textContent = p.error ?? '';

  const pr = st.settings.profit;
  const vastCell = (r: AppState['profit']['compare'][number]) => {
    const v = r.vast;
    const meta = v ? `<div class="muted small">${v.status === 'ok' ? `하위 25% $${esc(v.p25?.toFixed(3))} · ` : ''}표본 ${esc(v.n)}/${esc(v.total)} · ${new Date(v.at).toLocaleTimeString('ko-KR')}</div>` : '';
    if (r.rentalSource === 'manual') return `$${esc(r.rentalUsd?.toFixed(3))}/h <span class="muted small">수동</span>${meta}`;
    if (!v) return '<span class="muted">조회 전</span>';
    if (v.status === 'insufficient') return `<span class="warn">데이터 부족</span>${meta}`;
    return `$${esc(v.median?.toFixed(3))}/h <span class="muted small">Vast 중앙값</span>${meta}`;
  };
  const filterText = `${pr.vastVerifiedOnly ? '인증 매물만' : '전체 매물'} · ${pr.vastType === 'interruptible' ? '중단 가능(입찰)' : '온디맨드'} · ${pr.vastRegions.trim() ? `지역 ${esc(pr.vastRegions)}` : '전체 지역'} · DLPerf 중앙값 80% 미만 제외`;
  $('compare').innerHTML = `<tr><th>GPU</th><th>채굴 순수익</th><th>대여 표시가</th><th>대여 순수익</th><th>판정</th></tr>${p.compare
    .filter((r) => st.gpus.find((g) => g.id === r.id)?.present)
    .map((r) => {
      const verdict = r.miningKrwPerH !== null && r.rentalKrwPerH !== null ? (r.miningKrwPerH >= r.rentalKrwPerH ? '채굴 유리' : '대여 유리 → 재검토') : '-';
      return `<tr><td>${esc(r.label)}</td><td>${krw(r.miningKrwPerH)}/h</td>
        <td>${vastCell(r)}</td>
        <td>${krw(r.rentalKrwPerH)}/h</td><td class="${verdict.startsWith('대여') ? 'warn' : 'good'}">${verdict}</td></tr>`;
    })
    .join('')}<tr><td colspan="5" class="muted small">Vast 시세: ${filterText}. 가정: 호스트 몫 ${esc(Math.round(pr.vastHostShare * 100))}%, 임대 중 ${esc(pr.rentalPowerW)}W, ${esc(pr.krwPerKwh)}원/kWh, ${esc(pr.krwPerUsd)}원/$. 비교·재검토 알림은 이 필터의 중앙값 기준입니다.</td></tr>`;

  const linux = st.platform === 'linux';
  $('powerRegister').textContent = linux ? '전력 제한 서비스 설치 (관리자 인증 1회)' : '전력 제한 예약 작업 등록 (UAC 1회)';
  $('powerTask').textContent = st.power.registered
    ? linux ? '전력 제한 서비스 설치됨: 부팅 시 자동 적용 (systemd crypthy-power-limit.service)' : '전력 제한 예약 작업 등록됨: 로그온 30초 뒤 자동 재적용'
    : linux ? '전력 제한 서비스 미설치: 설치 시 관리자 인증(pkexec) 창이 1회 뜹니다' : '전력 제한 예약 작업 미등록: 등록 시 Windows UAC 승인 창이 1회 뜹니다';
  $('powerLog').textContent = st.power.lastLog ?? '';

  // 메인 쪽에서 설정이 바뀌면(GPU 발견, 기준가 기록 등) 입력 중이 아닐 때만 폼을 다시 채운다
  const json = JSON.stringify(st.settings);
  if (json !== filledSettings && !editing()) fillForms(st);
}

function fillForms(st: AppState) {
  const s = st.settings;
  filledSettings = JSON.stringify(s);
  $<HTMLSelectElement>('hubCoin').innerHTML = st.coins
    .map((c) => `<option value="${esc(c.id)}" ${c.id === s.coin ? 'selected' : ''}>${esc(c.name)} (${esc(c.symbol)})</option>`)
    .join('');
  $<HTMLSelectElement>('coinSelect').innerHTML = st.coins
    .map((c) => `<option value="${esc(c.id)}" ${c.id === s.coin ? 'selected' : ''}>${esc(c.name)} (${esc(c.symbol)}) · ${esc(c.algorithm)}</option>`)
    .join('');
  $('poolExamples').innerHTML = st.poolExamples.map((p) => `<option value="${esc(p)}"></option>`).join('');
  $<HTMLInputElement>('wallet').value = s.wallet;
  $<HTMLInputElement>('pool').value = s.pool;
  renderGpuTable(st);

  const form = $<HTMLFormElement>('settingsForm');
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name) continue;
    const [a, b] = el.name.split('.');
    const v = b ? (s as unknown as Record<string, Record<string, unknown>>)[a][b] : (s as unknown as Record<string, unknown>)[a];
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v ?? '');
  }
  showControlFields();
}

function readSettingsForm(): Partial<Settings> {
  const s = state!.settings;
  const patch: Record<string, unknown> = { safety: { ...s.safety }, profit: { ...s.profit }, minerApi: { ...s.minerApi }, minerControl: { ...s.minerControl } };
  for (const el of Array.from($<HTMLFormElement>('settingsForm').elements) as HTMLInputElement[]) {
    if (!el.name) continue;
    const v = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Number(el.value) : el.value.trim();
    const [a, b] = el.name.split('.');
    if (b) (patch[a] as Record<string, unknown>)[b] = v;
    else patch[a] = v;
  }
  return patch as Partial<Settings>;
}

function readGpuTable(): GpuConfig[] {
  return state!.settings.gpus.map((g) => {
    const row = document.querySelector(`tr[data-gpu="${CSS.escape(g.id)}"]`);
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

async function refresh() {
  render(await crypthy.getState());
}

async function act(msgId: string, fn: () => Promise<string | null>, ok: string) {
  msg(msgId, null, '진행 중…');
  msg(msgId, await fn(), ok);
  filledSettings = '';
  await refresh();
}

$('hubCoin').addEventListener('change', (e) => {
  const coin = (e.target as HTMLSelectElement).value;
  void act('hubMsg', () => crypthy.saveSettings({ coin }), '코인 변경됨');
});
$('hubTable').addEventListener('click', (e) => {
  const url = (e.target as HTMLElement).closest<HTMLElement>('[data-link]')?.dataset.link;
  if (!url) return;
  e.preventDefault();
  void crypthy.openLink(url);
});

$('gpus').addEventListener('click', async (e) => {
  const id = (e.target as HTMLElement).dataset.clear;
  if (id && confirm('보류 원인(팬 막힘·과열 등)을 해결했나요? 해제해도 앱은 채굴기를 시작하지 않습니다.')) {
    await crypthy.clearHold(id);
    await refresh();
  }
});

$('saveWallet').addEventListener('click', () =>
  act('walletMsg', () => crypthy.saveSettings({ wallet: $<HTMLInputElement>('wallet').value.trim(), pool: $<HTMLInputElement>('pool').value.trim() }), '저장됨'),
);
$('importBat').addEventListener('click', () => act('walletMsg', () => crypthy.importBat(), 'bat에서 가져옴'));

$('saveGpus').addEventListener('click', () => act('gpuMsg', () => crypthy.saveSettings({ gpus: readGpuTable() }), '저장됨 (전력 제한은 "지금 적용")'));
$('powerRegister').addEventListener('click', async () => {
  const err = await crypthy.saveSettings({ gpus: readGpuTable() });
  if (err) return msg('gpuMsg', err);
  void act('gpuMsg', () => crypthy.registerPowerTask(), '등록·적용 완료');
});
$('powerApply').addEventListener('click', async () => {
  const err = await crypthy.saveSettings({ gpus: readGpuTable() });
  if (err) return msg('gpuMsg', err);
  void act('gpuMsg', () => crypthy.applyPowerLimits(), '적용 요청 완료 (아래 로그 확인)');
});

$('controlMode').addEventListener('change', showControlFields);
$('minerStart').addEventListener('click', () => void act('minerMsg', () => crypthy.startMining(), '켜기 요청함'));
$('minerStop').addEventListener('click', () => void act('minerMsg', () => crypthy.stopMining(), '껐습니다'));
$('importTask').addEventListener('click', () => void act('importTaskMsg', () => crypthy.importMinerTask(), '가져옴 (실행 파일·인자)'));
$('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  void act('settingsMsg', () => crypthy.saveSettings(readSettingsForm()), '저장됨');
});

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
$('saleForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const v = (id: string) => $<HTMLInputElement>(id).value.trim();
  void act('saleMsg', () => crypthy.addSale({ qty: Number(v('saleQty')), proceedsKrw: Number(v('saleProceeds')), feeKrw: Number(v('saleFee') || 0), venue: v('saleVenue'), note: v('saleNote') }), '기록됨').then(refreshCharts);
});
$('bootstrapForm').addEventListener('submit', (e) => {
  e.preventDefault();
  const from = new Date($<HTMLInputElement>('bootstrapFrom').value).getTime();
  const watts = Number($<HTMLInputElement>('bootstrapWatts').value);
  if (!confirm('앱 기록 전 채굴분을 추정값으로 소급합니다. 이미 소급한 값은 새 값으로 바뀝니다. 진행할까요?')) return;
  void act('bootstrapMsg', () => crypthy.bootstrapPnl(from, watts), '소급 적용됨').then(refreshCharts);
});
$('pnlExport').addEventListener('click', () => void crypthy.exportPnl());
$('pnlFolder').addEventListener('click', () => void crypthy.openPnlFolder());
$('updateLater').addEventListener('click', () => void crypthy.dismissUpdate().then(refresh));

// 테마: 화면별 편의 설정이라 localStorage 에만 둔다 (dark → light → system)
const THEMES = ['dark', 'light', 'system'] as const;
const THEME_LABEL = { dark: '다크', light: '라이트', system: '시스템' } as const;
function readTheme(): (typeof THEMES)[number] {
  try {
    const t = localStorage.getItem('crypthy.theme');
    return THEMES.includes(t as never) ? (t as (typeof THEMES)[number]) : 'dark';
  } catch {
    return 'dark';
  }
}
function applyTheme(t: (typeof THEMES)[number]) {
  document.documentElement.dataset.theme = t;
  $('themeBtn').textContent = THEME_LABEL[t];
  try {
    localStorage.setItem('crypthy.theme', t);
  } catch {
    // 저장이 막혀 있어도 현재 화면에는 적용
  }
}
applyTheme(readTheme());

const charts = createCharts({ gpu: $('gpuChart'), price: $('priceChart'), daily: $('dailyChart'), pnl: $('pnlChart'), legend: $('chartLegend') });
async function refreshCharts() {
  const v = await crypthy.getCharts();
  $('priceTitle').textContent = `${v.symbol} 시세 (USD, 30일)`;
  charts.render(v);
}
$('themeBtn').addEventListener('click', () => {
  applyTheme(THEMES[(THEMES.indexOf(readTheme()) + 1) % THEMES.length]);
  charts.applyTheme();
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => charts.applyTheme());
$('metricTabs').addEventListener('click', (e) => {
  const m = (e.target as HTMLElement).dataset.metric as 'hash' | 'temp' | 'power' | undefined;
  if (!m) return;
  document.querySelectorAll('#metricTabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.metric === m));
  charts.setMetric(m);
});
document.querySelector('footer')!.addEventListener('click', (e) => {
  const url = (e.target as HTMLElement).closest<HTMLElement>('[data-link]')?.dataset.link;
  if (!url) return;
  e.preventDefault();
  void crypthy.openLink(url);
});

// 시세·풀 데이터가 새로 들어오면(updatedAt 변경) 차트도 다시 받는다
let chartsAt: string | null = null;
crypthy.onState((st) => {
  render(st);
  // 시세·풀 갱신이나 PnL 변화(채굴 증가·소급·매도)가 있으면 차트를 다시 받는다
  // 실시간 추정분은 몇 초마다 바뀌므로 키에서 뺀다 (1분 주기 갱신으로 반영)
  const pb = st.pnl.backfill;
  const key = `${st.profit.updatedAt}|${(st.pnl.all.confirmed + st.pnl.all.backfill).toFixed(6)}|${pb ? `${pb.from}|${pb.watts}` : st.pnl.bootstrapped}|${st.pnl.soldQty}`;
  if (key !== chartsAt) {
    chartsAt = key;
    void refreshCharts();
  }
});
void refresh();
void refreshCharts();
setInterval(() => void refreshCharts(), 60_000);
