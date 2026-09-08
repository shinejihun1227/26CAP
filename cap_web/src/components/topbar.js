import { icon } from "./icons.js";
import { escapeHtml, formatDateLabel, formatTimeLabel } from "../utils/text.js";

export function renderTopbar(state) {
  const name = escapeHtml(state.profile.name);
  const mode = escapeHtml(state.profile.mode ?? "관찰자 프로필");
  const isEsp32 = state.dataSource === "esp32";
  const connectionLabel = isEsp32 ? (state.connected ? "ESP32 연결됨" : "ESP32 연결 끊김") : "로컬 시연 데이터";
  const connectionClass = isEsp32 && !state.connected ? "is-disconnected" : isEsp32 ? "is-connected" : "is-demo";
  return `
    <header class="topbar">
      <div class="mobile-brand"><div class="brand-mark">S</div><strong>STEPON</strong></div>
      <div class="topbar-context">
        <span class="context-kicker">${formatDateLabel()}</span>
        <span class="context-divider"></span>
        <span>${formatTimeLabel()} 기준</span>
      </div>
      <div class="topbar-actions">
        <span class="topbar-sensor-status ${connectionClass}"><i></i>${connectionLabel}</span>
        <button class="editor-link-button" data-action="open-editor">화면 편집</button>
        <button class="icon-button notification-button" data-action="notifications" aria-label="알림 보기">
          ${icon("bell")}<span class="notification-dot"></span>
        </button>
        <button class="profile-button" data-action="profile">
          <span class="avatar">${state.profile.name.slice(0, 1)}</span>
          <span class="profile-copy"><b>${name}</b><small>${mode}</small></span>
          ${icon("chevron")}
        </button>
      </div>
    </header>
  `;
}
