import { icon } from './icons.js';
import { escapeHtml as e } from '../utils/text.js';

// Shared introductions on the welcome screen and home: all features are available.
export const APP_FEATURES = [
  {
    id: 'fog', view: 'live', icon: 'activity', tag: 'BMI270 + 학습된 AI',
    title: '보행동결 감지',
    summary: '양발을 보정하고, AI 점수로 보행동결 신호를 확인해요.',
    description: '양발 BMI를 보정한 뒤, 학습된 AI가 FoG 점수와 연속 신호로 보행동결을 알려요.',
    steps: ['양발 보정', 'AI 분석', '팝업·음성 알림'],
    note: 'FoG는 걸음을 떼기 어려운 보행동결을 뜻해요.',
    action: '보행동결 확인',
  },
  {
    id: 'ankle', view: 'ankle', icon: 'shoe', tag: '왼발·오른발 각각 기록',
    title: '발 움직임 범위 알림',
    summary: '내 발의 기울기 기준을 기록하고, 범위를 넘은 순간을 살펴요.',
    description: '양발의 편안한 범위를 각각 기록하고, 기준을 넘은 발·시각·기울기 방향을 확인해요.',
    steps: ['내 범위 기록', '착용 중 비교', '이탈 기록 확인'],
    note: '현재는 발의 기울기 기준이며, 실제 발목 관절 ROM과 달라요.',
    action: '양발 범위 기록',
  },
  {
    id: 'front', view: 'mediapipe', icon: 'camera', tag: 'MediaPipe 정면 카메라',
    title: '보행 자세 돌아보기',
    summary: '정면 카메라로 골반선과 몸통 기울기의 변화를 살펴요.',
    description: '발목·무릎·골반을 함께 보며, 골반 높이 차이와 몸통 기울기의 변화를 살펴요.',
    steps: ['정면 촬영', '관절점 확인', '자세 변화 관찰'],
    note: '처음 자세와 비교해요. 카메라 영상은 저장하지 않아요.',
    action: '정면 보행 보기',
  },
];

export function renderAppFeatures({ navigation = false, fogStatus = '', compact = false } = {}) {
  return `<ol class="app-feature-list ${navigation ? 'has-navigation' : ''}" aria-label="StepOn의 세 가지 기능">${APP_FEATURES.map((feature, i) => `
    <li class="app-feature app-feature-${feature.id}">
      <div class="app-feature-symbol" aria-hidden="true">${icon(feature.icon)}<span>${i+1}</span></div>
      <div class="app-feature-copy">${compact ? '' : `<span class="app-feature-tag">${feature.tag}</span>`}<h3>${feature.title}</h3>
        <p>${compact ? feature.summary : feature.description}</p>
        ${compact ? '' : `<div class="app-feature-flow">${feature.steps.map((step, index) => `${index ? '<i aria-hidden="true">→</i>' : ''}<span>${step}</span>`).join('')}</div><small>${feature.note}</small>`}
        ${navigation ? `<button type="button" data-view="${feature.view}">${feature.action}${feature.id === 'fog' && fogStatus ? `<span class="app-feature-status">${e(fogStatus)}</span>` : ''}${icon('arrow')}</button>` : ''}
      </div>
    </li>`).join('')}</ol>`;
}

export function renderFeatureScope() {
  return `<details class="app-feature-scope"><summary>측정 범위와 움직임 주의점</summary>
    <p>발 움직임은 PC와 센서가 연결된 동안 정지에 가까운 구간을 비교합니다. 방향은 센서 장착 축 기준이며, 보도블록 등 외력의 원인이나 발 안쪽·바깥쪽 꺾임을 확정하지 않습니다.</p>
    <p>ROM은 관절 가동범위입니다. 현재 발에 부착한 BMI만으로는 실제 발목 ROM·부상 위험·스트레칭의 안전 한계를 정할 수 없습니다. 기록한 최대값을 스트레칭 목표로 삼지 마세요.</p>
    <p>정면 카메라는 골반선 높이와 몸통 기울기를 관찰합니다. 골반 회전이나 잘못된 보행을 진단하거나 자동으로 교정하지 않습니다.</p>
  </details>`;
}
