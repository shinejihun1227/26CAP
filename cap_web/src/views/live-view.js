import { renderTopbar } from '../components/topbar.js';
import { renderAiStatusCard } from '../components/ai-status-card.js';
import { renderInsoleConnections } from '../components/insole-connection.js';
import { renderObservationPanel } from '../components/observation-panel.js';
import { renderEasyLiveContent } from './easy-view.js';

export function renderLiveView(state, { embedded = false } = {}) {
  const content = state.easyMode ? renderEasyLiveContent(state) : `<section class="sensor-workspace">
    <header class="sensor-page-heading"><div><span class="simple-eyebrow">BMI270 · 학습된 AI</span><h1>AI 보행동결</h1><p>양발 보정 후 AI 점수와 연속 신호를 확인합니다.</p></div><button type="button" data-view="devices" data-open-disclosure="device-baselines">개인 보정 하러가기 →</button></header>
    ${renderAiStatusCard(state)}
    ${renderObservationPanel(state, Date.now(), 'fog')}
    <details class="simple-details" data-ui-disclosure="live-sensors"><summary>양발 연결과 수신 상태</summary>${renderInsoleConnections(state)}</details>
    <p class="simple-note">압력·온습도는 별도 메뉴에서 확인하세요. AI 결과는 관찰을 돕는 신호이며 의료적 진단이 아닙니다.</p>
  </section>`;
  return embedded ? content : `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${content}</main></div>`;
}
