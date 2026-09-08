import { navItems } from "../data/dashboard-data.js";
import { icon } from "./icons.js";

const mobileNavLabels = {
  overview: "요약",
  live: "실시간",
  safety: "안전",
  reports: "리포트",
  devices: "기기",
  mediapipe: "개인화",
};

export function renderSidebar(activeView) {
  return `
    <aside class="sidebar">
      <div class="brand-lockup">
        <div class="brand-mark">S</div>
        <div>
          <strong>STEPON</strong>
          <span>GAIT CARE SYSTEM</span>
        </div>
      </div>

      <div class="sidebar-section-label">WORKSPACE</div>
      <nav class="primary-nav" aria-label="주요 메뉴">
        ${navItems.map((item) => `
          <button class="nav-item ${activeView === item.id ? "is-active" : ""}" data-view="${item.id}">
            ${icon(item.icon)}
            <span><b>${item.label}</b><small>${item.korean}</small><em class="nav-item-mobile-label">${mobileNavLabels[item.id] ?? item.label}</em></span>
          </button>
        `).join("")}
      </nav>

      <div class="sidebar-spacer"></div>
      <div class="care-card">
        <div class="care-card-icon">${icon("shoe")}</div>
        <strong>오늘도 가볍게</strong>
        <p>센서와 함께<br />안전한 걸음을 만들어보세요.</p>
        <button class="text-button" data-action="learn-more">사용 안내 ${icon("arrow")}</button>
      </div>
      <div class="sidebar-footer">
        <span class="status-dot"></span>
        <span>로컬 기기 연결됨</span>
        <span class="sidebar-version">v0.1</span>
      </div>
    </aside>
  `;
}
