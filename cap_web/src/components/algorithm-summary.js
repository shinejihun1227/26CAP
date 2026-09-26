import { icon } from "./icons.js";
import { analyzeFog, analyzeThermalDifference } from "../data/gait-algorithms.js";
import { aiPresentation } from './ai-status-card.js';
import { escapeHtml } from "../utils/text.js";

function number(value, digits = 0, suffix = "") {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed)
    ? `${parsed.toFixed(digits)}${suffix}`
    : `--${suffix}`;
}

function toneClass(tone) {
  return tone ? `tone-${tone}` : "tone-sky";
}

export function renderSystemPipeline(state, { compact = false } = {}) {
  const isReal = state.dataSource === "esp32";
  const ai = state.ai ?? {};
  const model = ai.model === "rf" ? "Random Forest" : ai.model === "cnn" ? "1D-CNN" : "RF + 1D-CNN";
  const source = isReal ? "ESP32 /api/state" : "로컬 시연 데이터";
  const aiState = state.aiEnabled === false ? "AI 분석 꺼짐" : ai.available ? (ai.ready ? "추론 연결됨" : "브리지 준비 필요") : "브리지 연결 대기";
  const steps = [
    { index: "01", label: "센서 수집", detail: "움직임 64Hz 목표 · 압력·온습도", tone: "mint" },
    { index: "02", label: "창 구성·보정", detail: `${ai.windowSec ?? 4}초 창 · ${ai.hopSec ?? 0.5}초 간격`, tone: "sky" },
    { index: "03", label: "AI 분석 (선택)", detail: state.aiEnabled === false ? '현재 사용 안 함' : `${model} · FoG 3단계`, tone: "lavender" },
    { index: "04", label: "재활 지표", detail: twoSensorProfile ? "전체 하중 · 움직임 · 발 상태" : "하중 · CoP · 착지 · 추진", tone: "orange" },
    { index: "05", label: "안내 출력", detail: "레이저 · 진동 · 음성", tone: "coral" },
  ];

  return `<section class="system-pipeline ${compact ? "is-compact" : ""}">
    <div class="system-pipeline-heading">
      <div><span class="section-overline">SYSTEM FLOW</span><h2>센서가 안내로 바뀌는 과정</h2><p>한 화면에서 현재 데이터의 출처와 처리 단계를 확인합니다.</p></div>
      <span class="system-source"><i></i><b>${escapeHtml(source)}</b><small>${escapeHtml(aiState)}</small></span>
    </div>
    <div class="system-pipeline-steps">${steps.map((step, index) => `<div class="system-pipeline-step ${toneClass(step.tone)}"><span>${step.index}</span><strong>${step.label}</strong><small>${step.detail}</small>${index < steps.length - 1 ? `<i>${icon("arrow")}</i>` : ""}</div>`).join("")}</div>
    <p class="system-pipeline-footnote">AI FoG 모델은 PC 수집 서버에 쌓인 유효 IMU 샘플을 분석하고, 웹은 최신 판정 결과를 표시합니다. 재활 보조 지표와 MediaPipe 개인화 기준은 별도 레이어로 함께 사용합니다.</p>
  </section>`;
}

export function renderAlgorithmSummary(state) {
  const twoSensorProfile = state.hardware?.sensorProfile === 'two-shared';
  const fog = analyzeFog({ imu: state.imu, pressure: state.pressure, cadence: state.metrics?.cadence, twoSensorProfile });
  const thermal = analyzeThermalDifference(state.thermal);
  const rehab = state.rehab ?? {};
  const rehabMetrics = rehab.metrics ?? {};
  const alerts = rehab.alerts?.length ?? 0;
  const ai = state.ai ?? {};
  const presentation = aiPresentation(state);
  const aiStatus = presentation.meta.label;
  const aiScore = presentation.score === null ? '—' : Math.round(presentation.score * 100);
  const aiSource = 'PC RF + CNN 모델 판정';

  return `<section class="algorithm-summary-section">
    <div class="section-heading-row"><div><span class="section-overline">ALGORITHM SNAPSHOT</span><h2>현재 적용 중인 판단 모듈</h2></div><button class="clarity-link-button" data-view="safety">전체 판단 근거 보기 ${icon("arrow")}</button></div>
    <div class="algorithm-summary-grid">
      <article class="algorithm-summary-card is-fog"><div class="algorithm-summary-top"><span class="algorithm-summary-icon">${icon("activity")}</span><span class="algorithm-summary-status ${toneClass(fog.stateTone)}">${escapeHtml(aiStatus)}</span></div><h3>보행동결 FoG</h3><p>센서 데이터로 계산한 모델 판정 점수입니다. 분석 준비 전에는 점수를 표시하지 않습니다.</p><div class="algorithm-summary-value"><strong>${aiScore}</strong><span>/ 100 score</span></div><small>${escapeHtml(aiSource)} · ${ai.windowSec ?? 4}초 창 · ${ai.hopSec ?? 0.5}초 hop</small></article>
      <article class="algorithm-summary-card is-rehab"><div class="algorithm-summary-top"><span class="algorithm-summary-icon">${icon("shoe")}</span><span class="algorithm-summary-status ${toneClass(alerts ? "orange" : "mint")}">${alerts ? `${alerts}건 관찰` : "안정"}</span></div><h3>재활 보행 지표</h3><p>${twoSensorProfile ? "압력 2개 센서의 총량만 사용합니다. 위치별 CoP·착지·추진 분석은 표시하지 않습니다." : "FSR406 4채널과 BMI270로 하중, 압력중심, 착지·추진·발 들림을 계산합니다."}</p><div class="algorithm-summary-metrics"><span><b>${number(rehabMetrics.loadDifferencePct, 0, "%")}</b><small>좌우 하중 차이</small></span><span><b>${number(rehabMetrics.cop?.active?.x, 2)}</b><small>CoP 좌우</small></span><span><b>${number(rehabMetrics.fatigueScore, 0, "/4")}</b><small>피로 지표</small></span></div><small>${rehab.calibration?.status === "ready" ? "개인 기준선 사용 중" : "기준선 생성 필요"} · 최근 반복 관찰 기반</small></article>
      <article class="algorithm-summary-card is-thermal"><div class="algorithm-summary-top"><span class="algorithm-summary-icon">${icon("sun")}</span><span class="algorithm-summary-status ${toneClass(thermal.stageTone)}">${escapeHtml(thermal.stageLabel)}</span></div><h3>발 상태 차이</h3><p>SHTC3 같은 부위의 양발 온도·습도를 비교해 비대칭 변화를 단계적으로 관찰합니다.</p><div class="algorithm-summary-metrics"><span><b>${number(thermal.meanTemperatureDelta, 1, "°C")}</b><small>평균 온도 차이</small></span><span><b>${number(thermal.maxTemperatureDelta, 1, "°C")}</b><small>최대 온도 차이</small></span><span><b>${number(thermal.maxHumidityDelta, 0, "%")}</b><small>최대 습도 차이</small></span></div><small>정상 &lt; 1°C · 관찰 1–2°C · 우선 확인 ≥ 2°C</small></article>
    </div>
  </section>`;
}
