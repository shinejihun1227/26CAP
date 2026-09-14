import { icon } from "../components/icons.js";
import { renderBilateralHeatmap } from "../components/bilateral-heatmap.js";
import { renderTopbar } from "../components/topbar.js";
import { renderAiStatusCard } from "../components/ai-status-card.js";
import { renderInsoleConnections } from '../components/insole-connection.js';

function healthRow(label, detail, ready) {
  return `<div class="clarity-health-row ${ready ? "" : "is-waiting"}"><i></i><div><b>${label}</b><small>${detail}</small></div><strong>${ready ? "정상" : "확인 필요"}</strong></div>`;
}

function display(value, digits = 1, suffix = "") {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? `${parsed.toFixed(digits)}${suffix}` : `--${suffix}`;
}

export function renderLiveView(state) {
  const sensors = state.hardware?.sensors ?? {};
  const sampleHz = state.hardware?.sampleHz ?? (state.dataSource === "esp32" ? 64 : 25);
  const auxSampleHz = state.hardware?.auxSampleHz ?? 20;
  const streamTitle = state.dataSource === "esp32"
    ? state.connected ? "실제 ESP32 센서 스트림" : "ESP32 연결을 확인하세요"
    : "로컬 시연 센서 스트림";

  return `
    <div class="page-shell clarity-page">
      ${renderTopbar(state)}
      <main class="content-area clarity-content">
        <section class="clarity-page-intro">
          <div><span class="eyebrow">LIVE MEASUREMENT</span><h1>실시간 측정</h1><p>현재 들어오는 센서 신호와 AI 상태만 보여드려요.</p></div>
          <div class="clarity-live-rate"><b>${sampleHz}Hz</b><small>IMU 목표 주기</small></div>
        </section>

        <section class="clarity-live-hero">
          <div><span class="clarity-live-badge"><i></i>${state.paused ? "측정 일시정지" : state.connected ? "측정 중" : "연결 대기"}</span><h2>${state.paused ? "측정을 잠시 멈췄어요" : streamTitle}</h2><p>마지막 수신 ${state.device.lastSync} · frame ${state.tick ?? 0}</p></div>
          <div class="clarity-live-values"><span><b>${display(state.metrics.temperature, 1, "°C")}</b><small>온도</small></span><span><b>${display(state.metrics.humidity, 1, "%")}</b><small>습도</small></span><span><b>${display(state.metrics.cadence, 0)}</b><small>spm</small></span></div>
          <button class="clarity-primary-button" data-action="toggle-pause">${icon(state.paused ? "play" : "pause")} ${state.paused ? "측정 재생" : "측정 일시정지"}</button>
        </section>

        ${renderInsoleConnections(state)}
        ${renderAiStatusCard(state)}

        <section class="clarity-section-heading"><div><span class="eyebrow">SENSOR SIGNALS</span><h2>센서 신호</h2></div><span>IMU ${sampleHz}Hz · 압력·온습도 보조 ${auxSampleHz}Hz</span></section>
        <section class="clarity-live-grid">
          <div class="panel clarity-heatmap-card">${renderBilateralHeatmap(state)}</div>
          <article class="panel clarity-health-card"><div class="panel-heading"><div><span class="panel-kicker">CONNECTION CHECK</span><h2>연결 상태</h2></div><span class="clarity-status-chip ${state.connected ? "is-ready" : "is-waiting"}">${state.connected ? "연결됨" : "대기"}</span></div><div class="clarity-health-list">${healthRow("BMI270 움직임", "선택한 발 · 가속도·자이로", sensors.imu?.ready ?? state.dataSource !== 'esp32')}${healthRow("FSR406 압력", "선택한 발 · C0·2·4·6", sensors.pressure?.ready ?? state.dataSource !== 'esp32')}${healthRow("SHTC3 온·습도", `${sensors.thermal?.count ?? (state.dataSource === 'esp32' ? 0 : 4)}/${sensors.thermal?.total ?? 4}개 유효값 · 보조 신호`, sensors.thermal?.ready ?? state.dataSource !== 'esp32')}${healthRow("진동 모터", "선택한 발 · 안내 출력부", sensors.drv2605?.ready ?? false)}</div><button class="clarity-link-button" data-view="devices">기기 상태 자세히 보기 ${icon("arrow")}</button></article>
        </section>

        <section class="clarity-signal-note"><span>${icon("activity")}</span><div><b>지금 보고 있는 값</b><p>센서 원본은 실시간 화면에서 확인하고, 왜 이런 판단이 나왔는지는 분석 센터에서 확인할 수 있어요.</p></div><button class="clarity-link-button" data-view="safety">분석 센터로 이동 ${icon("arrow")}</button></section>
        <p class="medical-disclaimer">실시간 화면은 센서 상태를 확인하기 위한 참고 정보입니다. AI 결과는 연구용 보조 정보이며 의료적 진단이 아닙니다.</p>
      </main>
    </div>
  `;
}
