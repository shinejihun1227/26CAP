import { icon } from "../components/icons.js";
import { renderTopbar } from "../components/topbar.js";

function statusLabel(ready) {
  return ready ? "정상" : "확인 필요";
}

function hardwareItem(iconName, label, detail, ready) {
  return `<div><span class="hardware-icon">${icon(iconName)}</span><b>${label}</b><small>${detail}</small><em class="${ready ? "is-ready" : "is-warning"}">${statusLabel(ready)}</em></div>`;
}

export function renderDevicesView(state) {
  const sensors = state.hardware?.sensors ?? {};
  const pressureReady = sensors.pressure?.ready ?? true;
  const thermalReady = sensors.thermal?.ready ?? true;
  const imuReady = sensors.imu?.ready ?? true;
  const thermalCount = sensors.thermal?.count ?? 4;
  const connected = state.dataSource !== "esp32" || state.connected;
  const connectionLabel = connected ? "CONNECTED" : "OFFLINE";
  const connectionClass = connected ? "" : "is-disconnected";
  const battery = Number.isFinite(Number(state.device.battery)) ? Number(state.device.battery) : 0;

  return `<div class="page-shell">${renderTopbar(state)}<main class="content-area"><section class="subpage-heading"><div><span class="eyebrow">HARDWARE & CONNECTION</span><h1>기기 관리</h1><p>연결 상태와 센서 구성을 확인하고, 필요한 테스트를 실행하세요.</p></div><button class="control-button" data-action="scan">${icon("plus")} 새 기기 연결</button></section><section class="device-hero"><div class="device-visual"><div class="device-glow"></div>${icon("shoe")}</div><div><span class="live-badge ${connectionClass}"><i></i> ${connectionLabel}</span><h2>${state.device.name}</h2><p>마지막 동기화 ${state.device.lastSync} · 배터리 ${battery}%</p><div class="device-actions"><button class="primary-button" data-action="refresh">연결 테스트 ${icon("arrow")}</button><button class="outline-button" data-action="settings">기기 설정</button></div></div><div class="device-battery"><span>BATTERY</span><strong>${battery}%</strong><div class="battery-track"><i style="width:${battery}%"></i></div><small>배터리 정보가 없는 보드에서는 0%로 표시됩니다.</small></div></section><section class="device-grid"><article class="panel"><div class="panel-heading"><div><span class="panel-kicker">HARDWARE MAP · PER INSOLE</span><h2>센서 구성</h2></div></div><div class="hardware-list">${hardwareItem("shoe", "압력 센서", "FSR406 8개 · 아날로그 MUX", pressureReady)}${hardwareItem("sun", `온·습도 센서 · ${thermalCount}/4`, "SHTC3 · I²C MUX", thermalReady)}${hardwareItem("activity", "움직임 센서", "BMI270 1개 · 6축 IMU", imuReady)}</div><p class="hardware-note">${state.hardware?.bilateralAvailable ? "양발 데이터가 연결되어 좌우 비교 중입니다." : "현재 한쪽 깔창 기준으로 측정 중입니다. 양발을 연결하면 좌우 비교가 가능합니다."}</p></article><article class="panel setup-panel"><div class="panel-heading"><div><span class="panel-kicker">OUTPUT CUEING</span><h2>안내 출력 테스트</h2></div></div><div class="output-row"><span class="output-dot coral"></span><div><b>레이저 모듈</b><small>다음 발 디딤 기준점 안내</small></div><span class="output-status">${state.outputs.laser ? "켜짐" : "대기"}</span></div><div class="output-row"><span class="output-dot lavender"></span><div><b>진동 모터</b><small>사용자에게 촉각 경고</small></div><span class="output-status">${sensors.drv2605?.ready ? (state.outputs.vibration ? "켜짐" : "대기") : "미감지"}</span></div><button class="text-button" data-action="learn-more">출력 동작 원리 보기 ${icon("arrow")}</button></article></section></main></div>`;
}
