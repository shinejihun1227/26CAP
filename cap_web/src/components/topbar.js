import { icon } from "./icons.js";
import { escapeHtml, formatDateLabel, formatTimeLabel } from "../utils/text.js";
import { connectionSummary } from "./connection-summary.js";

export function renderTopbar(state) {
  const profileName = String(state.profile?.configured ? state.profile.name || '사용자' : '사용자');
  const name = escapeHtml(profileName);
  const mode = escapeHtml(state.profile?.configured ? state.profile.mode ?? '내 프로필' : '프로필 설정');
  const connection = connectionSummary(state);
  const connectionLabel = connection.label;
  const connectionClass = `connection-${connection.tone}`;
  return `
    <header class="topbar">
      <div class="mobile-brand"><div class="brand-mark">S</div><strong>STEPON</strong></div>
      <div class="topbar-context">
        <span class="context-kicker">${formatDateLabel()}</span>
        <span class="context-divider"></span>
        <span>${formatTimeLabel()} 기준</span>
      </div>
      <div class="topbar-actions">
        <button class="topbar-sensor-status ${connectionClass}" data-view="devices" aria-label="${connectionLabel} · 기기 관리 열기"><i></i><span data-live-copy>${connectionLabel}</span></button>
        <button class="editor-link-button" data-action="open-editor" title="팀원용 화면 디자인 편집">화면 편집</button>
        <button class="icon-button notification-button" data-action="notifications" aria-label="알림 보기">
          ${icon("bell")}${state.events?.length ? '<span class="notification-dot"></span>' : ''}
        </button>
        <button class="profile-button" data-action="profile">
          <span class="avatar">${escapeHtml(profileName.slice(0, 1))}</span>
          <span class="profile-copy"><b>${name}</b><small>${mode}</small></span>
          ${icon("chevron")}
        </button>
      </div>
    </header>
  `;
}
