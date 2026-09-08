import { icon } from "../components/icons.js";
import { renderBilateralHeatmap } from "../components/bilateral-heatmap.js";
import { renderRehabPanel } from "../components/rehab-panel.js";
import { renderSparkline, renderProgress } from "../components/charts.js";
import { getAiStatusMeta } from "../components/ai-status-card.js";
import { cueOptions, navItems, observationGoals, riskLabel } from "../data/dashboard-data.js";
import { analyzeFog, analyzeThermalDifference, buildCuePlan } from "../data/gait-algorithms.js";
import { saveMediaPipeSetting } from "../views/mediapipe-view.js";
import { escapeHtml, formatDateLabel } from "../utils/text.js";

const MEDIA_PIPE_SETTINGS_KEY = "stepon-cap-web-mediapipe-settings";
const mediaPipeDefaults = {
  height: 168,
  legLength: 78,
  shoeSize: 260,
  dominantSide: "right",
  walkingAid: "none",
  confidence: 70,
  posture: true,
  stride: true,
  localOnly: true,
  retention: "30",
};

function loadMediaPipeSettings() {
  try {
    return { ...mediaPipeDefaults, ...(JSON.parse(window.localStorage.getItem(MEDIA_PIPE_SETTINGS_KEY) ?? "null") ?? {}) };
  } catch {
    return mediaPipeDefaults;
  }
}

function checked(value) {
  return value ? "checked" : "";
}

function display(value, digits = 1) {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed.toFixed(digits) : "--";
}

function sensorHealth(state) {
  const sensors = state.hardware?.sensors ?? {};
  return {
    pressure: sensors.pressure?.ready ?? true,
    thermal: sensors.thermal?.ready ?? true,
    thermalCount: sensors.thermal?.count ?? 4,
    imu: sensors.imu?.ready ?? true,
    drv: sensors.drv2605?.ready ?? false,
  };
}

function mobileHeader(state, activeView) {
  const name = escapeHtml(state.profile?.name ?? "사용자");
  const title = navItems.find((item) => item.id === activeView)?.korean ?? "오늘의 요약";
  const isEsp32 = state.dataSource === "esp32";
  const connectionLabel = isEsp32 ? (state.connected ? "ESP32 연결됨" : "ESP32 끊김") : "로컬 시연";
  return `<header class="mobile-header"><div class="mobile-header-top"><div class="mobile-brand-lockup"><div class="brand-mark">S</div><div><strong>STEPON</strong><span>GAIT CARE SYSTEM</span></div></div><button class="mobile-profile-button" type="button" data-action="profile" aria-label="프로필 수정"><span>${name.slice(0, 1)}</span>${icon("chevron")}</button></div><div class="mobile-context-row"><div><span class="mobile-context-kicker">${escapeHtml(title)}</span><strong>${formatDateLabel()}</strong></div><span class="mobile-connection"><i></i> ${connectionLabel}</span></div></header>`;
}

function mobileTabbar(activeView) {
  return `<nav class="mobile-tabbar" aria-label="모바일 주요 메뉴">${navItems.map((item) => `<button type="button" class="mobile-tab ${activeView === item.id ? "is-active" : ""}" data-view="${item.id}" aria-current="${activeView === item.id ? "page" : "false"}">${icon(item.icon)}<span>${item.id === "overview" ? "요약" : item.id === "live" ? "실시간" : item.id === "safety" ? "분석" : item.id === "reports" ? "리포트" : item.id === "devices" ? "기기" : "개인화"}</span></button>`).join("")}</nav>`;
}

function mobileShell(state, activeView, body) {
  return `<div class="mobile-app">${mobileHeader(state, activeView)}<main class="mobile-main">${body}</main>${mobileTabbar(activeView)}</div>`;
}

function mobileSectionHeading(eyebrow, title, description = "") {
  return `<section class="mobile-section-heading"><span class="eyebrow">${eyebrow}</span><h1>${title}</h1>${description ? `<p>${description}</p>` : ""}</section>`;
}

function mobileMetric(label, value, unit, tone, iconName, description) {
  return `<article class="mobile-metric-card tone-${tone}"><div class="mobile-metric-top"><span>${label}</span><i>${icon(iconName)}</i></div><strong>${value}<small>${unit}</small></strong><p>${description}</p></article>`;
}

function mobileAiCard(state) {
  const ai = state.ai ?? {};
  const meta = getAiStatusMeta(ai.status);
  const score = ai.score !== null && ai.score !== undefined && Number.isFinite(Number(ai.score))
    ? Math.max(0, Math.min(1, Number(ai.score)))
    : null;
  const scoreLabel = score === null ? "--" : Math.round(score * 100);
  const connection = ai.available ? (ai.ready ? "실시간 추론 연결됨" : "브리지 연결됨") : "AI 브리지 연결 대기";
  return `<section class="mobile-panel mobile-ai-card"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">AI FOG DETECTOR · ${(ai.model ?? "ensemble").toUpperCase()}</span><h2>AI 보행동결 탐지</h2></div><span class="mobile-stage-pill tone-${meta.tone}">${meta.label}</span></div><div class="mobile-ai-summary"><strong>${scoreLabel}</strong><div><b>${meta.detail}</b><small>${connection} · ${ai.windowSec ?? 4}초 창 · ${ai.hopSec ?? 0.5}초 간격</small></div></div><div class="mobile-ai-track"><i style="width:${score === null ? 0 : Math.round(score * 100)}%"></i></div><small class="mobile-algorithm-disclaimer">연구용 모델 결과이며 의료적 진단이 아닙니다.</small></section>`;
}

function mobileOverview(state) {
  const status = riskLabel(state.metrics.risk);
  const name = escapeHtml(state.profile?.name ?? "사용자");
  const focus = escapeHtml((state.profile?.goals ?? []).map((id) => observationGoals.find((goal) => goal.id === id)?.label).filter(Boolean).join(" · ") || "일상 보행 기록");
  const balanceAvailable = state.metrics.balance !== null && state.metrics.balance !== undefined && Number.isFinite(Number(state.metrics.balance));
  const balance = balanceAvailable ? display(state.metrics.balance, 0) : "--";
  return `${mobileSectionHeading("TODAY AT A GLANCE", `안녕하세요, ${name}님`, `지금 꼭 필요한 정보만 간단히 보여드려요. · ${focus}`)}
    ${mobileAiCard(state)}
    <section class="mobile-status-card"><div><span class="mobile-card-kicker">오늘의 보행 상태 <em><i></i> LIVE</em></span><h2>오늘 보행은<br /><b>${status.label}</b>이에요.</h2><p>${status.tone === "mint" ? "현재까지 큰 변화 없이 안정적인 흐름을 보이고 있어요." : "보행 리듬이나 체중 이동의 변화를 조금 더 살펴볼게요."}</p><button class="mobile-primary-button" type="button" data-view="live">실시간 측정 보기 ${icon("arrow")}</button></div><div class="mobile-risk-score"><strong>${state.metrics.risk}</strong><span>주의<br />점수</span></div></section>
    <section class="mobile-metrics-grid" aria-label="오늘의 핵심 수치">${mobileMetric("오늘 걸음 수", state.metrics.steps.toLocaleString("ko-KR"), "steps", "coral", "activity", "어제보다 활발해요")}${mobileMetric("좌우 균형", balance, balanceAvailable ? "%" : "", "mint", "shoe", balanceAvailable ? "양발 하중 분배" : "오른발 센서 필요")}${mobileMetric("발바닥 온도", display(state.metrics.temperature), "°C", "lavender", "sun", "SHTC3 평균값")}${mobileMetric("보행 리듬", state.metrics.cadence, "spm", "sky", "activity", "분당 걸음 수")}</section>
    <section class="mobile-panel mobile-overview-next"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">지금 할 일</span><h2>${status.tone === "mint" ? "현재 흐름을 유지하세요" : "실시간 신호를 먼저 확인하세요"}</h2></div></div><p>${status.tone === "mint" ? "보행 리듬과 좌우 하중을 계속 관찰하고 있어요." : "변화가 감지되면 실시간 화면에서 원인을 확인할 수 있어요."}</p><button class="mobile-link-button" type="button" data-view="safety">판단 근거 보기 ${icon("arrow")}</button></section>
    <section class="mobile-panel mobile-events-card"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">RECENT SIGNALS</span><h2>최근 알림</h2></div><button class="mobile-link-button" type="button" data-view="reports">전체 보기 ${icon("arrow")}</button></div><div class="mobile-event-list">${(state.events ?? []).slice(0, 3).map((event) => `<div class="mobile-event-row"><span class="mobile-event-time">${event.time}</span><span class="mobile-event-icon tone-${event.tone}">${icon(event.icon)}</span><div><b>${event.title}</b><small>${event.detail}</small></div></div>`).join("")}</div></section>
    <p class="mobile-disclaimer">StepOn은 보행 상태 관찰을 돕는 생활 보조 도구입니다. 의료적 진단을 대신하지 않습니다.</p>`;
}

function mobileLive(state) {
  const health = sensorHealth(state);
  const sampleHz = state.hardware?.sampleHz ?? (state.dataSource === "esp32" ? 64 : 25);
  const streamTitle = state.dataSource === "esp32"
    ? state.connected ? "실제 ESP32 센서 스트림" : "ESP32 연결을 확인하세요"
    : "로컬 시연 센서 스트림";
  return `${mobileSectionHeading("LIVE MEASUREMENT", "실시간 측정", "현재 들어오는 센서 신호와 AI 상태만 보여드려요.")}${mobileAiCard(state)}<button class="mobile-secondary-button mobile-pause-button" type="button" data-action="toggle-pause">${icon(state.paused ? "play" : "pause")} ${state.paused ? "측정 재생" : "측정 일시정지"}</button>
    <section class="mobile-stream-card"><div><span class="mobile-card-kicker"><i></i> ${state.paused ? "PAUSED" : state.connected ? "STREAMING" : "OFFLINE"}</span><h2>${state.paused ? "측정을 잠시 멈췄어요" : streamTitle}</h2><p>마지막 수신 ${state.device.lastSync} · 샘플링 ${sampleHz} Hz · frame ${state.tick ?? 0}</p></div><div class="mobile-stream-stats"><span><b>${display(state.metrics.temperature)}°</b><small>온도</small></span><span><b>${display(state.metrics.humidity)}%</b><small>습도</small></span><span><b>${state.metrics.cadence}</b><small>spm</small></span></div></section>
    <section class="mobile-panel mobile-heatmap-card">${renderBilateralHeatmap(state)}</section>
    <section class="mobile-panel"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">SENSOR HEALTH · PER INSOLE</span><h2>센서 상태</h2></div><span class="mobile-ok-badge">${state.connected ? "연결됨" : "확인 필요"}</span></div><div class="mobile-health-list"><div class="${health.pressure ? "" : "is-waiting"}"><i></i><b>FSR406 × 8</b><small>아날로그 MUX · 한쪽 깔창</small><em>${health.pressure ? "정상" : "확인 필요"}</em></div><div class="${health.thermal ? "" : "is-waiting"}"><i></i><b>SHTC3 × 4 · ${health.thermalCount}개 응답</b><small>I²C MUX · 없는 채널은 --</small><em>${health.thermal ? "정상" : "확인 필요"}</em></div><div class="${health.imu ? "" : "is-waiting"}"><i></i><b>BMI270 × 1</b><small>6축 움직임 센서</small><em>${health.imu ? "정상" : "확인 필요"}</em></div><div class="is-waiting"><i></i><b>진동 모터</b><small>MOSFET 출력부</small><em>${health.drv ? "대기" : "미감지"}</em></div></div><button class="mobile-outline-button" type="button" data-action="refresh">센서 상태 새로고침 ${icon("arrow")}</button></section>
    <section class="mobile-panel mobile-pipeline"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">SIGNAL PIPELINE</span><h2>보행 신호 처리 단계</h2></div></div><div class="mobile-pipeline-list"><span class="is-done"><b>01</b>센서 입력<small>FSR · SHTC3 · BMI270</small></span><span class="is-done"><b>02</b>필터링<small>노이즈 제거</small></span><span class="is-active"><b>03</b>상태 분석<small>균형 · 리듬 · FoG</small></span><span><b>04</b>큐잉 출력<small>레이저 · 진동</small></span></div></section>`;
}

function mobileSafety(state) {
  const thermal = analyzeThermalDifference(state.thermal);
  const fog = analyzeFog({ imu: state.imu, pressure: state.pressure, cadence: state.metrics.cadence });
  const cue = buildCuePlan({ fog, thermal, outputs: state.outputs });
  const format = (value, digits = 1, suffix = "") => value !== null && value !== undefined && Number.isFinite(Number(value)) ? `${Number(value).toFixed(digits)}${suffix}` : `--${suffix}`;
  return `${mobileSectionHeading("GAIT ANALYSIS CENTER", "보행 분석 센터", "결과뿐 아니라 어떤 신호를 보고 판단했는지 함께 보여드려요.")}${mobileAiCard(state)}<section class="mobile-notice"><span>${icon("shield")}</span><p><b>진단 결과가 아니에요.</b> 보행동결, 압력 이동, 양발 온·습도 차이를 관찰하는 연구용 보조 화면입니다.</p></section>
    ${renderRehabPanel(state)}
      <section class="mobile-panel mobile-algorithm-card mobile-thermal-card"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">발 상태 01 · SHTC3 × 8</span><h2>발 상태 차이</h2></div><span class="mobile-stage-pill">${thermal.stageLabel}</span></div><p>${thermal.stage === "unavailable" ? "오른발 센서가 연결되면 좌우 비교를 시작합니다." : "같은 부위의 왼발·오른발 온도와 습도 차이를 비교합니다."}</p><div class="mobile-algorithm-stats"><div><strong>${format(thermal.meanTemperatureDelta, 1, "°C")}</strong><small>평균 온도 차이</small></div><div><strong>${format(thermal.maxTemperatureDelta, 1, "°C")}</strong><small>최대 온도 차이</small></div><div><strong>${format(thermal.maxHumidityDelta, 0, "%")}</strong><small>최대 습도 차이</small></div></div><div class="mobile-thermal-list">${thermal.readings.map((reading) => `<div><span>${reading.label}</span><b>${format(reading.leftTemp, 1, "°")} / ${format(reading.rightTemp, 1, "°")}</b><em>${format(reading.temperatureDelta, 1, "°")}</em></div>`).join("")}</div><small class="mobile-algorithm-disclaimer">${thermal.disclaimer}</small></section>
      <section class="mobile-panel mobile-algorithm-card mobile-fog-card"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">보행동결 02 · BMI270 + FSR406</span><h2>보행동결 가능성</h2></div><span class="mobile-stage-pill tone-lavender">${fog.stateLabel}</span></div><p>동결 대역, 보행 리듬, 압력 이동 정체를 함께 관찰합니다.</p><div class="mobile-fog-summary"><div class="mobile-fog-score"><strong>${Math.round(fog.score * 100)}</strong><span>/ 100</span></div><div><b>Freeze Index ${fog.features.freezeIndex}</b><small>${fog.method}</small></div></div><div class="mobile-feature-list"><div><span>동결 대역 비율</span><b>${fog.features.freezeBandScore}%</b></div><div><span>보행 리듬 저하</span><b>${fog.features.cadenceDrop}%</b></div><div><span>압력 이동 정체</span><b>${fog.features.pressureStall}%</b></div><div><span>회전 움직임 변화</span><b>${fog.features.gyroBurst}%</b></div></div><small class="mobile-algorithm-disclaimer">${fog.disclaimer}</small></section>
     <section class="mobile-panel mobile-cue-card"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">안내 03 · CUE CONTROLLER</span><h2>다음 행동 안내</h2></div><label class="mobile-switch"><input type="checkbox" data-output="auto" ${state.outputs.auto ? "checked" : ""} /><i></i></label></div><div class="mobile-cue-summary"><span>${icon(cue.laser ? "cue" : cue.vibration ? "activity" : "check")}</span><div><b>${cue.reason}</b><p>${cue.message ?? "다음 이벤트가 감지되면 안내 방법을 확인할 수 있어요."}</p></div></div><div class="mobile-output-list"><button class="mobile-output-control ${state.outputs.laser ? "is-on" : ""}" type="button" data-output="laser"><span>${icon("cue")}</span><b>레이저 모듈</b><small>다음 발 디딤 기준점</small><em>${state.outputs.laser ? "켜짐" : "꺼짐"}</em></button><button class="mobile-output-control ${state.outputs.vibration ? "is-on" : ""}" type="button" data-output="vibration"><span>${icon("activity")}</span><b>진동 모터</b><small>촉각 경고 · MOSFET</small><em>${state.outputs.vibration ? "켜짐" : "꺼짐"}</em></button><button class="mobile-output-control ${state.outputs.voice ? "is-on" : ""}" type="button" data-output="voice"><span>${icon("bell")}</span><b>음성 안내</b><small>한국어 음성 안내</small><em>${state.outputs.voice ? "켜짐" : "꺼짐"}</em></button></div><button class="mobile-outline-button" type="button" data-action="test-all">안내 테스트 ${icon("arrow")}</button></section>`;
}

function mobileReports(state) {
  const balanceAvailable = state.metrics.balance !== null && state.metrics.balance !== undefined && Number.isFinite(Number(state.metrics.balance));
  const balance = balanceAvailable ? Number(state.metrics.balance) : "--";
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const rehabLog = state.rehabLog?.[dateKey] ?? {};
  const count = (key) => rehabLog[key] ?? 0;
  return `${mobileSectionHeading("PERSONAL REPORT", "보행 리포트", "쌓인 데이터를 돌아보고 다음 걸음을 준비해요.")}<section class="mobile-report-summary"><div><span class="mobile-card-kicker">${formatDateLabel()} · DAILY SUMMARY</span><h2>오늘은 <b>안정적인 걸음</b>이<br />가장 많았어요.</h2><p>총 ${state.metrics.steps.toLocaleString("ko-KR")}걸음 중 82%가 안정 구간이었어요.</p></div><div><strong>82</strong><span>GAIT QUALITY</span><em>+6.8%</em></div></section><section class="mobile-panel mobile-rehab-report"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">REHABILITATION LOG</span><h2>오늘의 재활 기록</h2></div><span class="mobile-value-pill">${count("feedbackCount")}회</span></div><div class="mobile-rehab-counts"><span><b>${count("steps")}</b>걸음</span><span><b>${count("loadLimitExceeded")}</b>하중 초과</span><span><b>${count("asymmetry")}</b>불균형</span><span><b>${count("fatigue")}</b>피로</span></div></section><section class="mobile-panel"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">KEY INDICATORS</span><h2>주요 지표</h2></div></div>${renderProgress("좌우 균형", balance, "mint", balanceAvailable ? "지난 기록보다 좋아졌어요" : "오른발 센서 연결 대기")}${renderProgress("안정 보행 구간", 82, "coral", "총 활동 시간 기준")}${renderProgress("센서 데이터 품질", state.dataSource === "esp32" && !state.connected ? 0 : 96, "sky", state.connected ? "연결됨" : "연결 끊김")}</section><section class="mobile-panel mobile-note-card"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">WEEKLY NOTE</span><h2>이번 주 메모</h2></div></div><div><span>월</span><p><b>보폭이 평소보다 짧았어요</b><small>42cm · 관찰</small></p></div><div><span>화</span><p><b>좌우 균형이 좋아졌어요</b><small>82% · 안정</small></p></div><div><span>오늘</span><p><b>${balanceAvailable ? "현재 좋은 흐름을 유지 중이에요" : "오른발 센서를 연결해 주세요"}</b><small>${balanceAvailable ? `${balance}% · 안정` : "좌우 비교 대기"}</small></p></div></section><p class="mobile-disclaimer">리포트는 센서 데이터의 변화 추이를 보여주는 참고 자료입니다.</p>`;
}

function mobileDevices(state) {
  const health = sensorHealth(state);
  const battery = Number.isFinite(Number(state.device.battery)) ? Number(state.device.battery) : 0;
  const connected = state.dataSource !== "esp32" || state.connected;
  return `${mobileSectionHeading("CONNECTED DEVICES", "기기 연결", "현재 연결된 StepOn 깔창과 출력부 상태를 확인해요.")}<section class="mobile-device-card"><div class="mobile-device-icon">${icon("shoe")}</div><div><span class="mobile-card-kicker"><i></i> ${connected ? "CONNECTED" : "OFFLINE"}</span><h2>${state.device.name}</h2><p>마지막 동기화 ${state.device.lastSync}</p></div><div class="mobile-device-battery"><span>BATTERY</span><strong>${battery}%</strong><i><b style="width:${battery}%"></b></i></div></section><section class="mobile-panel"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">HARDWARE MAP · PER INSOLE</span><h2>한쪽 깔창 구성</h2></div></div><div class="mobile-hardware-list"><div>${icon("shoe")}<b>압력 센서<small>FSR406 8개 · 아날로그 MUX</small></b><em>${health.pressure ? "정상" : "확인 필요"}</em></div><div>${icon("sun")}<b>온·습도 센서<small>SHTC3 ${health.thermalCount}/4 · I²C MUX</small></b><em>${health.thermal ? "정상" : "확인 필요"}</em></div><div>${icon("activity")}<b>움직임 센서<small>BMI270 1개 · 6축 IMU</small></b><em>${health.imu ? "정상" : "확인 필요"}</em></div></div><p class="mobile-hardware-note">${state.hardware?.bilateralAvailable ? "양발 데이터가 연결되어 좌우 비교 중입니다." : "현재 오른발 데이터가 없어 오른발 히트맵은 연결 대기 상태입니다."}</p></section><section class="mobile-panel"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">OUTPUT CUEING</span><h2>출력 안내</h2></div></div><div class="mobile-output-row"><i class="tone-coral"></i><b>레이저 모듈<small>다음 발 디딤 기준점</small></b><em>${state.outputs.laser ? "켜짐" : "대기"}</em></div><div class="mobile-output-row"><i class="tone-lavender"></i><b>진동 모터<small>사용자 촉각 경고</small></b><em>${health.drv ? "대기" : "미감지"}</em></div><button class="mobile-link-button" type="button" data-action="learn-more">출력 동작 원리 보기 ${icon("arrow")}</button></section>`;
}

function mobileMediaPipe(state) {
  const settings = loadMediaPipeSettings();
  return `${mobileSectionHeading("MEDIAPIPE PERSONALIZATION", "나에게 맞는 보행 기준", "자세·보폭 분석과 발 디딤 안내에 사용할 개인 기준값을 설정해요.")}<section class="mobile-personal-hero"><span>${icon("camera")}</span><div><span class="mobile-card-kicker">POSE LANDMARKER</span><h2>개인화 캘리브레이션</h2><p>영상 원본은 저장하지 않고 필요한 관절 좌표만 사용하는 방향으로 설계합니다.</p></div></section><section class="mobile-panel mobile-personal-form"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">USER BASELINE</span><h2>개인 기준값</h2></div><span class="mobile-ok-badge">저장됨</span></div><label>키 (cm)<input type="number" min="100" max="230" data-personal-setting="height" value="${escapeHtml(settings.height)}" /></label><label>다리 안쪽 길이 (cm)<input type="number" min="40" max="120" data-personal-setting="legLength" value="${escapeHtml(settings.legLength)}" /></label><label>신발 길이 (mm)<input type="number" min="180" max="360" data-personal-setting="shoeSize" value="${escapeHtml(settings.shoeSize)}" /></label><label>주 사용 발<select data-personal-setting="dominantSide"><option value="right" ${settings.dominantSide === "right" ? "selected" : ""}>오른발</option><option value="left" ${settings.dominantSide === "left" ? "selected" : ""}>왼발</option></select></label><label>보행 보조기<select data-personal-setting="walkingAid"><option value="none" ${settings.walkingAid === "none" ? "selected" : ""}>사용하지 않음</option><option value="cane" ${settings.walkingAid === "cane" ? "selected" : ""}>지팡이</option><option value="walker" ${settings.walkingAid === "walker" ? "selected" : ""}>워커</option></select></label></section><section class="mobile-panel mobile-analysis-options"><div class="mobile-panel-heading"><div><span class="mobile-card-kicker">ANALYSIS OPTIONS</span><h2>분석 반영 항목</h2></div></div><label><input type="checkbox" data-personal-setting="posture" ${checked(settings.posture)} /><span><b>자세 정렬 보정</b><small>골반·무릎·발목의 기준선 사용</small></span></label><label><input type="checkbox" data-personal-setting="stride" ${checked(settings.stride)} /><span><b>보폭·발끝 방향 보정</b><small>레이저 기준점 계산에 반영</small></span></label><label><input type="checkbox" data-personal-setting="localOnly" ${checked(settings.localOnly)} /><span><b>기기 안에서만 처리</b><small>랜드마크 데이터를 서버로 보내지 않음</small></span></label><div class="mobile-range-label"><span>랜드마크 신뢰도 기준</span><b>${settings.confidence}%</b></div><input type="range" min="40" max="95" step="5" value="${settings.confidence}" data-personal-setting="confidence" /><label class="mobile-retention-label">분석 요약 보관 기간<select data-personal-setting="retention"><option value="7" ${settings.retention === "7" ? "selected" : ""}>7일</option><option value="30" ${settings.retention === "30" ? "selected" : ""}>30일</option><option value="90" ${settings.retention === "90" ? "selected" : ""}>90일</select></label></section><p class="mobile-disclaimer">MediaPipe와 StepOn의 결과는 보행 관찰과 사용자 안내를 위한 보조 정보입니다. 의료적 진단을 대신하지 않습니다.</p>`;
}

export function renderMobileApp(state, activeView) {
  const bodies = { overview: mobileOverview, live: mobileLive, safety: mobileSafety, reports: mobileReports, devices: mobileDevices, mediapipe: mobileMediaPipe };
  return mobileShell(state, activeView, (bodies[activeView] ?? mobileOverview)(state));
}

export function renderMobileOnboarding(state) {
  const profile = state.profile ?? {};
  const selectedGoals = profile.goals ?? ["daily"];
  const selectedCues = profile.preferredCues ?? ["laser", "vibration", "voice"];
  return `<div class="mobile-onboarding"><header class="mobile-onboarding-header"><div class="mobile-brand-lockup"><div class="brand-mark">S</div><div><strong>STEPON</strong><span>GAIT CARE SYSTEM</span></div></div><span>PROFILE SETUP · 01</span></header><main class="mobile-onboarding-main"><div class="mobile-progress"><i></i><span>1 / 1</span></div><span class="eyebrow">A GENTLER START</span><h1>나에게 맞는<br /><em>걸음 관찰</em>을 시작해요.</h1><p class="mobile-onboarding-lead">처음 한 번만 현재 상태와 받고 싶은 안내를 알려주세요. 선택한 목적에 맞춰 필요한 화면을 정리해드릴게요.</p><form id="profile-form" class="mobile-profile-form"><section><label for="mobile-profile-name">어떻게 불러드릴까요?</label><input id="mobile-profile-name" name="name" value="${escapeHtml(profile.name ?? "")}" placeholder="이름 또는 별명" required /><div class="mobile-input-grid"><label for="mobile-profile-age">연령<input id="mobile-profile-age" name="age" type="number" min="1" max="120" value="${escapeHtml(profile.age ?? "")}" placeholder="예: 68" required /></label><fieldset><legend>성별 <small>선택</small></legend><label><input type="radio" name="gender" value="female" ${profile.gender === "female" ? "checked" : ""} /> 여성</label><label><input type="radio" name="gender" value="male" ${profile.gender === "male" ? "checked" : ""} /> 남성</label><label><input type="radio" name="gender" value="none" ${!profile.gender || profile.gender === "none" ? "checked" : ""} /> 선택 안 함</label></fieldset></div></section><section><div class="mobile-form-section-title"><b>어떤 관찰이 필요하신가요?</b><small>복수 선택 가능</small></div><div class="mobile-goal-list">${observationGoals.map((goal) => `<label class="mobile-choice-card"><input type="checkbox" name="goals" value="${goal.id}" ${selectedGoals.includes(goal.id) ? "checked" : ""} /><span><b>${goal.label}</b><small>${goal.desc}</small></span><i>✓</i></label>`).join("")}</div></section><section><div class="mobile-form-section-title"><b>어떤 방식으로 안내받을까요?</b><small>필요한 안내만 선택할 수 있어요</small></div><div class="mobile-cue-list">${cueOptions.map((cue) => `<label class="mobile-choice-card"><input type="checkbox" name="cues" value="${cue.id}" ${selectedCues.includes(cue.id) ? "checked" : ""} /><span class="mobile-choice-icon">${icon(cue.id === "laser" ? "cue" : cue.id === "vibration" ? "activity" : "bell")}</span><span><b>${cue.label}</b><small>${cue.desc}</small></span><i>✓</i></label>`).join("")}</div></section><div class="mobile-form-actions"><button class="mobile-primary-button" type="submit">내 맞춤 화면 만들기 ${icon("arrow")}</button><button class="mobile-preview-button" type="button" data-action="preview-dashboard">프로필 입력 전 대시보드 미리보기</button></div></form><p class="mobile-disclaimer">StepOn은 보행과 발 상태를 관찰하는 보조 도구입니다. 의료적 진단을 대신하지 않습니다.</p></main></div>`;
}
