import { renderTopbar } from '../components/topbar.js';
import { koreaDay, SENSOR_METRICS } from '../trends/trend-math.js';
import { escapeHtml as e } from '../utils/text.js';

export function renderTrendsContent({ manage = false } = {}) {
  return `<div class="trends-workspace" data-trends-root data-trends-mode="${manage ? "manage" : "compare"}">
    <header class="trends-heading"><div><span class="trends-kicker">${manage ? "보행 자료" : "나의 지난 기록"}</span><${manage ? "h2" : "h1"}>${manage ? "보행 기록과 내보내기" : "변화 보기"}</${manage ? "h2" : "h1"}><p>${manage ? "측정값을 저장하고 필요한 자료를 내보내세요." : "같은 조건으로 측정한 지난 기록과 비교해 보세요."}</p></div><span class="trends-private">내 PC 저장 · 한국 날짜 기준</span></header>
    <section class="trends-toolbar" aria-label="비교할 기록 선택">
      <label>측정 코드<input data-trend-participant maxlength="30" value="P01" list="trend-participants" autocomplete="off" /></label><datalist id="trend-participants"></datalist>
      <label>기준 날짜<input data-trend-date type="date" value="${koreaDay()}" max="${koreaDay()}" /></label>
      <label>비교 대상<select data-trend-comparison><option value="yesterday">전날</option><option value="previous">직전 기록일</option><option value="week">이전 7일 평균</option></select></label>
      <button type="button" data-trend-action="refresh">새로고침</button><button type="button" data-trend-action="export" ${manage ? "" : "hidden"} disabled>내 기록 JSON</button>
    </section>
    ${manage ? "" : `<p class="simple-route-link"><button type="button" data-view="records">기록 저장 · 내보내기는 데이터 관리에서 →</button></p>`}
    <p class="trends-notice" role="status" data-trend-notice>저장한 기록을 불러오고 있어요.</p>
    <section ${manage ? "hidden" : ""} class="trends-summary" aria-label="변화 요약"><div><span class="trends-kicker">SUMMARY</span><h2>기록이 쌓이면 변화가 보입니다</h2><p>실제 저장된 기록만 비교합니다. 데이터가 없는 날은 0으로 채우지 않습니다.</p></div><div class="trends-summary-count"><strong data-trend-days>—</strong><span>기록이 있는 날</span></div></section>
    <section class="trends-panel trends-rom" ${manage ? "hidden" : ""}><div class="trends-panel-head"><div><h2>나의 관절 움직임</h2></div><button type="button" data-view="mediapipe">관절 측정하기 →</button></div>
      <label class="trends-wide-label">비교할 관절·촬영 조건<select data-trend-rom><option value="">저장된 관절 기록 없음</option></select></label>
      <div data-trend-rom-result class="trends-empty">MediaPipe에서 15초 측정을 완료하고 ‘기록 저장’을 눌러 주세요. 정면·좌측·우측은 각각 같은 조건끼리 비교합니다.</div>
    </section>
    <section class="trends-panel trends-sensors"><div class="trends-panel-head"><div><h2>보행·발 상태 기록</h2></div><span data-trend-live-status>기록 중 아님</span></div>
      <div ${manage ? "" : "hidden"}><div class="trends-recorder"><label>센서 환경 코드<input data-trend-setup value="보행-기본" maxlength="60" /></label><label class="trends-consent"><input type="checkbox" data-trend-consent />이 측정 코드로 실제 센서·알고리즘 관찰값을 PC에 30일 저장합니다.</label><button type="button" data-trend-action="start" disabled>센서 기록 시작</button><button type="button" data-trend-action="stop" disabled>기록 중지</button></div>
      <p class="trends-help">이 탭이 보이는 동안 약 1초마다 저장합니다. 탭을 숨기거나 다른 메뉴로 이동하면 중지됩니다. 시연값·연결 끊김·오래된 값은 제외하며, 기록 중 화면은 5초마다 갱신됩니다. 신발·센서 위치·운동 종류·모델 가중치 또는 보정 파일을 바꾸면 새 환경 코드를 사용하세요.</p></div>
      <div class="trends-filter-row"><label>센서·설정 조건<select data-trend-sensor><option value="">저장된 센서 기록 없음</option></select></label><label>관찰 지표<select data-trend-metric>${Object.entries(SENSOR_METRICS).map(([id, spec]) => `<option value="${id}">${e(spec.label)}</option>`).join('')}</select></label></div>
      <div data-trend-sensor-result class="trends-empty">ESP32를 연결한 후 센서 기록을 시작하세요. 기존 브라우저 임시 기록은 사람과 시연 여부를 구분할 수 없어 자동으로 가져오지 않습니다.</div>
    </section>
    <section class="trends-panel trends-history"><div class="trends-panel-head"><div><span class="trends-kicker">RECORD COVERAGE</span><h2>날짜별 기록 현황</h2></div></div><div data-trend-calendar class="trends-empty">아직 저장된 개인 기록이 없습니다.</div></section>
    <details class="simple-details"><summary>기록을 비교할 때 알아두세요</summary><aside class="trends-caution"><strong>변화와 건강 판정은 다릅니다.</strong><p>각도 범위 증가·감소, AI 판정 비율 변화는 관찰 결과입니다. 치료 효과나 악화 여부를 자동 확정하지 않습니다. 촬영 자세·신발·장비·보정값·모델을 바꾸면 비교 조건도 달라집니다. 통증이나 불편이 있으면 측정을 중단하고 전문가에게 기록을 보여 주세요.</p><p>관절·센서 기록은 서버 PC의 비공개 폴더에 저장됩니다. 같은 PC의 다른 사용자도 볼 수 있으며 로그인으로 분리된 의료 기록 시스템은 아닙니다. 카메라 영상은 저장하지 않습니다.</p></aside></details>
  </div>`;
}
export function renderTrendsView(state) { return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${renderTrendsContent()}</main></div>`; }
