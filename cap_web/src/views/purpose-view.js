import { renderTopbar } from '../components/topbar.js';
import { renderAppFeatures, renderFeatureScope } from '../components/app-features.js';
import { aiPresentation, getAiStatusMeta } from '../components/ai-status-card.js';
import { escapeHtml as e } from '../utils/text.js';
import { renderTodaySummary } from '../components/today-summary.js';
function calibrationProgress(foot) {
  const c=foot.capture||{};
  if(c.status==='countdown')return Math.ceil(c.countdown_sec||0)+'초 뒤 시작 · 가만히 서 주세요';
  if(c.status==='recording')return (c.elapsed_sec||0)+' / 25초 · '+((c.elapsed_sec||0)<5?'가만히 서 주세요':'평소처럼 걸어 주세요');
  if(c.status==='failed')return '보정 실패 · '+(c.error||'연결 상태를 확인하세요');
  if(!foot.device_connected)return '신발 연결 필요';
  if(c.status==='complete')return '보정 저장 완료';
  return getAiStatusMeta(foot.status).label;
}
function renderPreparationGuide(state) {
  const ai=aiPresentation(state);
  return `<section class="purpose-home"><header class="purpose-heading"><span>STEPON · 나에게 맞춘 걸음 관찰</span><h1>준비하고, 걷고,<br>변화를 확인해요.</h1><p>두 발의 센서와 정면 카메라로 내 움직임을 기록해요.</p></header>
    <ol class="purpose-steps"><li><span>1</span><b>양발 보정</b><small>내 걸음을 기준으로</small></li><li><span>2</span><b>움직임 관찰</b><small>센서 + 정면 카메라</small></li><li><span>3</span><b>오늘 기록 확인</b><small>언제 변화했는지</small></li></ol>
    <section class="home-calibration"><div class="purpose-section-head"><div><span>먼저 해 주세요</span><h2>양발 BMI·압력 보정</h2></div><button type="button" data-view="devices">연결 확인 →</button></div><p>3초 준비 → 5초 정지 → 20초 평소 걸음<br>처음 5초에 양발을 편히 딛고 서 주세요. 이때의 압력을 50점으로 저장해요.</p><div class="home-feet">${['left','right'].map(side=>{const f=state.ai?.feet?.[side]||{}, c=f.capture||{}, busy=['countdown','recording'].includes(c.status), label=side==='left'?'왼발':'오른발';return `<article><div><b>${label}</b><span>${e(calibrationProgress(f))}</span></div><button type="button" data-action="${busy?'ai-calibration-cancel':'ai-calibrate'}" data-ai-side="${side}" ${!state.ai?.available||(!busy&&(!f.device_connected||state.paused))?'disabled':''}>${label} ${busy?'보정 취소':'BMI·압력 보정'}</button></article>`;}).join('')}</div>${state.dataSource!=='esp32'?'<button class="purpose-connect" data-action="connect-live-mode">실제 센서 연결하기</button>':''}<p class="purpose-note" role="status">${e(state.ai?.actionError || (state.ai?.available ? '보행동결 AI와 압력 표시의 개인 기준을 저장해요. 발 기울기 기준은 별도로 기록해요.' : 'AI 연결을 기다리고 있어요. 신발과 PC AI 프로그램의 실행 상태를 확인하세요.'))}</p></section>
    ${renderAppFeatures({navigation:true,fogStatus:ai.meta.label})}${renderFeatureScope()}
    <p class="purpose-note">개인 움직임의 변화를 살펴보는 도구예요. 부상 위험·골반 회전·잘못된 보행을 확정 진단하지 않습니다.</p></section>`;
}
export function renderPurposeContent(state) {
  return `${renderTodaySummary(state)}<details class="today-preparation-guide" data-ui-disclosure="today-preparation"><summary>처음 사용하나요? 준비 순서와 양발 보정</summary>${renderPreparationGuide(state)}</details>`;
}
export function renderPurposeView(state,{embedded=false}={}) {const content=renderPurposeContent(state);return embedded?content:`<div class="page-shell">${renderTopbar(state)}<main class="content-area">${content}</main></div>`;}
