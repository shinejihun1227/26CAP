import { icon } from "../components/icons.js";
import { navItems } from "../data/dashboard-data.js";
import { renderWelcomeScreen } from '../components/welcome-screen.js';
import { escapeHtml } from "../utils/text.js";
import { connectionSummary } from "../components/connection-summary.js";
import { renderLiveView } from "../views/live-view.js";
import { renderSafetyView } from "../views/safety-view.js";
import { renderDevicesView } from "../views/devices-view.js";
import { renderReportsContent } from "../views/reports-view.js";
import { renderTrendsContent } from "../views/trends-view.js";
import { renderRecordsContent } from "../views/records-view.js";
import { renderPurposeContent } from '../views/purpose-view.js';
import { renderFrontContent } from '../views/front-view.js';
import { renderAnkleDailyContent } from '../views/ankle-daily-view.js';
import { renderFogControl } from '../components/fog-control.js';

export function renderMobileApp(state, activeView) {
  const connection = connectionSummary(state);
  const pages = { overview: renderPurposeContent, easy: renderPurposeContent, live: renderLiveView, ankle: renderAnkleDailyContent, safety: renderSafetyView, devices: renderDevicesView };
  const content = pages[activeView] ? pages[activeView](state, { embedded: true })
    : activeView === 'mediapipe' ? renderFrontContent() : activeView === 'records' ? renderRecordsContent()
    : activeView === 'reports' ? renderReportsContent(state) : renderTrendsContent();
  const labels = { overview: '오늘 요약', easy: '오늘 요약', live: '보행동결', ankle: '발 움직임', mediapipe: '홈재활', safety: '압력·온습도', trends: '기록' };
  const mobileItems = navItems.filter(item => item.group !== 'manage' && item.id !== 'trends');
  return `<div class="mobile-app simple-mobile ${state.easyMode ? 'is-easy-mode' : ''}"><header class="simple-mobile-header"><b>STEPON</b><span>${escapeHtml(connection.label)}</span><button data-action="profile" aria-label="프로필 수정">${icon('user')}</button></header>
    <section class="mobile-fog-audio ${state.fogSoundEnabled ? 'is-enabled' : ''}" aria-label="휴대폰 소리 알림 및 FoG 음성 안내"><span aria-hidden="true">${icon('bell')}</span><div><b>${state.fogSoundEnabled ? 'FoG 소리·음성 알림 켜짐' : 'FoG 소리·음성 알림'}</b><small>${state.fogSoundEnabled ? 'FoG 신호가 확정되면 이 화면에서 알림음과 안내 멘트가 나옵니다.' : '처음 한 번 눌러 테스트음과 안내 멘트를 확인하세요.'}</small></div><button type="button" data-action="mobile-fog-sound" aria-pressed="${Boolean(state.fogSoundEnabled)}">${state.fogSoundEnabled ? '끄기' : '소리 켜기 · 테스트'}</button></section>
    ${renderFogControl(state)}
    <nav class="mobile-management" aria-label="설정과 데이터 관리"><button data-view="${state.easyMode ? 'overview' : 'easy'}" ${state.easyMode ? 'data-easy-exit="true"' : ''} ${activeView === 'easy' ? 'aria-current="page"' : ''}>${state.easyMode ? '일반 화면으로' : '쉬운 화면'}</button>${navItems.filter(item => item.group === 'manage').map(item => `<button data-view="${item.id}" ${activeView === item.id ? 'aria-current="page"' : ''}>${item.korean}</button>`).join('')}</nav>
    <main class="mobile-main">${content}</main><nav class="mobile-tabbar" aria-label="모바일 주요 메뉴">${mobileItems.map(item => `<button class="mobile-tab ${(activeView === item.id || (activeView === 'easy' && item.id === 'overview')) ? 'is-active' : ''}" data-view="${item.id}" ${(activeView === item.id || (activeView === 'easy' && item.id === 'overview')) ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${labels[item.id]}</span></button>`).join('')}</nav></div>`;
}

export const renderMobileOnboarding = renderWelcomeScreen;
