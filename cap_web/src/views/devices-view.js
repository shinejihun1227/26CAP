import { icon } from '../components/icons.js';
import { renderTopbar } from '../components/topbar.js';
import { renderInsoleConnections } from '../components/insole-connection.js';
import { escapeHtml } from '../utils/text.js';
function item(label, detail, ready) { return `<div><b>${label}</b><small>${detail}</small><em class="${ready ? 'is-ready' : 'is-warning'}">${ready ? '정상' : '확인 필요'}</em></div>`; }
export function renderDevicesView(state) {
  const sensors = state.hardware?.sensors ?? {}, demo = state.dataSource !== 'esp32';
  const thermalCount = sensors.thermal?.count ?? (demo ? 4 : 0), total = sensors.thermal?.total ?? 4;
  const connected = demo || state.connected;
  const battery = typeof state.device.battery === 'number' && Number.isFinite(state.device.battery) ? state.device.battery : null;
  const side = state.rehab?.config?.activeFoot === 'right' ? '오른발' : '왼발';
  return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">
    <section class="subpage-heading"><div><span class="eyebrow">HARDWARE & CONNECTION</span><h1>기기 관리</h1><p>한 발당 압력 4개·온습도 4개·IMU 1개를 확인합니다.</p></div><button class="control-button" data-action="refresh">${icon('activity')} 새로고침</button></section>
    ${renderInsoleConnections(state, { configure: true })}
    <section class="device-hero"><div class="device-visual"><div class="device-glow"></div>${icon('shoe')}</div><div><span class="live-badge ${connected ? '' : 'is-disconnected'}"><i></i>${demo ? 'DEMO' : connected ? 'CONNECTED' : 'OFFLINE'}</span><h2>${escapeHtml(state.device.name)}</h2><p>마지막 동기화 ${escapeHtml(state.device.lastSync)} · 분석·출력 대상 ${side}</p></div><div class="device-battery"><span>BATTERY</span><strong>${battery === null ? '--' : `${battery}%`}</strong><small>${battery === null ? '배터리 잔량 측정 회로 미연결' : '배터리 잔량'}</small></div></section>
    <section class="device-grid"><article class="panel"><div class="panel-heading"><div><span class="panel-kicker">SENSOR CHECK</span><h2>센서 구성</h2></div></div><div class="hardware-list">
      ${item(`${side} 압력 센서`, '한 발 4개 · MUX C0·2·4·6', sensors.pressure?.ready ?? demo)}
      ${item(`온·습도 유효값 · ${thermalCount}/${total}`, '한 발 4개 · I²C MUX CH3·4·5·6', sensors.thermal?.ready ?? demo)}
      ${item(`${side} 움직임 센서`, 'BMI270 · 6축 IMU', sensors.imu?.ready ?? demo)}</div><p class="hardware-note">${state.hardware?.bilateralAvailable ? '양발 압력값으로 좌우 비교 중입니다. 정확한 체중이 아닌 상대 압력입니다.' : '양발 압력값이 모두 유효해야 좌우 비교가 가능합니다.'}</p></article>
      <article class="panel setup-panel"><div class="panel-heading"><div><span class="panel-kicker">OUTPUT CUEING</span><h2>${side} 안내 출력</h2></div></div><p>테스트 명령은 선택한 발에만 전달합니다. 연결이 끊긴 발에는 명령을 보내지 않습니다.</p><div class="device-actions"><button class="outline-button" data-action="test-vibration">진동 테스트</button><button class="outline-button" data-action="test-laser">레이저 테스트</button></div><p class="hardware-note">04번의 레이저는 안전을 위해 기본 비활성화되어 있습니다. 자동 진동은 RF/CNN 결과가 아닌 프로토타입 규칙이며 기본 꺼짐입니다.</p></article></section>
    </main></div>`;
}
