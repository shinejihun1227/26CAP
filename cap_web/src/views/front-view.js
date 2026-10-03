import { renderTopbar } from '../components/topbar.js';
import { BASELINE_HOLD_MS, FRONT_OBSERVATION_MS } from '../mediapipe/front-capture.js';

export function renderFrontContent() {
  const hold=BASELINE_HOLD_MS/1000, seconds=FRONT_OBSERVATION_MS/1000;
  const metrics=[['pelvis','pelvis','골반선','처음 골반 높이와 비교'],['ankleLeft','left','왼쪽 발목 정렬','무릎–발목 선의 변화'],['ankleRight','right','오른쪽 발목 정렬','무릎–발목 선의 변화'],['trunk','trunk','몸통','처음 몸통 기울기와 비교']];
  return `<section class="front-workspace front-home" data-front-root>
    <header class="purpose-heading front-heading"><div><span>STEPON · 홈재활 파트너</span><h1>오늘도, 편안한 한 걸음</h1><p>처음 선 자세와 <b>골반 · 양발의 변화</b>를 함께 살펴요.</p></div><div class="front-time-badge"><b>${hold}초 기준</b><span>→</span><b>${seconds}초 관찰</b></div></header>
    <div class="front-intro"><span><b>01</b> 전신 보여주기</span><span><b>02</b> 내 자세 기억하기</span><span><b>03</b> 편하게 걷고 돌아보기</span></div>
    <p class="front-care-note">파킨슨병 환자의 집에서 하는 걸음 관찰을 돕습니다. 의료진에게 안내받은 방식으로, 주변을 비우고 필요하면 보호자와 함께하세요.</p>
    <div class="front-layout">
      <section class="front-camera" aria-label="카메라와 기준선">
        <div class="front-camera-heading"><h2>내 걸음 보기</h2><span data-front-source role="status">카메라 준비</span></div>
        <div class="front-stage" data-front-stage>
          <video data-front-video autoplay muted playsinline></video><canvas data-front-canvas aria-label="직접 인식한 관절점, 처음 자세의 기준선, 잠깐 유지한 점선"></canvas>
          <div data-front-empty><img src="/assets/pose-framing.svg" alt="정면에서 어깨·골반·무릎·양발이 보이는 자세"><b>머리부터 양발까지 보여 주세요</b><p>정면을 보고 · 카메라는 수평으로</p></div>
          <div class="front-timer" data-front-timer hidden><span data-front-timer-label>남은 시간</span><div><b data-front-countdown>${seconds.toFixed(1)}</b><small>초</small></div></div>
          <span class="front-camera-label">정면 관찰 · 좌우는 내 몸 기준</span>
        </div>
        <div class="front-legend"><span><i aria-hidden="true"></i>초록 실선 · 직접 인식</span><span><i class="front-key-review" aria-hidden="true"></i>살구 점선 · 잠시 유지 / 확인 필요</span><span><i class="front-key-pelvis" aria-hidden="true"></i>하늘색 굵은 점선 · 처음 자세</span></div>
        <label class="front-consent"><input type="checkbox" data-front-consent> 카메라 사용 동의 · 영상 저장 안 함</label>
        <div class="front-tools"><button data-front-action="start" class="front-primary" disabled>카메라 켜기</button><button data-front-action="stop" disabled>끄기</button><label><input type="checkbox" data-front-mirror> 거울 보기</label></div>
        <details class="observation-details"><summary>다른 카메라 선택</summary><select data-front-device aria-label="사용할 카메라"><option value="">기본 카메라</option></select></details>
        <p data-front-runtime role="status">카메라를 켜면 관절점이 나타나요.</p>
      </section>
      <section class="front-instructions" aria-label="집에서 걸음 관찰 순서">
        <article data-front-step="1" class="is-current"><span class="front-step">1</span><h2>화면에 전신 맞추기</h2><p>골반 · 무릎 · 발목이 보이게 서요.</p><strong data-front-quality role="status">카메라를 켜고 정면을 봐 주세요.</strong></article>
        <article data-front-step="2"><span class="front-step">2</span><h2>내 자세 기억하기</h2><p>편하게 선 자세를 ${hold}초만 유지해요.</p><button data-front-action="baseline" disabled>${hold}초 기준 맞추기</button><button data-front-action="cancel-baseline" hidden>기준 기록 취소</button><progress data-front-baseline-progress aria-label="직접 인식된 기준 자세 시간" max="${hold}" value="0"></progress><p data-front-baseline role="status">어깨·골반과 양발의 초록 점을 확인해요.</p></article>
        <article data-front-step="3"><span class="front-step">3</span><h2>편안한 걸음 살펴보기</h2><p>화면 안에서 평소 안내받은 방식으로 걸어요.</p><button data-front-action="record" class="front-primary" disabled>${seconds}초 관찰 시작</button><button data-front-action="abort" hidden>멈추고 쉬기</button><progress data-front-progress aria-label="보행 관찰 진행 시간" max="${seconds}" value="0"></progress><p data-front-record>기준 자세를 먼저 맞춰 주세요.</p><small data-front-coverage>${seconds}초 뒤 자동으로 끝나요.</small></article>
        <div class="front-gentle-tip"><b>선에 억지로 맞추지 않아도 괜찮아요.</b><p>기준과 달라지면 함께 확인해요. 불편하거나 균형이 불안하면 멈추세요.</p></div>
      </section>
    </div>
    <section class="front-feedback" aria-label="홈재활 걸음 관찰 결과"><div class="front-feedback-copy"><span data-front-result-label>처음 자세와 실시간 비교</span><h2 data-front-feedback>한 걸음씩, 함께 살펴요</h2><p data-front-next>카메라를 켜고 내 자세부터 기억해요.</p></div><div class="front-values">${metrics.map(([key,id,label,detail])=>`<article data-front-metric="${key}"><span data-front-${id}-label>${label}</span><strong data-front-${id}>—</strong><small>${detail}</small><b data-front-${id}-state>기준을 맞춰 주세요</b></article>`).join('')}</div></section>
    <section class="front-history"><div class="purpose-section-head"><h2>오늘의 작은 기록</h2><button class="text-button" type="button" data-view="records" data-record-section="front">기록 더 보기 →</button></div><p>직접 인식과 보간을 구분해 보관해요 · 영상 없음</p><div data-front-history></div></section>
    <details class="observation-details front-method"><summary>기준선과 보간은 어떻게 사용하나요?</summary><p>하늘색 선은 편하게 선 처음 자세입니다. 걸을 때의 자연스러운 움직임도 기준과 달라질 수 있어요. 골반은 양쪽 높이의 차이, 발목 정렬은 화면에서 본 무릎–발목 선의 변화를 비교합니다. 실제 발목 관절각이나 정상 보행 판정이 아닙니다.</p><p>실시간으로 점이 사라지면 마지막 위치를 최대 0.4초 점선으로 유지합니다. 다시 인식되면 앞뒤 실측값 사이의 0.5초 이내 빈 구간만 보간해요. 오랫동안 가려진 구간·여러 사람이 나온 구간·위치가 크게 바뀐 구간은 연결하지 않습니다.</p><p>${seconds}초 중 직접 인식 6초 이상, 직접 인식과 보간을 합쳐 7초 이상이면 전체 관찰을 완료합니다. 보간은 완료 판정에 최대 2초만 반영합니다. 기준 자세·최대 변화·주의 안내는 직접 인식값만 사용하며, 부족해도 확인된 부위의 결과는 남깁니다.</p><p>골반 5°·몸통 8°·무릎–발목 선 12° 변화가 실측에서 1초 이어지면 확인을 안내합니다. 제품의 화면 안내 조건으로, 의료적 위험 기준이 아닙니다. 카메라나 위치를 크게 바꾸면 기준부터 다시 맞추세요.</p><p>영상·관절 좌표는 저장하지 않습니다. 수치 요약은 이 브라우저에 최대 30일·최근 20건 보관합니다. <a href="https://www.parkinson.org/library/fact-sheets/physical-therapy" target="_blank" rel="noopener noreferrer">파킨슨병과 물리치료 안내</a> · <a href="https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker" target="_blank" rel="noopener noreferrer">MediaPipe 측정 방식</a></p></details>
  </section>`;
}
export function renderFrontView(state) {return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${renderFrontContent()}</main></div>`;}
