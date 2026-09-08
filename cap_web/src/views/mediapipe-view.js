import { icon } from "../components/icons.js";
import { renderTopbar } from "../components/topbar.js";
import { escapeHtml } from "../utils/text.js";

const SETTINGS_KEY = "stepon-cap-web-mediapipe-settings";
const defaults = {
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

function loadSettings() {
  try {
    return { ...defaults, ...(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") ?? {}) };
  } catch {
    return defaults;
  }
}

function checked(value) {
  return value ? "checked" : "";
}

export function renderMediaPipeView(state) {
  const settings = loadSettings();
  return `<div class="page-shell">
    ${renderTopbar(state)}
    <main class="content-area">
      <section class="subpage-heading mediapipe-heading"><div><span class="eyebrow">PERSONAL SETTINGS</span><h1>개인화 설정</h1><p>사용자 기준값을 설정하면 보행과 발 디딤 관찰을 나에게 맞출 수 있어요.</p></div><span class="research-badge"><span class="status-dot"></span>설정 준비됨</span></section>
      <section class="mediapipe-hero"><div class="mediapipe-hero-icon">${icon("camera")}</div><div><span class="panel-kicker">OPTIONAL CAMERA ANALYSIS</span><h2>개인 기준값 설정</h2><p>키·다리 길이·보행 보조기 사용 여부를 기준으로 발 디딤 위치와 보행 관찰 기준을 조정합니다. 카메라 연결은 아직 준비 단계입니다.</p></div><button class="outline-button" type="button" data-action="calibrate">기준선 다시 잡기 ${icon("arrow")}</button></section>
      <section class="mediapipe-grid">
        <article class="panel mediapipe-camera-card"><div class="panel-heading"><div><span class="panel-kicker">CAMERA PREVIEW</span><h2>자세 기준 화면</h2></div><span class="camera-status"><i></i> 연결 전</span></div><div class="camera-placeholder"><div class="camera-placeholder-icon">${icon("camera")}</div><b>카메라를 연결하면 여기에 표시돼요</b><small>처리 가능한 랜드마크: 어깨 · 골반 · 무릎 · 발목 · 발끝</small></div><div class="camera-privacy"><span>${icon("shield")}</span><p>영상 원본은 저장하지 않고, 필요한 관절 좌표만 분석하는 방향으로 설계합니다.</p></div></article>
        <article class="panel personalization-card"><div class="panel-heading"><div><span class="panel-kicker">USER BASELINE</span><h2>개인 기준값</h2></div><span class="round-icon">${icon("check")}</span></div><div class="personal-form"><label>키 (cm)<input type="number" min="100" max="230" data-personal-setting="height" value="${escapeHtml(settings.height)}" /></label><label>다리 안쪽 길이 (cm)<input type="number" min="40" max="120" data-personal-setting="legLength" value="${escapeHtml(settings.legLength)}" /></label><label>신발 길이 (mm)<input type="number" min="180" max="360" data-personal-setting="shoeSize" value="${escapeHtml(settings.shoeSize)}" /></label><label>주 사용 발<select data-personal-setting="dominantSide"><option value="right" ${settings.dominantSide === "right" ? "selected" : ""}>오른발</option><option value="left" ${settings.dominantSide === "left" ? "selected" : ""}>왼발</option></select></label><label>보행 보조기<select data-personal-setting="walkingAid"><option value="none" ${settings.walkingAid === "none" ? "selected" : ""}>사용하지 않음</option><option value="cane" ${settings.walkingAid === "cane" ? "selected" : ""}>지팡이</option><option value="walker" ${settings.walkingAid === "walker" ? "selected" : ""}>워커</option></select></label></div></article>
      </section>
      <section class="panel personalization-options"><div class="panel-heading"><div><span class="panel-kicker">ANALYSIS OPTIONS</span><h2>분석에 반영할 항목</h2></div><span class="panel-description">개인정보 보호를 우선해요.</span></div><div class="personal-option-grid"><label class="personal-toggle"><input type="checkbox" data-personal-setting="posture" ${checked(settings.posture)} /><span><b>자세 정렬 보정</b><small>골반·무릎·발목의 개인 기준선을 사용</small></span></label><label class="personal-toggle"><input type="checkbox" data-personal-setting="stride" ${checked(settings.stride)} /><span><b>보폭·발끝 방향 보정</b><small>레이저 기준점의 위치 계산에 반영</small></span></label><label class="personal-toggle"><input type="checkbox" data-personal-setting="localOnly" ${checked(settings.localOnly)} /><span><b>기기 안에서만 처리</b><small>랜드마크 데이터를 서버로 보내지 않음</small></span></label></div><div class="confidence-row"><label for="confidence">랜드마크 신뢰도 기준 <b>${settings.confidence}%</b></label><input id="confidence" type="range" min="40" max="95" step="5" value="${settings.confidence}" data-personal-setting="confidence" /></div><div class="retention-row"><label>분석 요약 보관 기간<select data-personal-setting="retention"><option value="7" ${settings.retention === "7" ? "selected" : ""}>7일</option><option value="30" ${settings.retention === "30" ? "selected" : ""}>30일</option><option value="90" ${settings.retention === "90" ? "selected" : ""}>90일</option></select></label><p>이 설정은 발바닥 히트맵과 FoG 관찰 알고리즘의 개인화 입력으로 사용할 수 있습니다.</p></div></section>
      <p class="medical-disclaimer">MediaPipe와 StepOn의 결과는 보행 관찰과 사용자 안내를 위한 보조 정보입니다. 파킨슨병·당뇨병을 진단하거나 예방한다고 보장하지 않으며 의료진의 판단을 대신하지 않습니다.</p>
    </main>
  </div>`;
}

export function saveMediaPipeSetting(key, value) {
  const current = loadSettings();
  const next = { ...current, [key]: value };
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* local storage is optional */ }
  return next;
}
