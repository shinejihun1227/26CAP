import { renderTopbar } from '../components/topbar.js';
import { renderMediaPipeContent } from './mediapipe-view.js';
import { renderTrendsContent } from './trends-view.js';

export function renderRecordsContent() {
  return `<section class="records-workspace">
    <header class="simple-heading"><div><span class="simple-eyebrow">내 측정 자료</span><h1>데이터 관리</h1><p>보행 센서 기록과 관절 관찰 기록을 나눠서 확인하고 관리해요.</p></div><a class="simple-secondary" href="/data/">AI 학습 데이터·CSV 도구 ↗</a></header>
    <p class="simple-note">저장된 기록은 이 PC에서 관리합니다. 보행 센서는 압력·온도·습도 표본을, 관절 관리는 MediaPipe로 계산한 각도와 측정 세트를 관리합니다.</p>
    <nav class="records-categories" aria-label="관리할 데이터 종류">
      <a class="records-category records-category--walking" href="#walking-records"><span class="records-category-icon" aria-hidden="true">◉</span><span class="records-category-copy"><small>01 · WALKING SENSORS</small><b>보행 센서 데이터</b><span>압력 분포 · 온도 · 습도 · 날짜별 기록 · 내보내기</span><strong>보행 기록 관리로 이동 <i aria-hidden="true">↓</i></strong></span></a>
      <a class="records-category records-category--joint" href="#joint-records"><span class="records-category-icon" aria-hidden="true">⌁</span><span class="records-category-copy"><small>02 · MEDIAPIPE JOINTS</small><b>관절 측정 데이터</b><span>관절 각도 · 촬영 조건 · 측정 세트 · CSV/JSON</span><strong>관절 기록 관리로 이동 <i aria-hidden="true">↓</i></strong></span></a>
    </nav>
    <section id="walking-records" class="records-domain records-domain--walking" aria-label="압력·온도·습도 기반 보행 센서 데이터 관리"><header class="records-domain-heading"><span class="records-domain-number">01</span><div><h2>보행 센서 데이터</h2><p>ESP32에서 들어온 압력·온도·습도 기록을 저장하고, 지표별로 조회하거나 내보냅니다.</p></div></header>${renderTrendsContent({ manage: true })}</section>
    <section id="joint-records" class="records-domain records-domain--joint" aria-label="MediaPipe 관절 데이터 관리"><header class="records-domain-heading"><span class="records-domain-number">02</span><div><h2>관절 측정 데이터</h2><p>웹캠에서 추정한 관절 각도 기록과 여러 촬영 방향의 측정 세트를 관리합니다. 영상은 저장하지 않습니다.</p></div></header>${renderMediaPipeContent({ manage: true })}</section>
  </section>`;
}
export function renderRecordsView(state) { return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${renderRecordsContent()}</main></div>`; }
