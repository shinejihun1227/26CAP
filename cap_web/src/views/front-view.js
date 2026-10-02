import { renderTopbar } from '../components/topbar.js';
import { BASELINE_HOLD_MS, FRONT_OBSERVATION_MS } from '../mediapipe/front-capture.js';

export function renderFrontContent() {
  const hold=BASELINE_HOLD_MS/1000, seconds=FRONT_OBSERVATION_MS/1000;
  return `<section class="front-workspace" data-front-root>
    <header class="purpose-heading front-heading"><div><span>정면 보행 · MediaPipe</span><h1>${seconds}초만 걸어 보세요</h1><p>처음 자세와 골반·몸통의 변화를 비교해요.</p></div><div class="front-time-badge"><b>${hold}초 준비</b><span>→</span><b>${seconds}초 관찰</b></div></header>
    <div class="front-layout">
      <section class="front-camera">
        <div class="front-stage" data-front-stage>
          <video data-front-video autoplay muted playsinline></video><canvas data-front-canvas aria-label="인식한 몸의 관절점과 연결선"></canvas>
          <div data-front-empty><img src="/assets/pose-framing.svg" alt="정면에서 어깨와 골반이 잘 보이는 촬영 자세"><b>어깨와 골반이 잘 보이게</b><p>정면을 보고 · 카메라는 수평으로</p></div>
          <div class="front-timer" data-front-timer hidden><span data-front-timer-label>남은 시간</span><div><b data-front-countdown>${seconds.toFixed(1)}</b><small>초</small></div></div>
          <span class="front-camera-label">정면 · 거울 보기는 화면만 반전</span>
        </div>
        <div class="front-legend"><span><i aria-hidden="true"></i>초록: 인식됨</span><span><i class="front-key-review" aria-hidden="true"></i>점선: 위치 확인</span><span><i class="front-key-pelvis" aria-hidden="true"></i>하늘색: 골반선</span></div>
        <label class="front-consent"><input type="checkbox" data-front-consent> 카메라 사용 동의 · 영상 저장 안 함</label>
        <div class="front-tools"><button data-front-action="start" class="front-primary" disabled>카메라 켜기</button><button data-front-action="stop" disabled>끄기</button><label><input type="checkbox" data-front-mirror> 거울 보기</label></div>
        <details class="observation-details"><summary>다른 카메라 선택</summary><select data-front-device aria-label="사용할 카메라"><option value="">기본 카메라</option></select></details>
        <p data-front-runtime role="status">카메라를 켜면 점과 선이 표시돼요.</p>
      </section>
      <section class="front-instructions" aria-label="정면 관찰 순서">
        <article data-front-step="1" class="is-current"><span class="front-step">1</span><h2>카메라 켜고 정면 보기</h2><p>얼굴·양쪽 어깨·골반을 보여 주세요.</p><strong data-front-quality role="status">카메라를 켜고 정면을 봐 주세요.</strong></article>
        <article data-front-step="2"><span class="front-step">2</span><h2>${hold}초 기준 자세</h2><p>편하게 선 채로 잠시 멈춰요.</p><button data-front-action="baseline" disabled>${hold}초 기준 맞추기</button><button data-front-action="cancel-baseline" hidden>기준 기록 취소</button><progress data-front-baseline-progress aria-label="인식된 기준 자세 시간" max="${hold}" value="0"></progress><p data-front-baseline role="status">어깨·골반의 초록 점을 확인하세요.</p></article>
        <article data-front-step="3"><span class="front-step">3</span><h2>${seconds}초 편하게 걷기</h2><p>정면을 유지하며 작은 걸음으로 움직여요.</p><button data-front-action="record" class="front-primary" disabled>${seconds}초 관찰 시작</button><button data-front-action="abort" hidden>관찰 중단</button><progress data-front-progress aria-label="보행 관찰 진행 시간" max="${seconds}" value="0"></progress><p data-front-record>기준 자세를 먼저 맞춰 주세요.</p><small data-front-coverage>${seconds}초가 지나면 자동으로 끝나요.</small></article>
      </section>
    </div>
    <section class="front-feedback" aria-label="정면 관찰 결과"><div><span data-front-result-label>처음 자세와 실시간 비교</span><h2 data-front-feedback>측정 대기</h2><p data-front-next>어깨·골반의 초록 점을 먼저 확인하세요.</p></div><div class="front-values"><article><span data-front-pelvis-label>골반선 변화</span><strong data-front-pelvis>—</strong></article><article><span data-front-trunk-label>몸통 기울기 변화</span><strong data-front-trunk>—</strong></article></div></section>
    <section class="front-history"><div class="purpose-section-head"><h2>내 관찰 기록</h2><button class="text-button" type="button" data-view="records" data-record-section="front">기록 관리 →</button></div><p>이 브라우저에 최근 20건 보관 · 영상 없음</p><div data-front-history></div></section>
    <details class="observation-details"><summary>촬영 팁 · 결과를 읽는 방법</summary><p>가능하면 머리부터 양발까지 화면에 넣어 주세요. 계산에는 양쪽 어깨·골반을 사용하며, 발목 점이 잠깐 흐려져도 이 네 점이 보이면 관찰할 수 있어요. 얼굴과 두 어깨가 보이도록 정면을 유지하세요. 불편하면 중단하세요.</p><p>${seconds}초 중 70% 이상 인식되면 결과를 저장해요. 결과의 각도는 처음 자세에서 가장 크게 달라진 값입니다. 중단하거나 인식이 부족하면 완료 결과로 표시하지 않아요.</p><p>영상 평면의 변화이며 골반의 3차원 회전·질환·잘못된 걸음을 판정하지 않습니다. 카메라 위치를 바꾸면 기준 자세부터 다시 맞춰 주세요.</p><p>골반선 5° 또는 몸통 8° 변화가 1초 이상 이어질 때 안내합니다. 화면 안내 조건이며 임상 기준이 아닙니다.</p></details>
  </section>`;
}
export function renderFrontView(state) {return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${renderFrontContent()}</main></div>`;}
