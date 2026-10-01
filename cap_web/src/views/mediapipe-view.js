import { renderAnkleCapture } from '../mediapipe/ankle-view.js';
import { renderTopbar } from "../components/topbar.js";
import { escapeHtml } from "../utils/text.js";
import { renderSetWorkspace, renderSetReportPanel } from "../mediapipe/set-view.js";
import { renderMotionDashboard } from '../mediapipe/motion-report.js';
import { renderJointOptions, renderJointGuide, renderLandmarkGuide } from '../mediapipe/rom-joints.js';

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
    <header class="rom-heading" ${manage ? "" : "hidden"}><div><span class="rom-eyebrow">${manage ? "관절 자료" : "JOINT MOTION"}</span><${manage ? "h2" : "h1"}>${manage ? "관절 기록과 측정 세트" : "관절 움직임"}</${manage ? "h2" : "h1"}><p>${manage ? "저장한 기록을 골라 세트로 묶거나 내보내세요." : "15초 동안 움직이고, 나의 이전 기록과 비교해 보세요."}</p></div><div class="rom-heading-actions"><div class="simple-route-link"><button type="button" ${manage ? 'data-view="mediapipe"' : 'data-rom-action="show-comparison"'}>${manage ? "새 관절 측정하기 →" : "기록 비교 ↓"}</button><button type="button" data-view="records" ${manage ? "hidden" : ""}>기록 · 세트 관리 →</button></div></div></header>
    <div ${manage ? "" : "hidden"}>${renderSetWorkspace()}</div>
    ${manage ? `    <div class="rom-layout motion-capture ${manage ? "rom-management-layout" : ""}" ${manage ? "hidden" : ""}>
      <section class="rom-camera-panel" aria-label="웹캠 관절 분석" ${manage ? "hidden" : ""}>
        <div class="rom-panel-head"><h2>카메라</h2><span data-rom-camera-status>카메라 대기</span></div>
        <div class="rom-video-stage" data-rom-stage><video data-rom-video autoplay muted playsinline aria-label="노트북 웹캠 영상"></video><canvas data-rom-overlay aria-label="인식된 관절 위치"></canvas><div class="rom-video-empty" data-rom-empty><img class="rom-framing-figure" src="/assets/pose-framing.svg" alt="" aria-hidden="true" /><b>관절이 잘 보이게 서거나 앉아 주세요</b><p>선택한 관절 주변이 화면에 또렷하게 보이도록 해 주세요.</p></div><span class="rom-video-label" data-rom-view-label>정면 · 좌우는 본인 기준</span></div>
        <label class="rom-consent"><input type="checkbox" data-rom-consent> 웹캠 사용에 동의합니다. 영상·음성은 저장하지 않습니다.</label>
        <label class="rom-camera-select">사용할 카메라<select data-rom-camera-select aria-describedby="rom-camera-help"><option value="">기본 카메라</option></select></label>
        <p class="rom-camera-help" id="rom-camera-help" data-rom-camera-help>카메라를 한 번 켜면 연결된 웹캠 목록을 불러옵니다. 카메라를 끈 뒤 다른 장치를 선택하세요.</p>
        <div class="rom-camera-tools"><button type="button" class="rom-primary" data-rom-action="start">웹캠 켜기</button><button type="button" data-rom-action="stop" disabled>끄기</button><label><input type="checkbox" data-rom-mirror> 거울 보기</label><span data-rom-fps>분석 대기</span></div>
        <p class="rom-quality" data-rom-quality role="status">카메라를 켜고 몸 위치를 확인해 주세요.</p>
      </section>
      <section class="rom-setup-panel" aria-label="측정 설정과 기록" ${manage ? "hidden" : ""}>
        <div class="rom-panel-head"><h2>측정 준비</h2><span>선택하고, 확인하고, 시작해요</span></div>
        <ol class="motion-preparation" aria-label="관절 측정 준비 순서"><li data-rom-step="camera"><span class="step-number">1</span><b>카메라</b><small data-rom-step-state>대기</small></li><li data-rom-step="pose"><span class="step-number">2</span><b>몸 위치</b><small data-rom-step-state>대기</small></li><li data-rom-step="record"><span class="step-number">3</span><b>15초 기록</b><small data-rom-step-state>대기</small></li></ol>
        <div class="rom-form-grid motion-essential"><label class="rom-joint-field">관절·동작<select data-rom-config="metric" aria-describedby="rom-joint-help">${renderJointOptions()}</select></label><label>자세<select data-rom-config="posture"><option value="seated">앉아서</option><option value="standing">서서</option></select></label></div>
        <p id="rom-joint-help" class="rom-joint-help">관절을 고르면 필요한 촬영 방향으로 바뀌어요.</p>
        <fieldset class="rom-directions"><legend>촬영 방향</legend><label><input type="radio" name="rom-view" value="front"><span>정면</span></label><label><input type="radio" name="rom-view" value="left" checked><span>좌측면</span></label><label><input type="radio" name="rom-view" value="right"><span>우측면</span></label></fieldset>
        <p class="rom-view-guide" data-rom-guide></p>
        <div data-rom-landmark-guide>${renderLandmarkGuide('left_ankle')}</div>
        <label class="rom-check"><input type="checkbox" data-rom-direction-confirmed> 선택한 방향을 향했고, 화면에는 나만 있어요.</label>
        <div class="rom-record-box"><div><b data-rom-record-title>15초 움직임 기록</b><span data-rom-progress-text>0 / 15초</span></div><progress data-rom-progress max="15" value="0" aria-label="기록 진행률"></progress><p class="rom-quality" id="rom-record-help" data-rom-record-help role="status">웹캠 동의 후 카메라를 켜 주세요.</p><div class="rom-buttons"><button type="button" class="rom-primary" data-rom-action="record" aria-describedby="rom-record-help" disabled>15초 기록 시작</button><button type="button" class="rom-danger" data-rom-action="abort" disabled>중단</button></div><small>편안하게 움직이세요. 통증·어지러움이 있으면 중단하세요.</small></div>
      </section>
    </div>
` : renderAnkleCapture()}
    <div class="rom-notice" role="status" data-rom-notice>왼발 기록을 저장한 뒤 오른발도 같은 순서로 진행하세요.</div>
    <details class="simple-details rom-identity motion-settings" ${manage ? "open" : ""}><summary data-rom-identity>추가 설정 · 내 기록 P01</summary>
      <div class="rom-form-grid"><label>사용자 코드 (측정 코드)<input data-rom-config="participant" value="P01" maxlength="30" autocomplete="off" aria-describedby="rom-participant-note"></label><label>촬영 환경 코드<input data-rom-config="setup" value="책상-기본" maxlength="60" autocomplete="off"></label><label>관절 신뢰도 하한<select data-rom-config="confidence"><option value="0.65">65% · 낮음</option><option value="0.75" selected>75% · 기본</option><option value="0.85">85% · 엄격</option></select></label></div>
      <p id="rom-participant-note" class="rom-participant-help"><b>P01 = 한 사람의 기록 이름표</b> · 예: 본인 P01, 팀원 P02. 날짜·관절·촬영 방향이 달라도 같은 코드를 쓰세요. 카메라 위치가 바뀌면 촬영 환경 코드를 바꾸세요.</p><p class="motion-footnote">저장 버튼을 누른 각도·측정 코드는 이 PC에 30일 보관됩니다. 영상·음성은 저장하지 않습니다.</p>
      <details class="motion-more"><summary>선택한 관절의 촬영 방법과 각도 정의</summary><section class="rom-joint-guide" data-rom-joint-guide aria-label="선택 관절의 촬영 방법과 각도 정의">${renderJointGuide('left_ankle')}</section></details>
    </details>
    <section class="motion-save-panel" data-motion-save><div><div class="rom-result" data-rom-result>아직 선택한 기록이 없습니다.</div><p class="rom-comparison" data-rom-comparison></p></div><div class="rom-buttons"><button type="button" class="rom-primary" data-rom-action="save" ${manage ? "hidden" : ""} disabled>기록 저장</button><button type="button" data-rom-action="baseline" ${manage ? "" : "hidden"} disabled>개인 기준으로 지정</button><button type="button" data-rom-action="discard" ${manage ? "hidden" : ""} disabled>미저장 기록 버리기</button><button type="button" data-rom-action="save-alone" hidden disabled>개별 기록으로 저장</button></div></section>
    ${manage ? '<div hidden><div data-rom-chart></div><div data-rom-metrics></div></div>' : `<details class="ankle-record-details" data-ankle-details><summary>각도 그래프 · 이전 기록 · AI 해석</summary>${renderMotionDashboard()}</details>`}
    <div ${manage ? "" : "hidden"}>${renderSetReportPanel()}</div>
    <section class="rom-history-panel" ${manage ? "" : "hidden"}><div class="rom-panel-head"><div><span class="rom-eyebrow">MY OBSERVATIONS</span><h2>방향별 기록</h2></div><div class="rom-buttons"><button type="button" data-rom-action="refresh">새로고침</button><button type="button" data-rom-action="export-json">JSON 내보내기</button><button type="button" data-rom-action="export-csv">선택 기록 CSV</button><button type="button" class="rom-danger" data-rom-action="clear">전체 기록 삭제</button></div></div><div class="rom-view-summary" data-rom-view-summary></div><div data-rom-history class="rom-history">이 PC의 기록을 불러오는 중입니다.</div><div data-rom-reference-history></div><p class="rom-help">각도 기록은 웹 서버 PC의 비공개 데이터 폴더에 저장됩니다. 같은 PC를 쓰는 다른 사람도 볼 수 있으므로 개인 기기에서 사용하세요. 최대 움직임 300개·참조값 100개, 30일 후 다음 접근 시 삭제됩니다. 내보낸 파일은 별도로 관리해야 합니다.</p></section>

  </section>`;
}
export function renderMediaPipeView(state) {
  return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${renderMediaPipeContent()}</main></div>`;
}
