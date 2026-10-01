import { METRICS, VIEWS, metricsForView } from './rom-math.js';
import { escapeHtml as e } from '../utils/text.js';

// Keep the observation protocol explicit; these are not treatment prescriptions.
export const JOINT_GROUPS = [
  { id: 'ankle', label: '발목', metrics: ['left_ankle', 'right_ankle'] },
];

export function resolveJointSelection(metric, view, changed = 'view') {
  const safeView = Object.hasOwn(VIEWS, view) ? view : 'front';
  if (changed === 'metric' && METRICS[metric]) return { metric, view: METRICS[metric].views.includes(safeView) ? safeView : METRICS[metric].views[0] };
  if (METRICS[metric]?.views.includes(safeView)) return { metric, view: safeView };
  // Switching left/right retains the joint/motion, rather than silently switching to ankle.
  const counterpart = typeof metric === 'string' ? metric.replace(/^(left|right)_/, `${safeView}_`) : '';
  if (METRICS[counterpart]?.views.includes(safeView)) return { metric: counterpart, view: safeView };
  const fallback = safeView === 'right' ? 'right_ankle' : 'left_ankle';
  return { metric: fallback, view: METRICS[fallback].views[0] };
}

export function renderJointOptions(selected = 'left_ankle', { historical = false } = {}) {
  const oldOption = historical && METRICS[selected] && !selected.endsWith('_ankle') ? `<option value="${e(selected)}" selected>${e(METRICS[selected].label)} · 이전 기록</option>` : '';
  return oldOption + JOINT_GROUPS.map((group) => `<optgroup label="${e(group.label)}">${group.metrics.map((id) => `<option value="${id}"${id === selected ? ' selected' : ''}>${e(METRICS[id].label)} · ${VIEWS[METRICS[id].views[0]]}</option>`).join('')}</optgroup>`).join('');
}

export function jointGuide(metric) {
  const definition = METRICS[metric];
  if (!definition) return null;
  const side = metric.startsWith('left_') ? '왼쪽' : '오른쪽';
  const view = definition.views[0];
  const framing = metric.endsWith('ankle')
    ? `${side} 발의 옆면을 촬영하세요. 정강이부터 발끝까지 화면 안에 크게 담고, 다른 사람은 프레임에서 제외하세요. 각도는 무릎·발목·뒤꿈치·발끝 네 점으로 계산합니다.`
    : view === 'front'
    ? '정면에서 두 어깨와 골반이 보이도록 촬영합니다.'
    : `몸의 ${side} 옆면을 카메라로 향하고, ${side} 어깨와 골반도 화면에 넣으세요.`;
  let setup, meaning, caution;
  if (metric.endsWith('shoulder_flexion')) {
    setup = '팔을 몸 앞쪽으로 드는 동작을 화면 평면에서 관찰합니다. 팔꿈치·어깨·골반이 보여야 합니다.';
    meaning = '위팔과 몸통 사이의 투영 각도. 팔을 내린 자세가 약 0°입니다.';
    caution = '몸통을 뒤로 젖히거나 팔을 뒤로 들면 다른 움직임이 섞입니다. 앞/뒤 방향을 자동 구분하지 않으며 독립 어깨관절 ROM이 아닙니다.';
  } else if (metric.endsWith('shoulder')) {
    setup = '팔을 옆으로 드는 동작을 화면 평면에서 관찰합니다. 팔꿈치·어깨·골반이 보여야 합니다.';
    meaning = '팔꿈치–어깨–골반 사이 각도. 위팔이 몸통에서 떨어지는 정도를 기록합니다.';
    caution = '어깨 으쓱임·몸통 기울임·팔의 앞뒤 움직임이 값에 섞일 수 있습니다.';
  } else if (metric.endsWith('elbow')) {
    setup = '팔꿈치 굽힘·펴기 중 어깨·팔꿈치·손목이 모두 보이게 합니다. 손목이 몸통에 가려지지 않도록 합니다.';
    meaning = '180° − 어깨–팔꿈치–손목 내각. 일직선이면 약 0°입니다.';
    caution = '팔을 카메라 쪽으로 돌리면 투영 오차가 커집니다. 과신전과 팔뚝 회전은 구분하지 않습니다.';
  } else if (metric.endsWith('knee')) {
    setup = '무릎 굽힘·펴기 중 골반·무릎·발목이 모두 보여야 합니다. 의자나 반대쪽 다리에 가리지 않게 촬영합니다.';
    meaning = '180° − 골반–무릎–발목 내각. 일직선이면 약 0°입니다.';
    caution = '무릎의 안팎 회전·과신전을 평가하지 않습니다. 앉은 기록과 선 기록은 따로 비교합니다.';
  } else if (metric.endsWith('ankle')) {
    setup = '카메라를 옆에 두고 정강이부터 발끝까지 화면에 크게 담으세요. 각도 계산에는 무릎·발목·뒤꿈치·발끝만 씁니다. 점이 잘 안 잡히면 다리와 발이 프레임 안에 모두 있는지, 바짓단이나 의자에 가려지지 않았는지 확인하세요.';
    meaning = '발목→무릎 선분과 뒤꿈치→발끝 선분 사이 각도입니다. 중립 자세가 약 90°로 보일 수 있습니다.';
    caution = '발 선분이 짧아 가림·해상도에 민감합니다. 임상적 배굴/저굴 각도가 아니며 안팎 뒤집기나 발가락 ROM은 측정하지 않습니다.';
  } else {
    setup = '몸통과 허벅지의 상대 굽힘을 관찰합니다. 어깨·골반·무릎이 보여야 합니다.';
    meaning = '180° − 어깨–골반–무릎 내각. 고관절 주변 움직임의 참고값입니다.';
    caution = '골반 기울기와 허리 움직임이 섞이므로 골반을 고정한 독립 고관절 ROM으로 해석하지 않습니다.';
  }
  const landmarkNames = { 11: '왼쪽 어깨', 12: '오른쪽 어깨', 13: '왼쪽 팔꿈치', 14: '오른쪽 팔꿈치', 15: '왼쪽 손목', 16: '오른쪽 손목', 23: '왼쪽 골반', 24: '오른쪽 골반', 25: '왼쪽 무릎', 26: '오른쪽 무릎', 27: '왼쪽 발목', 28: '오른쪽 발목', 29: '왼쪽 뒤꿈치', 30: '오른쪽 뒤꿈치', 31: '왼쪽 발끝', 32: '오른쪽 발끝' };
  const calculationPoints = definition.points.map((id) => landmarkNames[id]);
  const orientationPoints = metric.endsWith('ankle') ? [] : view === 'front' ? ['양쪽 어깨', '양쪽 골반'] : [`${side} 어깨`, `${side} 골반`];
  return { title: definition.label, view, framing, setup, meaning, caution, calculationPoints, orientationPoints,
    orientationWhy: metric.endsWith('ankle') ? '어깨·골반은 포즈 탐지를 돕는 화면 안내점이며 각도 계산에는 쓰지 않습니다. 실제 발목 각도는 무릎·발목·뒤꿈치·발끝 네 점으로 계산합니다.' : '어깨·골반은 촬영 방향과 몸이 충분히 크게 보이는지 확인하는 데만 씁니다.' };
}

const GUIDE_NAMES = { 11: '왼쪽 어깨', 12: '오른쪽 어깨', 13: '왼쪽 팔꿈치', 14: '오른쪽 팔꿈치', 15: '왼쪽 손목', 16: '오른쪽 손목', 23: '왼쪽 골반', 24: '오른쪽 골반', 25: '왼쪽 무릎', 26: '오른쪽 무릎', 27: '왼쪽 발목', 28: '오른쪽 발목', 29: '왼쪽 뒤꿈치', 30: '오른쪽 뒤꿈치', 31: '왼쪽 발끝', 32: '오른쪽 발끝' };

export function renderLandmarkGuide(metric) {
  const definition = METRICS[metric], guide = jointGuide(metric);
  if (!definition || !guide) return '';
  if (metric.endsWith('ankle')) {
    const side = metric.startsWith('left_') ? '왼쪽' : '오른쪽';
    const suffix = side === '왼쪽' ? 'l' : 'r';
    return `<div class="rom-landmark-guide rom-landmark-guide--ankle" role="img" aria-label="${e(guide.title)} 측면 안내. 각도 계산점은 무릎, 발목, 뒤꿈치, 발끝입니다. 정강이부터 발끝까지 크게 화면에 담으세요.">
      <div class="rom-landmark-figure"><svg viewBox="0 0 440 230" aria-hidden="true" focusable="false">
        <defs><marker id="rom-guide-arrow-${suffix}" markerWidth="8" markerHeight="8" refX="6" refY="4" orient="auto"><path d="M0 0 8 4 0 8z" fill="#54747b"/></marker></defs>
        <rect class="ankle-camera-card" x="12" y="12" width="110" height="54" rx="12"/><text class="ankle-kicker" x="24" y="31">촬영 방향</text><text class="ankle-label" x="24" y="50">${side} 옆면</text>
        <path class="ankle-direction" d="M125 39h54" marker-end="url(#rom-guide-arrow-${suffix})"/>
        <path class="ankle-leg-shape" d="M202 39 C211 42 220 49 229 57 L278 134 C283 142 282 151 276 156 C270 161 260 159 255 151 L207 83 C201 75 192 69 183 67 L151 59 C143 57 139 50 142 43 C146 34 157 31 166 33 Z"/>
        <path class="ankle-foot-shape" d="M266 151 C273 149 280 150 286 154 L306 166 C318 172 336 174 365 173 C376 173 385 178 385 184 C385 191 374 194 363 195 L286 201 C273 202 261 196 255 186 L244 168 Z"/>
        <line class="ankle-measure-segment" x1="151" y1="49" x2="268" y2="151"/><line class="ankle-measure-segment" x1="263" y1="178" x2="371" y2="184"/>
        <path class="ankle-angle-arc" d="M243 126 A38 38 0 0 1 305 174"/><text class="ankle-angle-label" x="296" y="135">두 선분 사이 각도</text>
        <g class="ankle-point"><circle cx="151" cy="49" r="13"/><text x="151" y="53">1</text></g><text class="ankle-label" x="77" y="91">무릎</text>
        <g class="ankle-point"><circle cx="268" cy="151" r="13"/><text x="268" y="155">2</text></g><text class="ankle-label" x="287" y="151">발목</text>
        <g class="ankle-point"><circle cx="263" cy="178" r="13"/><text x="263" y="182">3</text></g><text class="ankle-label" x="230" y="222">뒤꿈치</text>
        <g class="ankle-point"><circle cx="371" cy="184" r="13"/><text x="371" y="188">4</text></g><text class="ankle-label" x="347" y="219">발끝</text>
      </svg></div>
      <div class="rom-landmark-copy"><b>각도는 초록 네 점으로 계산해요</b><ol class="ankle-point-legend"><li><b>무릎</b><span>정강이 선의 위쪽</span></li><li><b>발목</b><span>정강이와 발이 만나는 지점</span></li><li><b>뒤꿈치</b><span>발바닥 선의 뒤쪽</span></li><li><b>발끝</b><span>발바닥 선의 앞쪽</span></li></ol><small>정강이부터 발끝까지 선명하게 보이게 하세요. 바짓단·양말·의자에 발목이나 뒤꿈치가 가려지면 점을 찾기 어려워집니다.</small><p class="rom-landmark-context"><span aria-hidden="true"></span><span><b>촬영 팁</b>옆면에서 다리와 발을 화면 안에 크게 담아 주세요.</span></p></div>
    </div>`;
  }
  const list = definition.points.map((id) => `<li>${e(GUIDE_NAMES[id] ?? '관절점')}</li>`).join('');
  return `<div class="rom-landmark-guide" role="img" aria-label="${e(guide.title)} 촬영 안내. 실제 계산점: ${e(guide.calculationPoints.join(', '))}."><div class="rom-landmark-copy"><b>각도 계산에 쓰는 관절점</b><ol>${list}</ol><small>${e(guide.framing)}</small></div></div>`;
}

export function renderJointGuide(metric) {
  const g = jointGuide(metric); if (!g) return '';
  return `<div class="rom-joint-guide-heading"><strong>${e(g.title)}</strong><span>${VIEWS[g.view]} 촬영</span></div><p>${e(g.setup)}</p><dl><dt>표시 각도</dt><dd>${e(g.meaning)}</dd><dt>해석 주의</dt><dd>${e(g.caution)}</dd></dl><small>15초 동안 유효하게 관찰한 각도의 P95−P05를 기록합니다. 최대 가동범위 검사·치료 처방이 아닙니다.</small>`;
}

export function renderLiveJointMetrics(view, selected) {
  const metrics = selected?.endsWith('_ankle') ? [[selected, METRICS[selected]]] : metricsForView(view);
  return metrics.map(([id, m]) => `<div class="rom-metric ${selected === id ? 'is-selected' : ''}"><span>${e(m.label)}</span><strong data-rom-angle="${id}">—</strong></div>`).join('');
}
