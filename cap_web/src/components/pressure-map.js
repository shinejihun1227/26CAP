import { icon } from "./icons.js";

const sensorPoints = [
  [37, 17], [50, 13], [63, 19], // 발 위쪽 3개
  [42, 43], [58, 52],           // 아치쪽 2개
  [37, 68], [50, 80], [63, 89], // 발 밑쪽 3개
];

function heatClass(value) {
  if (value >= 76) return "hot";
  if (value >= 60) return "warm";
  if (value >= 44) return "mid";
  return "cool";
}

export function renderPressureMap(pressure) {
  return `
    <div class="pressure-content">
      <div class="pressure-visual" aria-label="왼발 압력 분포">
        <div class="foot-outline" aria-hidden="true">
          <span class="toe toe-1"></span><span class="toe toe-2"></span><span class="toe toe-3"></span><span class="toe toe-4"></span><span class="toe toe-5"></span>
          <span class="foot-arch"></span>
        </div>
        ${pressure.map((value, index) => `<span class="pressure-node ${heatClass(value)}" style="left:${sensorPoints[index][0]}%;top:${sensorPoints[index][1]}%"><b>${value}</b></span>`).join("")}
        <div class="pressure-axis"><span>낮음</span><i></i><span>높음</span></div>
      </div>
      <div class="pressure-summary">
        <div class="pressure-summary-head"><span>평균 접지 압력</span><strong>${Math.round(pressure.reduce((sum, value) => sum + value, 0) / pressure.length)}<small>%</small></strong></div>
        <div class="meter"><span style="width:${Math.round(pressure.reduce((sum, value) => sum + value, 0) / pressure.length)}%"></span></div>
        <div class="pressure-legend"><span><i class="legend-dot mint"></i>안정</span><span><i class="legend-dot orange"></i>관찰</span><span><i class="legend-dot coral"></i>주의</span></div>
        <div class="pressure-note">${icon("shoe")}<span>앞꿈치와 뒤꿈치의<br /><b>체중 이동이 균형적</b>이에요.</span></div>
      </div>
    </div>
  `;
}
