// 차트 창: 탭 4개 (GPU 해시·온도·전력 / 시세 / 일별 채굴·순익 / 누적 PnL). 하나만 열리고, 원격 연결 중이면 원격 데이터.
import type { Api, AppState } from '../shared/types';
import { createCharts } from './charts.js';

const crypthy = (window as unknown as { crypthy: Api }).crypthy;
const $ = (id: string) => document.getElementById(id) as HTMLElement;

const CTABS = ['gpu', 'price', 'daily', 'pnl'] as const;
type CTab = (typeof CTABS)[number];
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

/** 테마는 메인 창과 같은 값 (같은 출처의 localStorage, 바뀌면 storage 이벤트) */
const applyThemeAttr = () => {
  const t = store.get('crypthy.theme');
  document.documentElement.dataset.theme = t === 'light' || t === 'system' ? t : 'dark';
};
applyThemeAttr();

const charts = createCharts({ gpu: $('gpuChart'), price: $('priceChart'), daily: $('dailyChart'), pnl: $('pnlChart'), legend: $('chartLegend') });

function showTab(t: CTab) {
  document.querySelectorAll<HTMLElement>('[data-ctab]').forEach((b) => {
    b.classList.toggle('on', b.dataset.ctab === t);
    b.setAttribute('aria-selected', String(b.dataset.ctab === t));
  });
  document.querySelectorAll<HTMLElement>('[data-cpanel]').forEach((p) => (p.hidden = p.dataset.cpanel !== t));
  store.set('crypthy.chartTab', t);
  charts.fit();
}
const isTab = (t: unknown): t is CTab => (CTABS as readonly unknown[]).includes(t);

document.querySelectorAll<HTMLElement>('[data-ctab]').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.ctab as CTab)));
$('metricTabs').addEventListener('click', (e) => {
  const m = (e.target as HTMLElement).dataset.metric as 'hash' | 'temp' | 'power' | undefined;
  if (!m) return;
  document.querySelectorAll('#metricTabs button').forEach((b) => b.classList.toggle('on', (b as HTMLElement).dataset.metric === m));
  charts.setMetric(m);
});
document.addEventListener('click', (e) => {
  const url = (e.target as HTMLElement).closest<HTMLElement>('[data-link]')?.dataset.link;
  if (!url) return;
  e.preventDefault();
  void crypthy.openLink(url);
});
window.addEventListener('storage', (e) => {
  if (e.key === 'crypthy.theme') {
    applyThemeAttr();
    charts.applyTheme();
  }
});
matchMedia('(prefers-color-scheme: light)').addEventListener('change', () => charts.applyTheme());
crypthy.onChartsTab((t) => isTab(t) && showTab(t));

async function refreshCharts() {
  const v = await crypthy.getCharts();
  $('priceTitle').textContent = `${v.symbol} 시세 (USD, 30일)`;
  charts.render(v);
}

function source(st: AppState) {
  const r = st.remote;
  const host = r ? r.url.replace(/^https?:\/\//, '') : '';
  document.title = r ? `Crypthy 차트 · 원격 · ${host}` : 'Crypthy 차트';
  $('chartSource').textContent = r ? `원격 · ${host}${r.error ? ' (연결 오류)' : ''}` : '이 PC';
}

// 시세·풀 갱신이나 PnL 변화(채굴 증가·소급·매도)가 있으면 다시 받는다. 실시간 추정분은 1분 주기로 반영
let chartsAt: string | null = null;
let remoteAt: string | null = null;
crypthy.onState((st) => {
  source(st);
  const pb = st.pnl.backfill;
  const key = `${st.profit.updatedAt}|${(st.pnl.all.confirmed + st.pnl.all.backfill).toFixed(6)}|${pb ? `${pb.from}|${pb.watts}` : st.pnl.bootstrapped}|${st.pnl.soldQty}`;
  const rkey = st.remote?.url ?? '';
  if (key !== chartsAt || rkey !== remoteAt) {
    chartsAt = key;
    remoteAt = rkey;
    void refreshCharts();
  }
});

const asked = new URLSearchParams(location.search).get('tab');
const last = store.get('crypthy.chartTab');
showTab(isTab(asked) ? asked : isTab(last) ? last : 'gpu');
void crypthy.getState().then(source);
void refreshCharts();
setInterval(() => void refreshCharts(), 60_000);
