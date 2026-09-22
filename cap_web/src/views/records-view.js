import { renderTopbar } from '../components/topbar.js';
import { renderMediaPipeContent } from './mediapipe-view.js';
import { renderTrendsContent } from './trends-view.js';

export function renderRecordsContent() {
  return `<section class="records-workspace">
    <header class="simple-heading"><div><span class="simple-eyebrow">자료 보관</span><h1>데이터 관리</h1><p>측정 세트와 저장된 자료를 한곳에서 관리하세요.</p></div><a class="simple-secondary" href="/data/">원시 데이터 · CSV 분석 ↗</a></header>
    <p class="simple-note">측정은 보행·관절 화면에서, 날짜별 비교는 ‘변화 보기’에서 할 수 있어요. 저장한 자료는 이 PC에 30일간 보관됩니다.</p>
    <nav class="records-shortcuts" aria-label="데이터 관리 항목"><a href="#joint-records">관절 기록 · 세트</a><a href="#walking-records">보행 기록 · 내보내기</a></nav>
    <section id="joint-records" aria-label="관절 데이터 관리">${renderMediaPipeContent({ manage: true })}</section>
    <section id="walking-records" aria-label="보행 데이터 관리">${renderTrendsContent({ manage: true })}</section>
  </section>`;
}
export function renderRecordsView(state) { return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${renderRecordsContent()}</main></div>`; }
