import { escapeHtml as e } from '../utils/text.js';
import { koreaDay, shiftDay, compareDays, SENSOR_METRICS } from './trend-math.js';
const n = (value, unit = '') => Number.isFinite(value) ? `${value.toLocaleString('ko-KR', { maximumFractionDigits: 1 })}${unit}` : '—';
export function changeText(delta, unit) { return delta === null ? '비교 자료 없음' : delta === 0 ? '표시 정밀도에서 동일' : `${n(Math.abs(delta), unit)} ${delta > 0 ? '증가' : '감소'}`; }
export function renderDailyChart(days, date, unit) {
  const start = shiftDay(date, -13), filtered = days.filter((d) => d.day >= start && d.day <= date);
  const valid = filtered.filter((d) => Number.isFinite(d.value));
  if (!valid.length) return '<div class="trends-empty">이 기간의 유효 기록이 없습니다. 빈 날짜는 0이나 추정값으로 채우지 않습니다.</div>';
  const lo = Math.min(...valid.map((d) => d.value)), hi = Math.max(...valid.map((d) => d.value)), pad = Math.max(1, (hi - lo) * .15);
  const min = lo >= 0 ? Math.max(0, lo - pad) : lo - pad, max = hi + pad, x = (day) => 65 + ((Date.parse(day) - Date.parse(start)) / 86400000) / 13 * 700;
  const y = (value) => 170 - (value - min) / (max - min) * 140;
  let paths = '', previous = null;
  for (const day of filtered) {
    if (!Number.isFinite(day.value)) { previous = null; continue; }
    if (previous && shiftDay(previous.day, 1) === day.day) paths += `<path d="M${x(previous.day)},${y(previous.value)}L${x(day.day)},${y(day.value)}" stroke="#087c70" stroke-width="3" fill="none"/>`;
    paths += `<circle cx="${x(day.day)}" cy="${y(day.value)}" r="5" fill="#087c70"><title>${e(day.day)}: ${n(day.value, unit)}</title></circle>`;
    previous = day;
  }
  return `<svg class="trends-chart" viewBox="0 0 810 220" role="img" aria-label="최근 14일 관찰값. 누락 날짜는 연결하지 않으며 아래 표에서 정확한 수치를 확인할 수 있습니다."><path d="M65,25V180H780" stroke="#bdccd5" fill="none"/><text x="4" y="36">${n(max)}</text><text x="4" y="172">${n(min)}</text>${paths}<text x="65" y="207">${start.slice(5)}</text><text x="715" y="207">${date.slice(5)}</text></svg>`;
}
export function renderComparison(days, date, mode, { unit = '°', sensor = false, label = '관찰 범위', note = '' } = {}) {
  const c = compareDays(days, date, mode), deltaUnit = unit === '%' ? '%p' : unit;
  const referenceLabel = mode === 'week' ? `이전 7일 중 ${c.baseline.length}일의 평균` : mode === 'previous' ? c.baseline[0]?.day ?? '직전 기록일 없음' : shiftDay(date, -1);
  const todayNote = c.today ? `${c.today.count}${sensor ? '개 유효 표본' : '회 품질 통과'} / ${c.today.total}${sensor ? '개 저장 표본' : '회 측정'}` : '저장된 기록 없음';
  const limited = sensor ? '10개 미만인 지표는 비교에서 제외합니다. 표본 수·활동·기록 시간대가 다르면 수치만으로 상태를 판단할 수 없습니다.' : '품질 통과 기록의 P95−P05 각도 범위를 날짜별 중앙값으로 비교합니다. 각도 증가가 항상 개선을 뜻하지는 않습니다.';
  return `<div class="trends-comparison-grid"><div class="trends-stat"><span>${e(date)}${date === koreaDay() ? ' · 진행 중' : ''}</span><strong>${n(c.today?.value, unit)}</strong><small>${e(todayNote)}</small></div><div class="trends-stat"><span>${e(referenceLabel)}</span><strong>${n(c.reference, unit)}</strong><small>${c.baseline.length ? c.baseline.map((d) => `${d.day}: ${d.count}${sensor ? '표본' : '회'}`).join(' · ') : '누락일을 다른 날짜로 대체하지 않음'}</small></div><div class="trends-stat is-change"><span>${e(label)} 변화</span><strong>${c.delta === null ? '비교 대기' : `${c.delta > 0 ? '+' : ''}${n(c.delta, deltaUnit)}`}</strong><small>${changeText(c.delta, deltaUnit)}</small></div></div>
    <p class="trends-change-note">${c.delta === null ? '같은 조건의 유효 기록이 양쪽 날짜에 있어야 비교할 수 있습니다.' : `관찰값이 ${changeText(c.delta, deltaUnit)}했습니다. 측정 조건과 몸 상태를 함께 확인하세요.`}</p><p class="trends-help">${e(limited)} ${e(note)}</p>
    ${renderDailyChart(days, date, unit)}<div class="trends-table-wrap"><table><caption class="trends-help">${e(label)} · 날짜별 원자료 요약</caption><thead><tr><th>날짜</th><th>관찰값</th><th>${sensor ? '유효 표본' : '품질 통과'}</th><th>${sensor ? '해당 지표 없음' : '품질 제외'}</th></tr></thead><tbody>${days.filter((d) => d.day <= date).slice(-30).reverse().map((d) => `<tr><td>${e(d.day)}</td><td>${n(d.value, unit)}</td><td>${d.count}</td><td>${d.excluded}</td></tr>`).join('') || '<tr><td colspan="4">저장 기록 없음</td></tr>'}</tbody></table></div>`;
}
export function renderSensorSummary(rows, makeDays, date, mode) {
  return `<div class="trends-table-wrap"><table><caption class="trends-help">선택한 센서 조건의 전체 알고리즘 지표</caption><thead><tr><th>지표</th><th>선택 날짜</th><th>이전 기준</th><th>수치 변화</th></tr></thead><tbody>${Object.entries(SENSOR_METRICS).map(([key, spec]) => {
    const c = compareDays(makeDays(key), date, mode);
    return `<tr><td><button class="trends-day-button" data-trend-action="metric" data-metric="${key}">${e(spec.label)}</button></td><td>${n(c.today?.value, spec.unit)}</td><td>${n(c.reference, spec.unit)}</td><td>${changeText(c.delta, spec.unit === '%' ? '%p' : spec.unit)}</td></tr>`;
  }).join('')}</tbody></table></div>`;
}
