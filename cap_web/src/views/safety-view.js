import { icon } from "../components/icons.js";
import { renderTopbar } from "../components/topbar.js";
import { renderRehabPanel } from "../components/rehab-panel.js";
import { renderAiStatusCard } from "../components/ai-status-card.js";
import { analyzeFog, analyzeThermalDifference, buildCuePlan } from "../data/gait-algorithms.js";
import { renderSystemPipeline } from "../components/algorithm-summary.js";

function stagePill(label, tone) {
  return `<span class="algorithm-pill pill-${tone}"><i></i>${label}</span>`;
}

function display(value, digits = 1, suffix = "") {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? `${parsed.toFixed(digits)}${suffix}` : `--${suffix}`;
}

function thermalRows(result) {
  const used = new Set();
  return result.readings.filter((reading) => {
    const key = reading.shared ? `shared:${reading.sharedSensorNumber}` : `${reading.sensorIndexLeft ?? reading.short}:${reading.sensorIndexRight ?? reading.short}`;
    if (used.has(key)) return false;
    used.add(key); return true;
  }).map((reading) => {
    const deltaTone = reading.temperatureDelta === null
      ? "unavailable"
      : reading.temperatureDelta >= 2 ? "high" : reading.temperatureDelta >= 1 ? "mid" : "low";
    return `<div class="thermal-row"><div><b>${reading.shared ? `온습도 센서 ${reading.sharedSensorNumber}` : reading.label}</b><small>${reading.shared ? "실제 센서값 · 양발 비교" : reading.short}</small></div><span>${display(reading.leftTemp, 1, "°")}</span><span>${display(reading.rightTemp, 1, "°")}</span><strong class="delta-${deltaTone}">${display(reading.temperatureDelta, 1, "°")}</strong></div>`;
  }).join("");
}

function featureRow(label, value, tone = "lavender") {
  return `<div class="feature-row"><span>${label}</span><div class="feature-track"><i class="feature-${tone}" style="width:${value}%"></i></div><b>${value}%</b></div>`;
}

export function renderSafetyView(state, { embedded = false } = {}) {
  const thermal = analyzeThermalDifference(state.thermal);
  const twoSensorProfile = state.hardware?.sensorProfile === 'two-shared';
  const fog = analyzeFog({ imu: state.imu, pressure: state.pressure, cadence: state.metrics.cadence, twoSensorProfile });
  const cue = buildCuePlan({ fog, thermal, outputs: state.outputs });
  const outputState = (enabled) => enabled ? "켜짐" : "꺼짐";
  const thermalCount = state.hardware?.sensors?.thermal?.count ?? 4;
  const twoSensorProfile = state.hardware?.sensorProfile === 'two-shared';
  const comparisonReady = thermal.stage !== "unavailable";
  const outputNote = state.dataSource === "esp32"
    ? "ESP32 출력 API 연결됨 · 레이저는 펌웨어 안전 설정에 따라 비활성화될 수 있습니다."
    : "ESP32 연결 모드에서는 실제 출력 API가 호출되고, 연결 전에는 브라우저에서 시뮬레이션합니다.";

  return `${embedded ? "" : `<div class="page-shell">
    ${renderTopbar(state)}
    <main class="content-area">`}
      <section class="subpage-heading"><div><span class="eyebrow">GAIT ANALYSIS CENTER</span><h1>보행 분석 센터</h1><p>결과만 보여주지 않고, 어떤 신호를 보고 판단했는지 함께 보여드려요.</p></div><span class="research-badge">연구용 분석</span></section>
      <section class="safety-notice"><span>${icon("shield")}</span><p><b>이 화면은 진단 결과가 아니에요.</b> 보행동결, 압력 이동, 양발 온·습도 차이를 관찰하는 연구용 보조 화면입니다. 각 카드에서 측정값과 판단 근거를 확인할 수 있어요.</p></section>
      ${renderSystemPipeline(state)}
      ${renderAiStatusCard(state)}
      ${renderRehabPanel(state)}
      <section class="algorithm-grid">
        <article class="panel algorithm-card thermal-algorithm">
          <div class="panel-heading"><div><span class="panel-kicker">발 상태 01 · SHTC3 · ${thermalCount}개 응답</span><h2>발 상태 차이</h2></div>${stagePill(thermal.stageLabel, thermal.stageTone)}</div>
          <p class="panel-description">${twoSensorProfile ? "각 발 2개 물리 센서의 값을 짝으로 비교합니다. 공유 표시 부위는 같은 센서값이며, 비교 통계는 물리 센서별 한 번만 반영합니다." : comparisonReady ? "왼발과 오른발의 같은 부위 센서를 짝지어 온도·습도 차이를 계산합니다." : "현재 한쪽 깔창만 연결되어 있어 양발 센서가 모두 연결되면 비교를 시작합니다."}</p>
          <div class="thermal-overview"><div><strong>${display(thermal.meanTemperatureDelta, 1, "°C")}</strong><span>평균 온도 차이</span></div><div><strong>${display(thermal.maxTemperatureDelta, 1, "°C")}</strong><span>최대 온도 차이</span></div><div><strong>${display(thermal.maxHumidityDelta, 0, "%")}</strong><span>최대 습도 차이</span></div></div>
          <div class="thermal-table"><div class="thermal-head"><span>부위</span><span>왼발</span><span>오른발</span><span>차이</span></div>${thermalRows(thermal)}</div>
          <div class="threshold-line"><span>정상 &lt; 1.0°C</span><i></i><span>관찰 1–2°C</span><i></i><span>우선 &gt; 2°C</span></div><small class="algorithm-disclaimer">${thermal.disclaimer}</small>
        </article>
        <article class="panel algorithm-card fog-algorithm">
          <div class="panel-heading"><div><span class="panel-kicker">보행동결 02 · BMI270 + FSR406</span><h2>센서 규칙 참고 지표</h2></div>${stagePill(fog.stateLabel, fog.stateTone)}</div>
          <p class="panel-description">${twoSensorProfile ? "2개 센서 모드에서는 압력 위치 변화가 실제 4개 위치 측정이 아니므로 FoG 보조 점수에서 제외합니다. 움직임·보행 리듬을 참고하며 최종 AI 판단은 위 모델 카드에 표시됩니다." : "움직임·보행 리듬·압력의 규칙 기반 참고값입니다. 최종 AI 판단은 위 모델 카드에 표시됩니다."}</p>
          <div class="fog-score-row"><div class="fog-score"><strong>${state.dataSource === "esp32" ? "—" : Math.round(fog.score * 100)}</strong><span>/ 100</span></div><div><b>${fog.state === "walking" ? "현재 보행 흐름이 안정적이에요" : "걸음의 변화를 관찰하고 있어요"}</b><p>Freeze Index <strong>${fog.features.freezeIndex}</strong><br />${fog.method}</p></div></div>
          <div class="feature-list">${featureRow("동결 대역 비율", fog.features.freezeBandScore, "lavender")}${featureRow("보행 리듬 저하", fog.features.cadenceDrop, "coral")}${featureRow("압력 이동 정체", fog.features.pressureStall, "mint")}${featureRow("회전 움직임 변화", fog.features.gyroBurst, "sky")}</div><small class="algorithm-disclaimer">${fog.disclaimer}</small>
        </article>
      </section>
      <section class="panel cue-panel">
        <div class="panel-heading"><div><span class="panel-kicker">안내 03 · CUE CONTROLLER</span><h2>다음 행동 안내</h2></div><label class="switch-label"><span>자동 안내</span><input type="checkbox" data-output="auto" ${state.outputs.auto ? "checked" : ""} /><i></i></label></div>
        <div class="cue-recommendation"><span class="recommendation-icon">${icon(cue.laser ? "cue" : cue.vibration ? "activity" : "check")}</span><div><b>${cue.reason}</b><p>${cue.message ?? "다음 이벤트가 감지되면 안내 방법을 이곳에서 확인할 수 있어요."}</p></div><button class="outline-button" data-action="test-all">안내 테스트 ${icon("arrow")}</button></div>
        <div class="output-controls"><button class="output-control ${state.outputs.laser ? "is-on" : ""}" data-output="laser"><span class="output-control-icon coral">${icon("cue")}</span><span><b>레이저 모듈</b><small>다음 발 디딤 기준점</small></span><strong>${outputState(state.outputs.laser)}</strong></button><button class="output-control ${state.outputs.vibration ? "is-on" : ""}" data-output="vibration"><span class="output-control-icon lavender">${icon("activity")}</span><span><b>진동 모터</b><small>촉각 경고 · MOSFET</small></span><strong>${outputState(state.outputs.vibration)}</strong></button><button class="output-control ${state.outputs.voice ? "is-on" : ""}" data-output="voice"><span class="output-control-icon mint">${icon("bell")}</span><span><b>음성 안내</b><small>Web Speech API · 한국어</small></span><strong>${outputState(state.outputs.voice)}</strong></button></div>
        <div class="cue-test-row"><button class="text-button" data-action="test-laser">레이저 테스트</button><button class="text-button" data-action="test-vibration">진동 테스트</button><button class="text-button" data-action="test-voice">음성 듣기 ${icon("arrow")}</button><span>${outputNote}</span></div>
      </section>
      <section class="algorithm-footer"><div><b>보정 포인트</b><span>사용자별 안정 온도 기준선 · BMI270 샘플링 주파수 · FSR 압력 캘리브레이션</span></div><button class="subtle-button" data-action="calibrate">기준선 다시 잡기 ${icon("arrow")}</button></section>
    ${embedded ? "" : `</main>
  </div>`}`;
}
