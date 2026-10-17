import type { Api, AppState, GpuConfig, GpuView, Settings } from '../shared/types';

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
const POOL_EXAMPLES = ['prl.kryptex.network:8048', 'prl-hk.kryptex.network:8048', 'prl-sg.kryptex.network:8048', 'prl-eu.kryptex.network:8048'];

let state: AppState | null = null;
let filledSettings = '';
let pickKey = '';

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
  const done = s.minerFound && s.walletSet && s.poolSet && s.gpusMapped && s.consented;
  $('setupCard').hidden = done;
  const mark = (id: string, ok: boolean) => {
    const el = document.querySelector(`#${id} .state`)!;
    el.textContent = ok ? '완료' : '필요';
    el.className = `state badge ${ok ? 'ok' : 'warn'}`;
  };
  mark('stepMiner', s.minerFound);
  mark('stepWallet', s.walletSet && s.poolSet);
  mark('stepMap', s.gpusMapped);
  mark('stepConsent', s.consented);
  $('minerDirView').textContent = st.settings.minerDir || '(미지정)';
}

function renderGpuPick(st: AppState) {
  const present = st.gpus.filter((g) => g.present);
  const key = present.map((g) => `${g.id}:${g.label}:${g.selected}`).join('|');
  if (key === pickKey || editing()) return;
  pickKey = key;
  $('gpuPick').innerHTML = present.length
    ? present.map((g) => `<label><input type="checkbox" data-pick="${esc(g.id)}" ${g.selected ? 'checked' : ''} /> ${esc(g.label)}</label>`).join('')
    : '<span class="muted">GPU 없음 (nvidia-smi 확인)</span>';
}

function renderGpus(st: AppState) {
  $('gpus').innerHTML = st.gpus
    .filter((g) => g.present || g.excluded)
    .map((g) => {
      const fanCls = g.fanPct === 0 && (g.powerW ?? 0) > st.settings.safety.fanStopPowerW ? 'crit' : '';
      return `<article class="card gpu ${g.excluded ? 'excluded' : ''}">
        <h2>${esc(g.label)} <span class="muted small">nvidia-smi #${esc(g.index ?? '-')} · SRBMiner ${esc(g.srbId ?? '미매핑')}</span>
          <span class="badge ${g.mining ? 'ok' : ''}">${g.mining ? '채굴 중' : g.present ? '대기' : '인식 안 됨'}</span></h2>
        <div class="big ${tempClass(g, st.settings)}">${n(g.tempC, 0, '°C')}</div>
        <dl class="stats">
          ${stat('팬', n(g.fanPct, 0, '%'), fanCls)}
          ${stat('전력 / 한도', `${n(g.powerW, 0)} / ${n(g.powerLimitW, 0, ' W')}`)}
          ${stat('사용률', n(g.utilPct, 0, '%'))}
          ${stat('해시레이트', th(g.hashrate))}
        </dl>
        ${g.excluded ? `<div class="banner">안전 제외: ${esc(g.excluded)} <button data-clear="${esc(g.id)}">원인 해결 · 재허용</button></div>` : ''}
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
      <td><input data-f="srbId" type="number" min="0" max="63" value="${esc(g.srbId ?? '')}" placeholder="미매핑" /></td>
      <td><input data-f="powerLimitW" type="number" step="5" value="${esc(g.powerLimitW ?? '')}" placeholder="변경 안 함" /> <span class="muted small">${esc(range)}</span></td>
      <td><input data-f="rentalUsdManual" type="number" step="0.01" value="${esc(g.rentalUsdManual)}" /></td>
      <td><input data-f="reviewRentalUsd" type="number" step="0.01" value="${esc(g.reviewRentalUsd)}" /></td>
    </tr>`;
  });
  $('gpuTable').innerHTML = `<tr><th>이름</th><th>nvidia-smi #</th><th>PCI bus id</th><th>SRBMiner id</th><th>전력 제한(W)</th><th>대여가 수동($/h, 0=Vast)</th><th>재검토 대여가($/h, 0=끔)</th></tr>${rows.join('') || '<tr><td colspan="7" class="muted">인식된 GPU 없음</td></tr>'}`;
}

function render(st: AppState) {
  state = st;
  const m = st.miner;
  $('mock').hidden = !st.mock;
  const badge = $('minerBadge');
  const modeLabel = { all: '전체 GPU', partial: '일부 GPU', external: '외부 실행' } as const;
  badge.textContent = m.running ? `채굴 중 · ${m.mode ? modeLabel[m.mode] : ''}` : '채굴 정지';
  badge.className = `badge ${m.running ? 'ok' : ''}`;
  $('updated').textContent = new Date(st.ts).toLocaleTimeString('ko-KR');

  renderSetup(st);
  const u = st.update;
  const updText: Record<typeof u.status, string> = {
    disabled: `v${st.appVersion}`,
    idle: `v${st.appVersion}`,
    checking: `v${st.appVersion} · 업데이트 확인 중`,
    downloading: `v${st.appVersion} · v${u.version ?? '?'} 내려받는 중 ${u.progressPct ?? 0}%`,
    ready: `v${st.appVersion} → v${u.version} 준비됨`,
    error: `v${st.appVersion} · 업데이트 확인 실패`,
  };
  $('updateInfo').textContent = updText[u.status];
  $('updateInfo').title = u.error ?? '';
  $('updateBtn').hidden = u.status !== 'ready';

  renderGpuPick(st);

  $('minerStats').innerHTML = [
    stat('풀', esc(m.pool ?? '-')),
    stat('지연', n(m.latencyMs, 0, ' ms')),
    stat('가동', dur(m.uptimeS)),
    stat('accepted / rejected', `${n(m.accepted)} / ${n(m.rejected)}`, (m.rejected ?? 0) > 0 ? 'warn' : ''),
    stat('총 해시', th(m.totalHashrate)),
    stat('--gpu-id', esc(m.gpuIds.join(',') || '-')),
    stat('SRBMiner API', m.apiOk ? '연결' : '응답 없음', m.running && !m.apiOk ? 'warn' : ''),
  ].join('');

  renderGpus(st);

  $('alerts').innerHTML = st.alerts.length
    ? st.alerts.slice(0, 30).map((a) => `<li class="${a.level}"><time>${new Date(a.ts).toLocaleString('ko-KR')}</time> ${esc(a.message)}</li>`).join('')
    : '<li class="muted">알림 없음</li>';

  const p = st.profit;
  $('profit').innerHTML = p.supported
    ? [
        stat('PRL 시세', p.prlUsd === null ? '-' : `$${p.prlUsd} <span class="${(p.prlChange24hPct ?? 0) < 0 ? 'crit' : 'good'} small">${n(p.prlChange24hPct, 1, '%')} 24h</span>`),
        stat('미지급 잔액', n(p.balancePrl, 3, ' PRL')),
        stat('최근 지급 합(최근 페이지)', n(p.paidPrl, 3, ' PRL')),
        stat('오늘 채굴 / 전력', `${n(p.todayPrl, 3, ' PRL')} / ${n(p.todayKwh, 2, ' kWh')}`),
        stat('오늘 순수익', krw(p.todayNetKrw), (p.todayNetKrw ?? 0) < 0 ? 'crit' : 'good'),
        stat('이번 달 채굴 / 전력', `${n(p.monthPrl, 3, ' PRL')} / ${n(p.monthKwh, 1, ' kWh')}`),
        stat('이번 달 순수익', krw(p.monthNetKrw), (p.monthNetKrw ?? 0) < 0 ? 'crit' : 'good'),
      ].join('')
    : stat('수익 조회', '현재는 Kryptex 풀(*.kryptex.network)만 지원합니다');
  $('profitErr').textContent = p.error ?? '';

  const pr = st.settings.profit;
  $('compare').innerHTML = `<tr><th>GPU</th><th>채굴 순수익</th><th>대여 표시가</th><th>대여 순수익</th><th>판정</th></tr>${p.compare
    .filter((r) => st.gpus.find((g) => g.id === r.id)?.present)
    .map((r) => {
      const verdict = r.miningKrwPerH !== null && r.rentalKrwPerH !== null ? (r.miningKrwPerH >= r.rentalKrwPerH ? '채굴 유리' : '대여 유리 → 재검토') : '-';
      return `<tr><td>${esc(r.label)}</td><td>${krw(r.miningKrwPerH)}/h</td>
        <td>${r.rentalUsd === null ? '-' : `$${r.rentalUsd.toFixed(3)}/h <span class="muted small">${r.rentalSource === 'manual' ? '수동' : 'Vast 중앙값'}</span>`}</td>
        <td>${krw(r.rentalKrwPerH)}/h</td><td class="${verdict.startsWith('대여') ? 'warn' : 'good'}">${verdict}</td></tr>`;
    })
    .join('')}<tr><td colspan="5" class="muted small">가정: 호스트 몫 ${Math.round(pr.vastHostShare * 100)}%, 임대 중 ${pr.rentalPowerW}W, ${pr.krwPerKwh}원/kWh, ${pr.krwPerUsd}원/$</td></tr>`;

  $('powerTask').textContent = st.power.registered
    ? '전력 제한 예약 작업 등록됨: 로그온 30초 뒤 자동 재적용'
    : '전력 제한 예약 작업 미등록: 등록 시 Windows UAC 승인 창이 1회 뜹니다';
  $('powerLog').textContent = st.power.lastLog ?? '';

  // 메인 쪽에서 설정이 바뀌면(GPU 발견, 매핑 학습, PRL 기준가 기록 등) 입력 중이 아닐 때만 폼을 다시 채운다
  const json = JSON.stringify(st.settings);
  if (json !== filledSettings && !editing()) fillForms(st.settings);
}

function fillForms(s: Settings) {
  filledSettings = JSON.stringify(s);
  $<HTMLSelectElement>('coin').innerHTML = [
    `<option value="pearl" ${s.coin === 'pearl' ? 'selected' : ''}>Pearl (PRL) · pearlhash</option>`,
    `<option value="quantus" disabled>Quantus (검증 전 · 비활성)</option>`,
  ].join('');
  $('poolExamples').innerHTML = POOL_EXAMPLES.map((p) => `<option value="${esc(p)}"></option>`).join('');
  $<HTMLInputElement>('wallet').value = s.wallet;
  $<HTMLInputElement>('pool').value = s.pool;
  renderGpuTable(state!);

  const form = $<HTMLFormElement>('settingsForm');
  for (const el of Array.from(form.elements) as HTMLInputElement[]) {
    if (!el.name) continue;
    const [a, b] = el.name.split('.');
    const v = b ? (s as unknown as Record<string, Record<string, unknown>>)[a][b] : (s as unknown as Record<string, unknown>)[a];
    if (el.type === 'checkbox') el.checked = Boolean(v);
    else el.value = String(v ?? '');
  }
}

function readSettingsForm(): Partial<Settings> {
  const s = state!.settings;
  const patch: Record<string, unknown> = { safety: { ...s.safety }, profit: { ...s.profit } };
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
    const optNum = (v: string) => (v === '' ? null : Number(v));
    return {
      ...g,
      label: f('label') || g.label,
      srbId: optNum(f('srbId')),
      powerLimitW: optNum(f('powerLimitW')),
      rentalUsdManual: Number(f('rentalUsdManual') || 0),
      reviewRentalUsd: Number(f('reviewRentalUsd') || 0),
    };
  });
}

const selection = () => Array.from(document.querySelectorAll<HTMLInputElement>('input[data-pick]:checked')).map((el) => el.dataset.pick!);

async function refresh() {
  render(await crypthy.getState());
}

async function act(msgId: string, fn: () => Promise<string | null>, ok: string) {
  msg(msgId, null, '진행 중…');
  msg(msgId, await fn(), ok);
  filledSettings = '';
  await refresh();
}

$('startBtn').addEventListener('click', () => act('ctrlMsg', () => crypthy.start(selection()), '시작 요청됨'));
$('stopBtn').addEventListener('click', () => act('ctrlMsg', () => crypthy.stop(), '정지됨'));
$('gpus').addEventListener('click', async (e) => {
  const id = (e.target as HTMLElement).dataset.clear;
  if (id && confirm('제외 원인(팬 막힘·과열 등)을 해결했나요? 재허용하면 현재 선택으로 다시 채굴합니다.')) {
    await crypthy.clearExclusion(id);
    await refresh();
  }
});

$('pickDir').addEventListener('click', () => act('minerMsg', () => crypthy.pickMinerDir(), '폴더 지정됨'));
$('saveWallet').addEventListener('click', () =>
  act('walletMsg', () => crypthy.saveSettings({ wallet: $<HTMLInputElement>('wallet').value.trim(), pool: $<HTMLInputElement>('pool').value.trim() }), '저장됨'),
);
$('importBat').addEventListener('click', () => act('walletMsg', () => crypthy.importBat(), 'bat에서 가져옴'));
$('detectMap').addEventListener('click', () => {
  if (!confirm('모든 GPU로 SRBMiner를 잠깐(최대 40초) 실행해 GPU id를 감지한 뒤 정지합니다. 진행할까요?')) return;
  void act('mapMsg', () => crypthy.detectMapping(), '매핑 완료');
});
$('consentBtn').addEventListener('click', () => {
  if (!$<HTMLInputElement>('consentBox').checked) return msg('consentMsg', '체크박스를 먼저 선택해 주세요');
  void act('consentMsg', () => crypthy.consent(), '동의함');
});

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

$('settingsForm').addEventListener('submit', (e) => {
  e.preventDefault();
  void act('settingsMsg', () => crypthy.saveSettings(readSettingsForm()), '저장됨');
});

$('updateBtn').addEventListener('click', async () => {
  const err = await crypthy.installUpdate();
  if (err) $('updateInfo').textContent = err;
});

crypthy.onState(render);
void refresh();
