import { icon } from "./icons.js";
import { escapeHtml, formatDateLabel, formatTimeLabel } from "../utils/text.js";
import { connectionSummary } from "./connection-summary.js";
import { renderFogControl } from './fog-control.js';

export function renderTopbar(state) {
  const profileName = String(state.profile?.configured ? state.profile.name || '사용자' : '사용자');
  const name = escapeHtml(profileName);
  const mode = escapeHtml(state.profile?.configured ? state.profile.mode ?? '내 프로필' : '프로필 설정');
  const connection = connectionSummary(state);
  const connectionLabel = connection.label;
  const connectionClass = `connection-${connection.tone}`;
  const fogSoundEnabled = Boolean(state.fogSoundEnabled ?? state.mobileFogSoundEnabled);
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
        <button class="editor-link-button topbar-audio-toggle ${fogSoundEnabled ? 'is-enabled' : ''}" data-action="mobile-fog-sound" aria-label="${fogSoundEnabled ? 'FoG 소리와 음성 알림 끄기' : 'FoG 소리와 음성 알림 켜고 테스트하기'}" aria-pressed="${fogSoundEnabled}" title="소리 알림을 켜고 테스트음과 음성 안내를 확인합니다.">
          ${icon("bell")}<span>${fogSoundEnabled ? '소리·음성 켜짐' : '소리·경고 테스트'}</span>
        </button>
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
      ${renderFogControl(state)}
    </header>
  `;
}
