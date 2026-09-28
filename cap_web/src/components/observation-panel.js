import { escapeHtml as e } from '../utils/text.js';
import { icon } from './icons.js';
import { readObservationFeet, readFogObservation, pairedDifference, summarizeFog } from '../data/observation-monitor.js';

const finite = value => typeof value === 'number' && Number.isFinite(value);
const number = (value, digits = 1) => finite(value) ? value.toFixed(digits) : '—';
const clock = at => new Date(at).toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' });
const sideName = side => side === 'right' ? '오른발' : '왼발';
const METRICS = {
  temperature: { label: '온도', title: '양발 온도 변화', unit: '°C', help: '신발 안 온도 센서의 유효 채널 평균입니다. 피부 온도나 체온으로 해석하지 마세요.' },
  humidity: { label: '습도', title: '양발 습도 변화', unit: '%', help: '신발 안 상대습도입니다. 땀·신발·활동 환경의 영향을 함께 살펴보세요.' },
  pressure: { label: '압력', title: '양발 상대 압력 변화', unit: '/100', help: '발마다 압력 4채널의 평균 상대값입니다. kg·kPa 단위의 실제 하중이나 궤양 위험 점수가 아닙니다.' },
};

function choice(group, value, selected, label) {
  return `<button type="button" data-observation-control="${group}" data-value="${value}" aria-pressed="${value === String(selected)}" class="${value === String(selected) ? 'is-selected' : ''}">${label}</button>`;
}
function metricCard(label, value, unit, detail, tone = '') {
  return `<article class="observation-stat ${tone}"><span>${label}</span><strong>${value}<small>${unit}</small></strong><p>${e(detail)}</p></article>`;
}
function emptyChart(title, detail) {
  return `<div class="observation-empty"><span>${icon('activity')}</span><b>${e(title)}</b><p>${e(detail)}</p></div>`;
}
function axes(from, to, min, max, unit) {
  const y = v => 218 - (v - min) / (max - min) * 180;
  let grid = '';
  for (let i = 0; i <= 4; i++) {
    const value = min + (max - min) * i / 4;
    grid += `<line x1="62" y1="${y(value)}" x2="772" y2="${y(value)}"/><text x="50" y="${y(value) + 5}" text-anchor="end">${number(value, max - min <= 8 ? 1 : 0)}</text>`;
  }
  for (let i = 0; i <= 4; i++) {
    const x = 62 + 710 * i / 4, at = from + (to - from) * i / 4;
    grid += `<text x="${x}" y="250" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}">${clock(at).slice(0, 5)}</text>`;
  }
  return `<g class="observation-axis"><text x="62" y="20">${unit}</text>${grid}</g>`;
}

export function renderObservationChart(points, metric, from, to) {
  const spec = METRICS[metric], visible = points.filter(p => p.at >= from && p.at <= to);
  const values = visible.flatMap(p => [p.left?.[metric], p.right?.[metric]]).filter(finite);
  if (!values.length) return emptyChart('센서값을 기다리고 있어요', '깔창을 연결하면 왼발과 오른발의 변화가 여기에 나타납니다.');
  const minValue = Math.min(...values), maxValue = Math.max(...values);
  const padding = Math.max(metric === 'temperature' ? .5 : 2, (maxValue - minValue) * .15);
  const min = metric === 'temperature' ? Math.floor((minValue - padding) * 2) / 2 : Math.max(0, Math.floor(minValue - padding));
  const max = metric === 'temperature' ? Math.ceil((maxValue + padding) * 2) / 2 : Math.min(100, Math.ceil(maxValue + padding));
  const x = at => 62 + (at - from) / Math.max(1, to - from) * 710;
  const y = value => 218 - (value - min) / Math.max(1, max - min) * 180;
  const lines = ['left', 'right'].map(side => {
    let previous = null, path = '', dots = '';
    for (const point of visible) {
      const value = point[side]?.[metric], key = `${point[side]?.frame?.split(':').slice(0, -1).join(':')}:${point[side]?.[`${metric}Key`] ?? ''}`;
      if (!finite(value)) { previous = null; continue; }
      const connected = previous && point.at - previous.at <= 2500 && previous.key === key;
      path += `${connected ? 'L' : 'M'}${x(point.at).toFixed(1)},${y(value).toFixed(1)} `;
      if (!connected || point === visible.at(-1)) dots += `<circle cx="${x(point.at)}" cy="${y(value)}" r="3"><title>${sideName(side)} · ${clock(point.at)} · ${number(value)}${spec.unit}</title></circle>`;
      previous = { at: point.at, key };
    }
    return `<g class="observation-line is-${side}"><path d="${path}"/>${dots}</g>`;
  }).join('');
  return `<div class="observation-chart-scroll"><svg class="observation-chart" viewBox="0 0 800 270" role="img" aria-label="${spec.title}: 파란색 왼발, 산호색 오른발. 수신 공백은 선을 연결하지 않습니다.">${axes(from, to, min, max, spec.unit)}${lines}</svg></div>`;
}

function fogChart(summary, from, to) {
  if (!summary.hasData) return emptyChart('AI 분석 연결을 기다리고 있어요', '기기 설정에서 센서 연결과 개인 IMU 보정을 확인해 주세요.');
  const maximum = Math.max(1, Math.ceil(summary.longest ?? 0));
  const bars = summary.events.map(event => {
    const x = 62 + (Math.max(event.start, from) - from) / Math.max(1, to - from) * 710;
    const height = Math.max(3, event.duration / maximum * 180);
    return `<g class="observation-event-bar"><rect x="${Math.min(764, x - 4)}" y="${218 - height}" width="8" height="${height}" rx="4"><title>${clock(event.start)} · 관찰 ${number(event.duration)}초${event.open ? ' · 감지 중' : event.interrupted ? ' · 연결 중단' : ''}</title></rect></g>`;
  }).join('');
  return `<div class="observation-chart-scroll"><svg class="observation-chart" viewBox="0 0 800 270" role="img" aria-label="FoG 신호 구간별 관찰 지속시간. 막대 높이는 초 단위입니다.">${axes(from, to, 0, maximum, '관찰 지속시간 (초)')}${bars}${!summary.events.length ? '<text class="observation-chart-message" x="420" y="120" text-anchor="middle">관찰한 구간에서 FoG 지속 신호가 없어요</text>' : ''}</svg></div>`;
}

function fogContent(state, history, from, now) {
  const summary = summarizeFog(history, from, now), current = readFogObservation(state, now);
  const status = current?.state === 'confirmed' ? 'FoG 신호 감지 중' : current?.state === 'warning' ? '신호 관찰 중' : current ? '지속 신호 미확인' : state.paused ? '관찰 일시정지' : 'AI 연결 대기';
  const rows = summary.events.slice().reverse().slice(0, 6).map(event => `<li><i class="observation-event-dot"></i><div><b>${clock(event.start)}</b><span>${event.sides.map(sideName).join(' · ') || 'AI 보행 신호'}${event.partialStart || event.clipped ? ' · 시작 일부 미관찰' : ''}</span><small>${event.open ? '감지 중 · 시간 집계 중' : event.interrupted ? '관찰 중단 · 종료 시각 미확인' : '신호 해제'}${event.clipped ? ' · 선택 범위 내 시간' : ''}</small></div><strong>${number(event.duration)}<small> 초</small></strong></li>`).join('');
  return `<div class="observation-stats">
    ${metricCard('현재 AI 관찰', status, '', current ? '양발 중 더 높은 AI 판정 기준' : '센서 연결 · 개인 보정 확인', 'is-status')}
    ${metricCard('관찰된 FoG 구간', number(summary.count, 0), '회', '연속 신호를 한 구간으로 집계')}
    ${metricCard('총 관찰 지속시간', number(summary.total), '초', '수신이 끊긴 시간은 제외')}
    ${metricCard('가장 긴 관찰 구간', number(summary.longest), '초', '선택한 시간 범위 기준')}
    </div><div class="observation-columns"><article class="observation-plot"><header><div><h3>FoG 신호 발생 추이</h3><p>발생 시각과 관찰 지속시간을 확인하세요.</p></div><span class="observation-chip">AI 유효 관찰 ${number(summary.observedSeconds, 0)}초</span></header>${fogChart(summary, from, now)}<p class="observation-plot-note">분석 창의 상태 변화를 기준으로 한 추정 시간입니다. 실제 증상의 시작·종료 시각과 다를 수 있어요.</p></article>
    <aside class="observation-recent"><header><h3>최근 FoG 신호</h3><span>최근 6개</span></header>${rows ? `<ul>${rows}</ul>` : '<div class="observation-list-empty">감지된 신호 구간이 생기면<br>시각과 지속시간을 보여드려요.</div>'}<button class="observation-link" data-view="devices">AI 연결 · 개인 기준 확인 →</button></aside></div>`;
}

function changeNote(points, metric, side, current, from) {
  if (!finite(current[metric])) return '센서값 수신 대기';
  const candidates = points.filter(p => p.at >= from && finite(p[side]?.[metric]) && p[side]?.frame?.split(':').slice(0, -1).join(':') === current.frame?.split(':').slice(0, -1).join(':') && p[side]?.[`${metric}Key`] === current[`${metric}Key`]);
  if (candidates.length < 2) return '변화를 비교할 값을 모으고 있어요';
  const first = candidates[0], delta = current[metric] - first[side][metric];
  return `${clock(first.at)} 대비 ${delta > 0 ? '+' : ''}${number(delta)}${metric === 'temperature' ? '°C' : metric === 'humidity' ? '%p' : '점'}`;
}

function healthContent(state, history, metric, from, now) {
  const spec = METRICS[metric], feet = readObservationFeet(state, now), difference = metric === 'pressure'
    ? { value: finite(feet.left.pressure) && finite(feet.right.pressure) ? feet.right.pressure - feet.left.pressure : null, count: 4 }
    : pairedDifference(feet, metric);
  const unit = metric === 'humidity' ? '%p' : metric === 'pressure' ? '점' : '°C';
  const diffText = finite(difference.value) ? Math.abs(difference.value) < .05 ? '양발 값이 비슷해요' : `${difference.value > 0 ? '오른발' : '왼발'}이 ${number(Math.abs(difference.value))}${unit} 높게 측정돼요` : '양발의 비교 가능한 센서값이 필요해요';
  const cardNote = side => metric === 'pressure' ? '유효 압력 4채널 평균' : `유효 ${feet[side][metric === 'temperature' ? 'temperatures' : 'humidities'].length}/4채널 평균`;
  const rows = ['left', 'right'].map(side => `<li><i class="observation-side-dot is-${side}"></i><div><b>${sideName(side)} ${spec.label} 변화</b><span>${changeNote(history.points ?? [], metric, side, feet[side], from)}</span></div></li>`).join('');
  const peaks = ['left', 'right'].map(side => `<li><i class="observation-side-dot is-${side}"></i><div><b>${sideName(side)} 압력 분포</b><span>${feet[side].peak ? `${e(feet[side].peak.site)} 비중이 가장 커요 · ${number(feet[side].peak.share, 0)}%` : feet[side].pressure === 0 ? '현재 압력 신호 0 · 접촉 여부 확인' : '유효 압력값 수신 대기'}</span></div></li>`).join('');
  return `<div class="observation-metric-tabs" role="group" aria-label="발 건강 관찰 지표">${Object.entries(METRICS).map(([key, value]) => choice('metric', key, metric, value.label)).join('')}</div>
    <div class="observation-stats is-health">${metricCard(`왼발 ${spec.label}`, number(feet.left[metric]), spec.unit, cardNote('left'), 'is-left')}${metricCard(`오른발 ${spec.label}`, number(feet.right[metric]), spec.unit, cardNote('right'), 'is-right')}${metricCard('양발 차이', number(finite(difference.value) ? Math.abs(difference.value) : null), unit, metric === 'pressure' ? '오른발 − 왼발 평균값의 절댓값' : `양발 같은 위치 ${difference.count}곳을 비교`)}</div>
    <div class="observation-columns"><article class="observation-plot"><header><div><h3>${spec.title}</h3><p>양발의 변화 흐름을 함께 살펴보세요.</p></div><div class="observation-legend"><span><i class="is-left"></i>왼발</span><span><i class="is-right"></i>오른발</span></div></header>${renderObservationChart(history.points ?? [], metric, from, now)}<p class="observation-comparison">${icon('activity')}<span>${diffText}</span></p><p class="observation-plot-note">${spec.help}</p></article>
    <aside class="observation-recent"><header><h3>최근 관찰 요약</h3><span>현재 수신 기준</span></header><ul>${rows}${peaks}</ul><p class="observation-plot-note">같은 신발·센서 위치·활동 조건에서 비교해 주세요. 센서값만으로 당뇨발·염증 여부를 판단하지 않습니다.</p></aside></div>`;
}

export function renderObservationPanel(state, now = Date.now()) {
  const history = state.observation ?? { points: [], events: [], windows: [] }, ui = state.observationUi ?? {};
  const mode = ui.mode === 'health' ? 'health' : 'fog', metric = METRICS[ui.metric] ? ui.metric : 'temperature';
  const minutes = [5, 15, 30].includes(Number(ui.minutes)) ? Number(ui.minutes) : 5;
  const from = now - minutes * 60000;
  return `<section class="observation-panel" aria-labelledby="observation-heading"><header class="observation-heading"><div><span class="eyebrow">WALKING & FOOT CARE</span><h2 id="observation-heading">상태 관찰</h2><p>보행동결 신호와 발 상태를 나누어 살펴보세요.</p></div><div class="observation-mode-tabs" role="group" aria-label="상태 관찰 종류">${choice('mode', 'fog', mode, `${icon('activity')}<span>FoG 모니터링<small>보행동결 신호</small></span>`)}${choice('mode', 'health', mode, `${icon('shoe')}<span>발 건강 모니터링<small>온도 · 습도 · 압력</small></span>`)}</div></header>
    <div class="observation-toolbar"><span>${state.dataSource !== 'esp32' ? '실제 깔창 연결 후 관찰할 수 있어요' : state.paused ? '일시정지 · 이전 관찰 기록 표시' : '이번 웹 접속 중 관찰한 데이터'} · 새로고침 시 초기화</span><div role="group" aria-label="관찰 시간 범위">${[5, 15, 30].map(n => choice('minutes', String(n), minutes, `최근 ${n}분`)).join('')}</div></div>
    <div class="observation-content" data-observation-mode="${mode}">${mode === 'fog' ? fogContent(state, history, from, now) : healthContent(state, history, metric, from, now)}</div>
    <footer><span>최대 30분 · 미수신 구간은 비워 둡니다 · 영구 저장 아님</span><button class="observation-link" data-view="records" data-record-section="walking">일별 기록 저장하기 →</button></footer></section>`;
}
