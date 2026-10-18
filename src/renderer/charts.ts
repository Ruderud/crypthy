// TradingView Lightweight Charts (Apache-2.0). vendor/ 의 standalone 빌드가 전역 LightweightCharts 를 만든다.
// 라이선스 요구에 따라 차트의 TradingView 로고 링크(attributionLogo)를 끄지 않는다.
import type * as LWC from 'lightweight-charts';
import type { ChartsView } from '../shared/types';

declare const LightweightCharts: typeof LWC;

type Metric = 'hash' | 'temp' | 'power';

const METRIC_LABEL: Record<Metric, string> = { hash: '해시레이트 (TH/s)', temp: '온도 (°C)', power: '전력 (W)' };
/** 차트는 UTC 로 그리므로 로컬 시간으로 보이게 오프셋을 더한다 */
const tz = () => -new Date().getTimezoneOffset() * 60;
const toTime = (ms: number) => (Math.floor(ms / 1000) + tz()) as LWC.UTCTimestamp;

const cssVar = (name: string) => getComputedStyle(document.documentElement).getPropertyValue(name).trim();
const palette = () => [cssVar('--accent'), cssVar('--info'), cssVar('--up'), cssVar('--down'), '#b37feb', '#f08c00'];

function baseOptions(): LWC.DeepPartial<LWC.ChartOptions> {
  return {
    autoSize: true,
    layout: {
      background: { type: LightweightCharts.ColorType.Solid, color: cssVar('--panel') },
      textColor: cssVar('--muted'),
      fontFamily: cssVar('--font'),
      fontSize: 11,
      attributionLogo: true,
    },
    grid: { vertLines: { color: cssVar('--grid') }, horzLines: { color: cssVar('--grid') } },
    rightPriceScale: { borderColor: cssVar('--line') },
    timeScale: { borderColor: cssVar('--line'), timeVisible: true, secondsVisible: false },
    crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
  };
}

export function createCharts(els: { gpu: HTMLElement; price: HTMLElement; daily: HTMLElement; pnl: HTMLElement; legend: HTMLElement }) {
  let metric: Metric = 'hash';
  let last: ChartsView | null = null;

  const gpuChart = LightweightCharts.createChart(els.gpu, baseOptions());
  const priceChart = LightweightCharts.createChart(els.price, baseOptions());
  const dailyChart = LightweightCharts.createChart(els.daily, { ...baseOptions(), timeScale: { borderColor: cssVar('--line'), timeVisible: false } });
  const pnlChart = LightweightCharts.createChart(els.pnl, { ...baseOptions(), timeScale: { borderColor: cssVar('--line'), timeVisible: false } });
  // 일별 순익(왼쪽 막대) + 누적 PnL(오른쪽 선)
  const pnlBars = pnlChart.addSeries(LightweightCharts.HistogramSeries, { priceScaleId: 'left', priceFormat: { type: 'price', precision: 0, minMove: 1 } });
  const pnlLine = pnlChart.addSeries(LightweightCharts.LineSeries, { lineWidth: 2, priceFormat: { type: 'price', precision: 0, minMove: 1 } });

  let gpuSeries: LWC.ISeriesApi<'Line'>[] = [];
  const priceSeries = priceChart.addSeries(LightweightCharts.AreaSeries, { lineWidth: 2, priceFormat: { type: 'price', precision: 4, minMove: 0.0001 } });
  const coinSeries = dailyChart.addSeries(LightweightCharts.HistogramSeries, { priceScaleId: 'left', priceFormat: { type: 'price', precision: 3, minMove: 0.001 } });
  const netSeries = dailyChart.addSeries(LightweightCharts.LineSeries, { lineWidth: 2, priceFormat: { type: 'price', precision: 0, minMove: 1 } });
  dailyChart.applyOptions({ leftPriceScale: { visible: true, borderColor: cssVar('--line') } });

  function applyTheme() {
    for (const c of [gpuChart, priceChart, dailyChart, pnlChart]) c.applyOptions(baseOptions());
    for (const c of [dailyChart, pnlChart]) c.applyOptions({ leftPriceScale: { visible: true, borderColor: cssVar('--line') }, timeScale: { timeVisible: false } });
    pnlLine.applyOptions({ color: cssVar('--accent') });
    priceSeries.applyOptions({ lineColor: cssVar('--accent'), topColor: `${cssVar('--accent')}55`, bottomColor: `${cssVar('--accent')}05` });
    coinSeries.applyOptions({ color: cssVar('--accent') });
    netSeries.applyOptions({ color: cssVar('--up') });
    if (last) render(last);
  }

  function renderGpu(v: ChartsView) {
    gpuSeries.forEach((s) => gpuChart.removeSeries(s));
    const colors = palette();
    gpuSeries = v.gpus.map((g, i) => {
      const s = gpuChart.addSeries(LightweightCharts.LineSeries, { color: colors[i % colors.length], lineWidth: 2, title: g.label, priceLineVisible: false });
      s.setData(
        g.points
          .filter((p) => p[metric] !== null)
          .map((p) => ({ time: toTime(p.t), value: metric === 'hash' ? (p.hash as number) / 1e12 : (p[metric] as number) })),
      );
      return s;
    });
    els.legend.textContent = v.gpus.length ? `${METRIC_LABEL[metric]} · 1분 평균 · 최근 3일` : '기록 없음 (GPU 가 감지되면 1분마다 쌓입니다)';
  }

  function render(v: ChartsView) {
    last = v;
    renderGpu(v);
    priceSeries.setData(v.price.map((p) => ({ time: toTime(p.t), value: p.usd })));
    coinSeries.setData(v.daily.map((d) => ({ time: d.day as LWC.Time, value: d.coin })));
    netSeries.setData(v.daily.filter((d) => d.netKrw !== null).map((d) => ({ time: d.day as LWC.Time, value: d.netKrw as number })));
    // 추정(소급·나중 시세 평가) 날은 흐린 색
    const bar = (v: number, est: boolean) => `${v >= 0 ? cssVar('--up') : cssVar('--down')}${est ? '66' : ''}`;
    pnlBars.setData(v.pnl.map((d) => ({ time: d.day as LWC.Time, value: d.netKrw, color: bar(d.netKrw, d.estimated) })));
    pnlLine.setData(v.pnl.map((d) => ({ time: d.day as LWC.Time, value: d.cumulativeKrw })));
    priceChart.timeScale().fitContent();
    dailyChart.timeScale().fitContent();
    pnlChart.timeScale().fitContent();
  }

  applyTheme();

  return {
    render,
    applyTheme,
    setMetric(m: Metric) {
      metric = m;
      if (last) renderGpu(last);
      gpuChart.timeScale().fitContent();
    },
  };
}
