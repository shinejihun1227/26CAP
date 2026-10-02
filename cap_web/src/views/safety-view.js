import { renderTopbar } from '../components/topbar.js';
import { renderBilateralHeatmap } from '../components/bilateral-heatmap.js';
import { renderObservationPanel } from '../components/observation-panel.js';

export function renderSafetyView(state, { embedded = false } = {}) {
  const content = `<section class="sensor-workspace">
    <header class="sensor-page-heading"><div><span class="simple-eyebrow">발바닥 센서 관찰</span><h1>압력·온습도</h1><p>양발에서 들어오는 센서값을 한눈에 확인하세요.</p></div><button type="button" data-view="records" data-record-section="sensors">센서 기록 저장 · 비교 →</button></header>
    ${renderBilateralHeatmap(state)}
    ${state.easyMode ? '' : renderObservationPanel(state, Date.now(), 'health')}
    <div class="sensor-page-notes"><article><h2>압력이 실린 위치</h2><p>앞쪽·가운데·뒤꿈치의 상대 압력을 봅니다. 앞뒤 중심과 오래 쏠린 기록은 오늘 요약에서 확인해요.</p><button class="text-button" type="button" data-view="overview">압력 중심 · AI 안내 →</button></article><article><h2>온도와 습도</h2><p>위에서 온도 또는 습도를 선택하세요. 연결된 센서값과 양발 차이를 표시해요.</p></article><article><h2>기록으로 남기기</h2><p>데이터관리에서 저장을 시작하면 압력·온습도 변화를 날짜별로 비교하고 내려받을 수 있어요.</p></article></div>
    <details class="simple-details"><summary>표시값을 읽는 방법</summary><p>압력은 ADC를 환산한 상대값이며 체중이나 힘 단위가 아닙니다. 온습도는 발바닥 센서 위치의 관찰값으로, 질환이나 낙상 위험을 판정하지 않습니다.</p><p>2센서 구성은 원본 센서를 공유하는 표시이고, 4센서 구성은 독립 채널입니다. 센서 위치와 연결 정보는 히트맵 아래에서 확인하세요.</p></details>
  </section>`;
  return embedded ? content : `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${content}</main></div>`;
}
