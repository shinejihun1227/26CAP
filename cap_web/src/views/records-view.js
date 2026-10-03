import { renderTopbar } from '../components/topbar.js';
import { icon } from '../components/icons.js';

export const RECORD_TABS = [
  { id: 'fog', title: 'FOG 분석 자료', detail: 'BMI 보정 · AI 점수 · CSV', icon: 'activity' },
  { id: 'ankle', title: '발 움직임 기록', detail: '기울기 기준 · 이탈', icon: 'shoe' },
  { id: 'front', title: '홈재활 기록', detail: '골반 · 양발 · 인식 품질', icon: 'camera' },
  { id: 'sensors', title: '압력·온습도 기록', detail: '센서 저장 · 날짜별 비교', icon: 'chart' },
];

export function renderRecordsContent() {
  return `<section class="records-hub" data-records-root>
    <header class="records-hub-heading"><div><span class="simple-eyebrow">내 움직임의 기록</span><h1>데이터 관리</h1><p>확인할 기록을 선택하세요.</p></div><span class="records-local-badge">내 기기에 보관</span></header>
    <div class="records-tabs" role="tablist" aria-label="기록 종류">${RECORD_TABS.map((tab, i) => `<button type="button" role="tab" id="records-tab-${tab.id}" data-record-tab="${tab.id}" aria-controls="records-panel" aria-selected="${i === 0}" tabindex="${i === 0 ? 0 : -1}"><span class="records-tab-icon" aria-hidden="true">${icon(tab.icon)}</span><b>${tab.title}</b><small>${tab.detail}</small></button>`).join('')}</div>
    <section id="records-panel" class="records-panel" role="tabpanel" aria-labelledby="records-tab-fog" tabindex="0"><p role="status">기록을 불러오고 있어요.</p></section>
    <details class="records-archive" data-record-archive><summary>이전 버전의 관절 기록 보관함</summary><p>정면·좌측·우측 각도와 3방향 세트를 사용하던 이전 기능의 자료입니다. 현재 정면 보행 기록과는 별도로 보관합니다.</p><div data-record-archive-content>열면 저장 자료를 확인합니다.</div></details>
  </section>`;
}
export function renderRecordsView(state) { return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${renderRecordsContent()}</main></div>`; }
