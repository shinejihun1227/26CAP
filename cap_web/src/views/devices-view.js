import { icon } from '../components/icons.js';
import { renderTopbar } from '../components/topbar.js';
import { renderInsoleConnections } from '../components/insole-connection.js';
import { renderAiDetails, renderFogCue } from '../components/ai-status-card.js';
import { renderRehabPanel } from '../components/rehab-panel.js';
import { escapeHtml } from '../utils/text.js';
function item(label, detail, ready) { return `<div><b>${label}</b><small>${detail}</small><em class="${ready ? 'is-ready' : 'is-warning'}">${ready ? '정상' : '확인 필요'}</em></div>`; }
export function renderDevicesView(state, { embedded = false } = {}) {
  const sensors = state.hardware?.sensors ?? {}, demo = state.dataSource !== 'esp32';
  const thermalCount = sensors.thermal?.count ?? (demo ? 4 : 0), total = sensors.thermal?.total ?? 4;
  const connected = demo || state.connected;
  const battery = typeof state.device.battery === 'number' && Number.isFinite(state.device.battery) ? state.device.battery : null;
  const side = state.rehab?.config?.activeFoot === 'right' ? '오른발' : '왼발';
  return `${embedded ? "" : `<div class="page-shell">${renderTopbar(state)}<main class="content-area">`}
    <section class="subpage-heading"><div><span class="eyebrow">HARDWARE & CONNECTION</span><h1>기기 설정</h1><p>왼발·오른발을 연결하고 나에게 맞는 측정 기준을 준비하세요.</p></div><button class="control-button" data-action="refresh">${icon('activity')} 새로고침</button></section>
    ${renderInsoleConnections(state, { configure: true })}
    <section class="panel">${renderFogCue(state)}</section>
    <section class="device-hero"><div class="device-visual"><div class="device-glow"></div>${icon('shoe')}</div><div><span class="live-badge ${connected ? '' : 'is-disconnected'}"><i></i>${demo ? 'DEMO' : connected ? 'CONNECTED' : 'OFFLINE'}</span><h2>${escapeHtml(state.device.name)}</h2><p>마지막 동기화 ${escapeHtml(state.device.lastSync)} · 분석·출력 대상 ${side}</p></div><div class="device-battery"><span>BATTERY</span><strong>${battery === null ? '--' : `${battery}%`}</strong><small>${battery === null ? '배터리 잔량 측정 회로 미연결' : '배터리 잔량'}</small></div></section>
    <details class="simple-details" data-ui-disclosure="device-baselines"><summary>개인 기준 설정 · AI 보정</summary>${renderAiDetails(state)}${renderRehabPanel(state)}</details>
    <details class="simple-details" data-ui-disclosure="device-hardware"><summary>센서 점검 · 진동과 레이저 테스트</summary><section class="device-grid"><article class="panel"><div class="panel-heading"><div><span class="panel-kicker">SENSOR CHECK</span><h2>센서 구성</h2></div></div><div class="hardware-list">
      ${item(`${side} 압력 센서`, '한 발 4개 · 독립 압력 채널', sensors.pressure?.ready ?? demo)}
      ${item(`온·습도 유효값 · ${thermalCount}/${total}`, '한 발 4개 · I²C MUX CH3·4·5·6', sensors.thermal?.ready ?? demo)}
      ${item(`${side} 움직임 센서`, 'BMI270 · 6축 IMU', sensors.imu?.ready ?? demo)}</div><p class="hardware-note">${state.hardware?.bilateralAvailable ? '양발 압력값으로 좌우 비교 중입니다. 정확한 체중이 아닌 상대 압력입니다.' : '양발 압력값이 모두 유효해야 좌우 비교가 가능합니다.'}</p></article>
      <article class="panel setup-panel"><div class="panel-heading"><div><span class="panel-kicker">OUTPUT CUEING</span><h2>${side} 안내 출력</h2></div></div><p>테스트 명령은 선택한 발에만 전달합니다. 연결이 끊긴 발에는 명령을 보내지 않습니다.</p><div class="device-actions"><button class="outline-button" data-action="test-vibration">진동 테스트</button><button class="outline-button" data-action="test-laser">레이저 테스트</button></div><p class="hardware-note">최신 04 / 04-2 펌웨어가 필요해요. 수동 테스트는 짧게 실행되며, 위의 자동 출력은 실제 AI 신호 감지 동안 유지돼요.</p></article></section></details><p class="simple-route-link"><button data-view="safety">전문가용 상세 분석 →</button></p>
    ${embedded ? "" : `</main></div>`}`;
}
