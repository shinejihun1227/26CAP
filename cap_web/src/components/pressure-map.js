import { icon } from './icons.js';
import { PRESSURE_POINTS, PRESSURE_SITES, PRESSURE_CHANNELS, validPressure } from '../data/sensor-config.js';
import { PRESSURE_ACTIVE_THRESHOLD } from './bilateral-heatmap.js';

export function renderPressureMap(pressure) {
  const valid = validPressure(pressure);
  const average = valid ? Math.round(pressure.reduce((sum, value) => sum + value, 0) / PRESSURE_CHANNELS.length) : null;
  return `<div class="pressure-content"><div class="pressure-visual" aria-label="왼발 4개 압력센서 분포">
    <div class="foot-outline" aria-hidden="true"><span class="toe toe-1"></span><span class="toe toe-2"></span><span class="toe toe-3"></span><span class="toe toe-4"></span><span class="toe toe-5"></span><span class="foot-arch"></span></div>
    ${PRESSURE_POINTS.left.map(([x, y], i) => `<span class="pressure-node ${valid && pressure[i] >= PRESSURE_ACTIVE_THRESHOLD ? 'hot' : 'cool'}" style="left:${x}%;top:${y}%" title="P${i + 1} ${PRESSURE_SITES[i]} · C${PRESSURE_CHANNELS[i]}"><b>${valid ? pressure[i] : '--'}</b></span>`).join('')}
    <div class="pressure-axis"><span>압력 없음</span><i></i><span>압력 있음 ≥ ${PRESSURE_ACTIVE_THRESHOLD}%</span></div></div>
    <div class="pressure-summary"><div class="pressure-summary-head"><span>평균 상대 압력</span><strong>${average ?? '--'}<small>%</small></strong></div><div class="meter"><span style="width:${average ?? 0}%"></span></div><div class="pressure-note">${icon('shoe')}<span>앞쪽 1개 · 가운데 2개 · 뒤꿈치 1개<br/>상대 센서값이며 실제 체중이 아닙니다.</span></div></div></div>`;
}
