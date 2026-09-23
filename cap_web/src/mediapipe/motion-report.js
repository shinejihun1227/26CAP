import { METRICS, comparisonKey, compareSessions, round } from './rom-math.js';
import { escapeHtml as e } from '../utils/text.js';
import { icon } from '../components/icons.js';

const number = (value, suffix = '°') => Number.isFinite(value) ? `${round(value)}${suffix}` : '—';
export function comparableRecords(record, sessions) {
  if (!record?.summary?.eligible) return [];
  return sessions.filter(s => s.id !== record.id && s.summary?.eligible
    && comparisonKey(s) === comparisonKey(record)
    && Date.parse(s.capturedAt) < Date.parse(record.capturedAt))
    .sort((a,b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
}

export function motionCards({ record, baseline, analysis, fresh = false, recording = false, metric }) {
  const stats = record?.summary?.byMetric?.[record.config.metric];
  const label = METRICS[record?.config.metric || metric]?.label || '선택 관절';
  const compared = !recording && compareSessions(record, baseline);
  const quality = record?.summary;
  return [
    { label: record && !recording ? '기록 중앙 각도' : '현재 관절 각도', value: record && !recording ? number(stats?.median) : number(fresh && analysis?.valid ? analysis.primary : null), note: label, tone: 'sky', symbol: 'activity' },
    { label: '움직인 범위', value: number(stats?.observedRange), note: stats ? `대부분의 각도 ${number(stats.p05)} ~ ${number(stats.p95)}` : '15초 기록 후 확인', tone: 'mint', symbol: 'arrow' },
    { label: '기록 품질', value: quality ? number(quality.validRatio * 100, '%') : '—', note: quality ? `유효 ${quality.validCount}/${quality.totalCount}개 · ${recording ? '수집 중' : quality.eligible ? '비교 가능' : '비교 제외'}` : '유효한 관절 표본의 비율', tone: 'lavender', symbol: 'camera' },
    { label: '이전 기록과 차이', value: compared ? `${compared.delta > 0 ? '+' : ''}${number(compared.delta)}` : '—', note: compared ? '움직인 범위 차이' : '같은 조건의 저장 기록 필요', tone: 'sand', symbol: 'balance' },
  ];
}
export function renderMotionCards(options) {
  return motionCards(options).map(c => `<article class="motion-stat motion-${c.tone}"><div><span class="motion-stat-icon">${icon(c.symbol)}</span><h3>${e(c.label)}</h3></div><strong>${e(c.value)}</strong><p>${e(c.note)}</p></article>`).join('');
}

export function recordInsights(record, baseline) {
  if (!record) return ['15초 기록을 마치면 움직임의 범위와 관찰 시점을 요약해 드려요.', '같은 조건으로 저장한 이전 기록과 비교할 수 있어요.'];
  const metric = record.config.metric, stats = record.summary.byMetric[metric];
  const valid = record.samples.filter(s => s.valid && Number.isFinite(s.values?.[metric]));
  const peak = valid.reduce((a,b) => !a || b.values[metric] > a.values[metric] ? b : a, null);
  const notes = [];
  if (peak) notes.push(`${METRICS[metric].label}: ${number(peak.values[metric])}가 ${round(peak.t / 1000)}초에 가장 크게 관찰됐어요.`);
  if (stats) notes.push(`대부분의 유효 각도는 ${number(stats.p05)} ~ ${number(stats.p95)}였고, 관찰 범위는 ${number(stats.observedRange)}예요.`);
  const compared = compareSessions(record, baseline);
  if (!record.summary.eligible) notes.push('기록 품질 조건을 충족하지 못해 이전 기록 비교에서 제외했어요. 몸 위치를 확인한 뒤 다시 기록해 주세요.');
  else if (compared) notes.push(`이전 기록보다 관찰 범위가 ${compared.delta === 0 ? '같아요' : `${number(Math.abs(compared.delta))} ${compared.delta > 0 ? '커졌어요' : '작아졌어요'}`}. 수치 차이를 뜻하며 개선·악화 판정은 아니에요.`);
  else notes.push('같은 관절·방향·자세·촬영 조건의 이전 기록을 저장하면 변화를 비교할 수 있어요.');
  return notes;
}
export function renderMotionInsights(record, baseline) {
  return `<ol>${recordInsights(record, baseline).map((note, i) => `<li><span>${i + 1}</span><p>${e(note)}</p></li>`).join('')}</ol>`;
}

// Invalid samples break the line. Every x coordinate is an actual sample time.
export function angleSeries(samples, metric) {
  return samples.map(s => ({ t: s.t / 1000, value: s.valid && Number.isFinite(s.values?.[metric]) ? s.values[metric] : null }));
}
export function renderAngleChart(samples, metric, baseline = null, durationSeconds = 15) {
  const series = angleSeries(samples, metric), previous = baseline ? angleSeries(baseline.samples, baseline.config.metric) : [];
  const maxTime = Math.max(1, durationSeconds, ...series.map(p => p.t), ...previous.map(p => p.t));
  const width = 800, height = 290, left = 64, right = 18, top = 20, bottom = 60;
  const x = t => round(left + t / maxTime * (width - left - right), 2);
  const y = v => round(height - bottom - v / 180 * (height - top - bottom), 2);
  const path = points => {
    let connected = false;
    return points.map(p => { if (p.value === null) { connected = false; return ''; } const command = `${connected ? 'L' : 'M'}${x(p.t)},${y(p.value)}`; connected = true; return command; }).join(' ');
  };
  const ticks = [0, 45, 90, 135, 180].map(a => `<line x1="${left}" y1="${y(a)}" x2="${width-right}" y2="${y(a)}"/><text x="${left-10}" y="${y(a)+4}" text-anchor="end">${a}</text>`).join('');
  const times = Array.from({length:6}, (_,i) => { const t = maxTime * i / 5; return `<text x="${x(t)}" y="${height-12}" text-anchor="${i === 5 ? 'end' : 'middle'}">${round(t)}초</text>`; }).join('');
  const good = series.filter(p => p.value !== null);
  const peak = good.reduce((a,b) => !a || b.value > a.value ? b : a, null);
  return `<svg class="motion-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(METRICS[metric]?.label || '선택 관절')} 각도 변화. 시간은 초, 각도는 도 단위입니다."><g class="motion-chart-grid">${ticks}${times}</g>${previous.length ? `<path class="motion-chart-previous" d="${path(previous)}"/>` : ''}<path class="motion-chart-current" d="${path(series)}"/>${peak ? `<circle class="motion-chart-peak" cx="${x(peak.t)}" cy="${y(peak.value)}" r="5"><title>${round(peak.t)}초 · ${number(peak.value)}</title></circle>` : '<text class="motion-chart-empty" x="410" y="140" text-anchor="middle">관절이 인식되면 그래프가 나타나요</text>'}</svg>`;
}

export function renderRecordComparison(record, baseline) {
  const compared = compareSessions(record, baseline);
  if (!compared) return '<p class="motion-empty">같은 조건의 품질 통과 기록 두 개가 있어야 비교할 수 있어요.</p>';
  const a = record.summary.byMetric[record.config.metric], b = baseline.summary.byMetric[baseline.config.metric];
  const rows = [['움직인 범위', a.observedRange, b.observedRange, 180, '°'], ['중앙 각도', a.median, b.median, 180, '°'], ['유효 표본 비율', record.summary.validRatio * 100, baseline.summary.validRatio * 100, 100, '%']];
  return `<div class="motion-comparison-grid">${rows.map(([label, now, before, max, unit]) => `<article><h3>${label}</h3>${[['선택 기록', now, 'current'], ['이전 기록', before, 'previous']].map(([name, value, tone]) => `<div class="motion-comparison-bar"><span>${name}</span><div><i class="${tone}" style="width:${Math.max(0, Math.min(100, value / max * 100))}%"></i></div><b>${number(value, unit)}</b></div>`).join('')}</article>`).join('')}</div>`;
}

export function renderMotionDashboard() {
  return `<section class="motion-analysis" data-motion-analysis aria-label="관절 측정 분석"><div class="motion-section-heading"><div><h2>측정값 한눈에 보기</h2><p data-motion-context>카메라를 켜면 현재 각도를 볼 수 있어요.</p></div><span class="motion-state" data-motion-state>측정 대기</span></div><div class="motion-stats" data-motion-cards></div><div class="motion-analysis-grid"><section class="motion-panel"><div class="motion-section-heading"><h2>관절 각도 변화</h2><span class="motion-chart-legend"><i></i><span data-motion-chart-label>실시간</span><span class="motion-previous-legend"><i class="previous"></i>이전 기록</span></span></div><p class="motion-chart-caption" data-motion-chart-caption>각도(°) · 인식되지 않은 구간은 선을 연결하지 않아요.</p><div data-rom-chart></div><details class="motion-more"><summary>함께 인식한 관절 보기</summary><div class="rom-live-metrics" data-rom-metrics></div></details></section><aside class="motion-panel motion-insights"><h2>이번 기록의 관찰 요약</h2><div data-motion-insights></div></aside></div><section class="motion-panel motion-comparison" id="rom-record-comparison"><div class="motion-section-heading"><h2>저장 기록 비교</h2><span>같은 조건끼리 비교해요</span></div><div class="motion-review-controls"><label>불러올 기록<select data-motion-review><option value="">저장된 기록 없음</option></select></label><button type="button" data-rom-action="review" disabled>기록 불러오기</button><label>비교할 이전 기록<select data-motion-baseline disabled><option value="">비교할 기록 없음</option></select></label></div><div data-motion-comparison></div><p class="motion-footnote">관절·촬영 방향·자세·환경·신뢰도·모델·화면 비율이 같은 기록만 비교합니다.</p></section></section>`;
}
