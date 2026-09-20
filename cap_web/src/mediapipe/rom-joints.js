import { METRICS, VIEWS, metricsForView } from './rom-math.js';
import { escapeHtml as e } from '../utils/text.js';

// Keep the observation protocol explicit; these are not treatment prescriptions.
export const JOINT_GROUPS = [
  { id: 'shoulder', label: '어깨', metrics: ['left_shoulder', 'right_shoulder', 'left_shoulder_flexion', 'right_shoulder_flexion'] },
  { id: 'elbow', label: '팔꿈치', metrics: ['left_elbow', 'right_elbow'] },
  { id: 'knee', label: '무릎', metrics: ['left_knee', 'right_knee'] },
  { id: 'ankle', label: '발목', metrics: ['left_ankle', 'right_ankle'] },
  { id: 'hip', label: '고관절 주변 · 몸통–허벅지', metrics: ['left_hip', 'right_hip'] },
];

export function resolveJointSelection(metric, view, changed = 'view') {
  const safeView = Object.hasOwn(VIEWS, view) ? view : 'front';
  if (changed === 'metric' && METRICS[metric]) return { metric, view: METRICS[metric].views.includes(safeView) ? safeView : METRICS[metric].views[0] };
  if (METRICS[metric]?.views.includes(safeView)) return { metric, view: safeView };
  // Switching left/right retains the joint/motion, rather than silently switching to ankle.
  const counterpart = typeof metric === 'string' ? metric.replace(/^(left|right)_/, `${safeView}_`) : '';
  if (METRICS[counterpart]?.views.includes(safeView)) return { metric: counterpart, view: safeView };
  const fallback = safeView === 'front' ? 'left_shoulder' : `${safeView}_ankle`;
  return { metric: fallback, view: safeView };
}

export function renderJointOptions(selected = 'left_shoulder') {
  return JOINT_GROUPS.map((group) => `<optgroup label="${e(group.label)}">${group.metrics.map((id) => `<option value="${id}"${id === selected ? ' selected' : ''}>${e(METRICS[id].label)} · ${VIEWS[METRICS[id].views[0]]}</option>`).join('')}</optgroup>`).join('');
}

export function jointGuide(metric) {
  const definition = METRICS[metric];
  if (!definition) return null;
  const side = metric.startsWith('left_') ? '왼쪽' : '오른쪽';
  const framing = definition.views[0] === 'front'
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
    setup = '무릎·발목·뒤꿈치·발끝이 충분히 크게 보여야 합니다. 정강이와 발의 상대 움직임을 관찰합니다.';
    meaning = '발목→무릎 선분과 뒤꿈치→발끝 선분 사이 각도입니다. 중립 자세가 약 90°로 보일 수 있습니다.';
    caution = '발 선분이 짧아 가림·해상도에 민감합니다. 임상적 배굴/저굴 각도가 아니며 안팎 뒤집기나 발가락 ROM은 측정하지 않습니다.';
  } else {
    setup = '몸통과 허벅지의 상대 굽힘을 관찰합니다. 어깨·골반·무릎이 보여야 합니다.';
    meaning = '180° − 어깨–골반–무릎 내각. 고관절 주변 움직임의 참고값입니다.';
    caution = '골반 기울기와 허리 움직임이 섞이므로 골반을 고정한 독립 고관절 ROM으로 해석하지 않습니다.';
  }
  return { title: definition.label, view: definition.views[0], framing, setup, meaning, caution };
}

export function renderJointGuide(metric) {
  const g = jointGuide(metric); if (!g) return '';
  return `<div class="rom-joint-guide-heading"><strong>${e(g.title)}</strong><span>${VIEWS[g.view]} 촬영</span></div><p>${e(g.setup)}</p><dl><dt>표시 각도</dt><dd>${e(g.meaning)}</dd><dt>해석 주의</dt><dd>${e(g.caution)}</dd></dl><small>15초 동안 유효하게 관찰한 각도의 P95−P05를 기록합니다. 최대 가동범위 검사·치료 처방이 아닙니다.</small>`;
}

export function renderLiveJointMetrics(view, selected) {
  return metricsForView(view).map(([id, m]) => `<div class="rom-metric ${selected === id ? 'is-selected' : ''}"><span>${e(m.label)}</span><strong data-rom-angle="${id}">—</strong></div>`).join('');
}
