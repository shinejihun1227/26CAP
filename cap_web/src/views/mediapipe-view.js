import { renderTopbar } from "../components/topbar.js";
import { escapeHtml } from "../utils/text.js";
import { renderSetWorkspace, renderSetReportPanel } from "../mediapipe/set-view.js";
import { renderMotionDashboard } from '../mediapipe/motion-report.js';
import { renderJointOptions, renderJointGuide } from '../mediapipe/rom-joints.js';

const SETTINGS_KEY = "stepon-cap-web-mediapipe-settings";
const defaults = { height: 168, legLength: 78, shoeSize: 260, dominantSide: "right", walkingAid: "none", confidence: 75, posture: true, stride: true, localOnly: true, retention: "30" };
function loadSettings() {
  try { return { ...defaults, ...(JSON.parse(window.localStorage.getItem(SETTINGS_KEY) ?? "null") ?? {}) }; }
  catch { return { ...defaults }; }
}
export function saveMediaPipeSetting(key, value) {
  const next = { ...loadSettings(), [key]: value };
  try { window.localStorage.setItem(SETTINGS_KEY, JSON.stringify(next)); } catch { /* optional preferences */ }
  return next;
}
export function renderMediaPipeContent({ manage = false } = {}) {
  const settings = loadSettings();
  return `<section class="rom-workspace ${manage ? "is-management" : "is-measurement"}" data-rom-root data-rom-mode="${manage ? "manage" : "measure"}">
    <header class="rom-heading"><div><span class="rom-eyebrow">${manage ? "관절 자료" : "JOINT MOTION"}</span><${manage ? "h2" : "h1"}>${manage ? "관절 기록과 측정 세트" : "관절 움직임"}</${manage ? "h2" : "h1"}><p>${manage ? "저장한 기록을 골라 세트로 묶거나 내보내세요." : "15초 동안 움직이고, 나의 이전 기록과 비교해 보세요."}</p></div><div class="rom-heading-actions"><div class="simple-route-link"><button type="button" ${manage ? 'data-view="mediapipe"' : 'data-rom-action="show-comparison"'}>${manage ? "새 관절 측정하기 →" : "기록 비교 ↓"}</button><button type="button" data-view="records" ${manage ? "hidden" : ""}>기록 · 세트 관리 →</button></div></div></header>
    <div ${manage ? "" : "hidden"}>${renderSetWorkspace()}</div>
    <div class="rom-layout motion-capture ${manage ? "rom-management-layout" : ""}" ${manage ? "hidden" : ""}>
      <section class="rom-camera-panel" aria-label="웹캠 관절 분석" ${manage ? "hidden" : ""}>
        <div class="rom-panel-head"><h2>카메라</h2><span data-rom-camera-status>카메라 대기</span></div>
        <div class="rom-video-stage" data-rom-stage><video data-rom-video autoplay muted playsinline aria-label="노트북 웹캠 영상"></video><canvas data-rom-overlay aria-label="인식된 관절 위치"></canvas><div class="rom-video-empty" data-rom-empty><img class="rom-framing-figure" src="/assets/pose-framing.svg" alt="" aria-hidden="true" /><b>관절이 잘 보이게 서거나 앉아 주세요</b><p>선택한 관절과 어깨·골반을 화면에 넣어 주세요.</p></div><span class="rom-video-label" data-rom-view-label>정면 · 좌우는 본인 기준</span></div>
        <label class="rom-consent"><input type="checkbox" data-rom-consent> 웹캠 사용에 동의합니다. 영상·음성은 저장하지 않습니다.</label>
        <div class="rom-camera-tools"><button type="button" class="rom-primary" data-rom-action="start">웹캠 켜기</button><button type="button" data-rom-action="stop" disabled>끄기</button><label><input type="checkbox" data-rom-mirror> 거울 보기</label><span data-rom-fps>분석 대기</span></div>
        <p class="rom-quality" data-rom-quality role="status">카메라를 켜고 몸 위치를 확인해 주세요.</p>
      </section>
      <section class="rom-setup-panel" aria-label="측정 설정과 기록" ${manage ? "hidden" : ""}>
        <div class="rom-panel-head"><h2>측정 준비</h2><span>선택하고, 확인하고, 시작해요</span></div>
        <ol class="motion-preparation" aria-label="관절 측정 준비 순서"><li data-rom-step="camera"><span class="step-number">1</span><b>카메라</b><small data-rom-step-state>대기</small></li><li data-rom-step="pose"><span class="step-number">2</span><b>몸 위치</b><small data-rom-step-state>대기</small></li><li data-rom-step="record"><span class="step-number">3</span><b>15초 기록</b><small data-rom-step-state>대기</small></li></ol>
        <div class="rom-form-grid motion-essential"><label class="rom-joint-field">관절·동작<select data-rom-config="metric" aria-describedby="rom-joint-help">${renderJointOptions()}</select></label><label>자세<select data-rom-config="posture"><option value="seated">앉아서</option><option value="standing">서서</option></select></label></div>
        <p id="rom-joint-help" class="rom-joint-help">관절을 고르면 필요한 촬영 방향으로 바뀌어요.</p>
        <fieldset class="rom-directions"><legend>촬영 방향</legend><label><input type="radio" name="rom-view" value="front" checked><span>정면</span></label><label><input type="radio" name="rom-view" value="left"><span>좌측면</span></label><label><input type="radio" name="rom-view" value="right"><span>우측면</span></label></fieldset>
        <p class="rom-view-guide" data-rom-guide></p>
        <label class="rom-check"><input type="checkbox" data-rom-direction-confirmed> 선택한 방향을 향했고, 화면에는 나만 있어요.</label>
        <div class="rom-record-box"><div><b data-rom-record-title>15초 움직임 기록</b><span data-rom-progress-text>0 / 15초</span></div><progress data-rom-progress max="15" value="0" aria-label="기록 진행률"></progress><p class="rom-quality" id="rom-record-help" data-rom-record-help role="status">웹캠 동의 후 카메라를 켜 주세요.</p><div class="rom-buttons"><button type="button" class="rom-primary" data-rom-action="record" aria-describedby="rom-record-help" disabled>15초 기록 시작</button><button type="button" class="rom-danger" data-rom-action="abort" disabled>중단</button></div><small>편안하게 움직이세요. 통증·어지러움이 있으면 중단하세요.</small></div>
      </section>
    </div>
    <div class="rom-notice" role="status" data-rom-notice>웹캠 사용 동의 → 카메라 켜기 → 몸 위치 확인 순서로 준비하세요.</div>
    <details class="simple-details rom-identity motion-settings" ${manage ? "open" : ""}><summary data-rom-identity>추가 설정 · 내 기록 P01</summary>
      <div class="rom-form-grid"><label>사용자 코드 (측정 코드)<input data-rom-config="participant" value="P01" maxlength="30" autocomplete="off" aria-describedby="rom-participant-note"></label><label>촬영 환경 코드<input data-rom-config="setup" value="책상-기본" maxlength="60" autocomplete="off"></label><label>관절 신뢰도 하한<select data-rom-config="confidence"><option value="0.65">65% · 낮음</option><option value="0.75" selected>75% · 기본</option><option value="0.85">85% · 엄격</option></select></label></div>
      <p id="rom-participant-note" class="rom-participant-help"><b>P01 = 한 사람의 기록 이름표</b> · 예: 본인 P01, 팀원 P02. 날짜·관절·촬영 방향이 달라도 같은 코드를 쓰세요. 카메라 위치가 바뀌면 촬영 환경 코드를 바꾸세요.</p><p class="motion-footnote">저장 버튼을 누른 각도·측정 코드는 이 PC에 30일 보관됩니다. 영상·음성은 저장하지 않습니다.</p>
      <details class="motion-more"><summary>선택한 관절의 촬영 방법과 각도 정의</summary><section class="rom-joint-guide" data-rom-joint-guide aria-label="선택 관절의 촬영 방법과 각도 정의">${renderJointGuide('left_shoulder')}</section></details>
    </details>
    <section class="motion-save-panel" data-motion-save><div><div class="rom-result" data-rom-result>아직 선택한 기록이 없습니다.</div><p class="rom-comparison" data-rom-comparison></p></div><div class="rom-buttons"><button type="button" class="rom-primary" data-rom-action="save" ${manage ? "hidden" : ""} disabled>기록 저장</button><button type="button" data-rom-action="baseline" disabled>개인 기준으로 지정</button><button type="button" data-rom-action="discard" ${manage ? "hidden" : ""} disabled>미저장 기록 버리기</button><button type="button" data-rom-action="save-alone" hidden disabled>개별 기록으로 저장</button></div></section>
    ${manage ? '<div hidden><div data-rom-chart></div><div data-rom-metrics></div></div>' : renderMotionDashboard()}
    <div ${manage ? "" : "hidden"}>${renderSetReportPanel()}</div>
    <details class="simple-details" ${manage ? "hidden" : ""}><summary>전문가용 · 외부 각도계와 비교</summary><section class="rom-validation-panel"><div class="rom-panel-head"><div><span class="rom-eyebrow">MEASUREMENT CHECK</span><h2>외부 각도계와 오차 확인</h2></div><span>선택 기능 · 임상 검증 아님</span></div><p>안전하게 같은 자세를 유지한 상태에서 추정 각도를 고정한 뒤, 외부 각도계로 동일한 선분 사이를 잰 값을 입력하세요. 관절의 정의와 촬영 평면이 다르면 비교할 수 없습니다.</p><div class="rom-validation-form"><button type="button" data-rom-action="freeze" disabled>현재 각도 고정</button><output data-rom-frozen>고정값 없음</output><label>외부 측정값 (°)<input type="number" data-rom-reference min="0" max="180" step="0.1" placeholder="직접 측정한 값"></label><label class="rom-check"><input type="checkbox" data-rom-same-pose> 같은 자세·각도 정의로 측정했습니다.</label><button type="button" data-rom-action="reference" disabled>비교값 저장</button></div><div data-rom-validation-summary class="rom-validation-summary">비교 자료가 없습니다. 평균 절대 오차(MAE)는 직접 입력한 참조값과의 차이이며 의료적 정확도를 보증하지 않습니다.</div></section></details>
    <section class="rom-history-panel" ${manage ? "" : "hidden"}><div class="rom-panel-head"><div><span class="rom-eyebrow">MY OBSERVATIONS</span><h2>방향별 기록</h2></div><div class="rom-buttons"><button type="button" data-rom-action="refresh">새로고침</button><button type="button" data-rom-action="export-json">JSON 내보내기</button><button type="button" data-rom-action="export-csv">선택 기록 CSV</button><button type="button" class="rom-danger" data-rom-action="clear">전체 기록 삭제</button></div></div><div class="rom-view-summary" data-rom-view-summary></div><div data-rom-history class="rom-history">이 PC의 기록을 불러오는 중입니다.</div><div data-rom-reference-history></div><p class="rom-help">각도 기록은 웹 서버 PC의 비공개 데이터 폴더에 저장됩니다. 같은 PC를 쓰는 다른 사람도 볼 수 있으므로 개인 기기에서 사용하세요. 최대 움직임 300개·참조값 100개, 30일 후 다음 접근 시 삭제됩니다. 내보낸 파일은 별도로 관리해야 합니다.</p></section>
    <details class="rom-details" ${manage ? "hidden" : ""}><summary>측정의 의미와 한계 · 기존 개인 설정</summary><p>재활 중 변화 관찰용입니다. 치료 동작·범위는 담당 전문가와 정하고 통증이 생기면 중단하세요. 손목·손가락·목 회전·어깨 안팎 회전은 이번 측정 목록에 포함하지 않습니다.</p><p>발목은 무릎→발목 선분과 뒤꿈치→발끝 선분 사이 각도입니다. 중립은 약 90°로 보일 수 있으나 임상적 발목 배굴/저굴 검사와 같지 않습니다. 무릎·팔꿈치는 180°에서 세 점의 내각을 뺀 값, 몸통–허벅지는 골반을 고정한 독립 고관절 각도가 아닙니다.</p><p>기록 범위는 유효 각도의 5~95 백분위 차이입니다. 신뢰도·방향 확인·표본 70% 조건은 앱의 품질 필터이며 임상적으로 검증된 기준이 아닙니다. 범위 증가가 곧 치료 효과나 건강 개선을 뜻하지 않습니다. FoG RF/CNN이나 진동·레이저 제어와 연결하지 않습니다.</p><p>동일 조건 반복 측정 및 전문가의 외부 각도계와 비교하는 용도입니다. 실제 치료·운동 강도·목표는 전문가와 정하세요. 카메라 추정은 가림·조명·옷·거리·촬영 방향에 영향을 받습니다.</p><div class="rom-form-grid"><label>기존 키 설정 (cm)<input type="number" data-personal-setting="height" value="${escapeHtml(settings.height)}"></label><label>다리 길이 (cm)<input type="number" data-personal-setting="legLength" value="${escapeHtml(settings.legLength)}"></label><label>신발 길이 (mm)<input type="number" data-personal-setting="shoeSize" value="${escapeHtml(settings.shoeSize)}"></label></div><p>기존 프로필 설정은 보존하며, 위 길이 값은 현재 2D 각도 계산이나 치료 처방에 사용하지 않습니다.</p><p><a href="https://developers.google.com/edge/mediapipe/solutions/vision/pose_landmarker/web_js" target="_blank" rel="noopener noreferrer">Google MediaPipe 공식 설명</a> · <a href="https://pubmed.ncbi.nlm.nih.gov/36616603/" target="_blank" rel="noopener noreferrer">각도 추정 검증 연구 — 본 앱의 성능 수치가 아님</a></p></details>
  </section>`;
}
export function renderMediaPipeView(state) {
  return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${renderMediaPipeContent()}</main></div>`;
}
