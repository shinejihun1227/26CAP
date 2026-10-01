import { navItems } from "../data/dashboard-data.js";
import { icon } from "./icons.js";
import { connectionSummary } from "./connection-summary.js";

const mobileNavLabels = {
  overview: "요약",
  easy: "쉬운 화면",
  live: "실시간",
  safety: "분석",
  reports: "리포트",
  trends: "변화 추이",
  devices: "기기",
  mediapipe: "정면 보행",
  ankle: "발 움직임",
};

export function renderSidebar(activeView, state) {
  const connection = connectionSummary(state ?? {});
  return `
    <aside class="sidebar">
      <div class="brand-lockup">
        <div class="brand-mark">S</div>
        <div>
          <strong>STEPON</strong>
          <span>보행 · 움직임 기록</span>
        </div>
      </div>
      ${state?.easyMode ? `<div class="easy-mode-status"><span>쉬운 화면 사용 중</span><button type="button" data-view="overview" data-easy-exit="true">일반 화면으로</button></div>` : ''}

      <div class="sidebar-section-label">내 보행 살펴보기</div>
      <button class="easy-mode-shortcut" type="button" data-view="easy">${icon('accessibility')}<span><b>쉬운 화면</b><small>큰 글씨와 단계별 안내</small></span></button>
      <nav class="primary-nav" aria-label="주요 메뉴">
        ${navItems.filter(item => item.group !== 'manage' && (!state?.easyMode || item.id !== 'trends')).map((item) => `
          <button class="nav-item ${(activeView === item.id || (activeView === 'easy' && item.id === 'overview')) ? "is-active" : ""}" data-view="${item.id}" ${(activeView === item.id || (activeView === 'easy' && item.id === 'overview')) ? 'aria-current="page"' : ''}>
            ${icon(item.icon)}
            <span><b>${item.korean}</b><small>${item.label}</small><em class="nav-item-mobile-label">${mobileNavLabels[item.id] ?? item.korean}</em></span>
          </button>
        `).join("")}
      </nav>

      <div class="sidebar-section-label">설정 · 자료 보관</div>
      <nav class="primary-nav management-nav" aria-label="설정과 데이터 관리">
        ${navItems.filter((item) => item.group === 'manage').map((item) => `<button class="nav-item ${(activeView === item.id || (activeView === 'easy' && item.id === 'overview')) ? 'is-active' : ''}" data-view="${item.id}" ${(activeView === item.id || (activeView === 'easy' && item.id === 'overview')) ? 'aria-current="page"' : ''}>${icon(item.icon)}<span><b>${item.korean}</b><small>${item.label}</small></span></button>`).join('')}
      </nav>

      <div class="sidebar-spacer"></div>
      <div class="care-card">
        <div class="sidebar-help-title">${icon('help')}<strong>도움이 필요하신가요?</strong></div>
        <a href="https://github.com/shinejihun1227/26CAP/blob/final/README.md" target="_blank" rel="noopener noreferrer">사용 가이드 ↗</a>
        <button class="text-button" data-view="devices">기기 연결 확인 ${icon("arrow")}</button>
      </div>
      <div class="sidebar-footer connection-${connection.tone}">
        <span class="status-dot"></span>
        <span>${connection.label}</span>
        <span class="sidebar-version">v0.1</span>
      </div>
    </aside>
  `;
}
