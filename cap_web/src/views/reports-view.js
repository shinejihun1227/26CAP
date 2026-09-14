import { renderTopbar } from '../components/topbar.js';
import { escapeHtml as e } from '../utils/text.js';
export function renderReportsContent(state) {
  const today = new Date(), key = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  const record = state.rehabLog?.[key] ?? {};
  const fields = { loadLimitExceeded: '하중 초과 피드백', asymmetry: '불균형 피드백', footDrag: '발 끌림 의심', heelLanding: '뒤꿈치 착지 피드백', propulsion: '앞꿈치 추진 피드백', lateralBias: '외측 쏠림', fatigue: '피로 알림' };
  return `<section class="subpage-heading"><div><span class="eyebrow">PERSONAL REPORT</span><h1>보행 리포트</h1><p>현재 브라우저의 참고 기록과 저장된 개인 기록을 구분해서 확인하세요.</p></div><button class="control-button" data-view="trends">개인 변화 추이 보기 →</button></section>
    <section class="report-summary"><div class="report-summary-main"><span class="panel-kicker">${key} · ${state.dataSource === 'esp32' ? '실제 센서 모드' : '시연 모드'}</span><h2>어제와의 비교는<br>저장 기록으로 확인하세요.</h2><p>이전에 표시되던 고정 보행 점수와 개선율은 실제 개인 분석 결과가 아니므로 제거했습니다. ‘변화 추이’에서 같은 측정 코드와 조건의 데이터만 비교합니다.</p></div></section>
    <section class="panel rehab-report-card"><div class="panel-heading"><h2>브라우저 임시 피드백 기록</h2></div><p>이 임시 기록은 측정 코드·시연 여부가 분리되지 않은 이전 방식입니다. 개인별 일간 비교에는 사용하지 않습니다.</p><div class="rehab-report-grid">${Object.entries(fields).map(([id, label]) => `<div><strong>${Number.isFinite(record[id]) ? record[id] : 0}</strong><span>${e(label)}</span></div>`).join('')}</div></section>
    <p class="medical-disclaimer">관찰값은 진단이나 치료 효과 판정을 대신하지 않습니다. 개인 기록은 변화 추이 탭에서 명시적으로 저장한 실제 센서 자료와 MediaPipe 저장 기록을 사용합니다.</p>`;
}
export function renderReportsView(state) { return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${renderReportsContent(state)}</main></div>`; }
