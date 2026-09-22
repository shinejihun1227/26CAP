import { icon } from "../components/icons.js";
import { cueOptions, navItems, observationGoals } from "../data/dashboard-data.js";
import { escapeHtml } from "../utils/text.js";
import { connectionSummary } from "../components/connection-summary.js";
import { renderOverview } from "../views/overview-view.js";
import { renderLiveView } from "../views/live-view.js";
import { renderSafetyView } from "../views/safety-view.js";
import { renderDevicesView } from "../views/devices-view.js";
import { renderReportsContent } from "../views/reports-view.js";
import { renderMediaPipeContent } from "../views/mediapipe-view.js";
import { renderTrendsContent } from "../views/trends-view.js";
import { renderRecordsContent } from "../views/records-view.js";

export function renderMobileApp(state, activeView) {
  const connection = connectionSummary(state);
  const pages = { overview: renderOverview, live: renderLiveView, safety: renderSafetyView, devices: renderDevicesView };
  const content = pages[activeView] ? pages[activeView](state, { embedded: true })
    : activeView === 'mediapipe' ? renderMediaPipeContent() : activeView === 'records' ? renderRecordsContent()
    : activeView === 'reports' ? renderReportsContent(state) : renderTrendsContent();
  const labels = { overview: '요약', live: '보행 측정', mediapipe: '관절 측정', trends: '변화 보기' };
  return `<div class="mobile-app simple-mobile"><header class="simple-mobile-header"><b>STEPON</b><span>${escapeHtml(connection.label)}</span><button data-action="profile" aria-label="프로필 수정">${icon('user')}</button></header>
    <nav class="mobile-management" aria-label="설정과 데이터 관리">${navItems.filter(item => item.group === 'manage').map(item => `<button data-view="${item.id}" ${activeView === item.id ? 'aria-current="page"' : ''}>${item.korean}</button>`).join('')}</nav>
    <main class="mobile-main">${content}</main><nav class="mobile-tabbar" aria-label="모바일 주요 메뉴">${navItems.filter(item => item.group !== 'manage').map(item => `<button class="mobile-tab ${activeView === item.id ? 'is-active' : ''}" data-view="${item.id}" ${activeView === item.id ? 'aria-current="page"' : ''}>${icon(item.icon)}<span>${labels[item.id]}</span></button>`).join('')}</nav></div>`;
}

export function renderMobileOnboarding(state) {
  const profile = state.profile ?? {};
  const selectedGoals = profile.goals ?? ["daily"];
  const selectedCues = profile.preferredCues ?? ["laser", "vibration", "voice"];
  return `<div class="mobile-onboarding"><header class="mobile-onboarding-header"><div class="mobile-brand-lockup"><div class="brand-mark">S</div><div><strong>STEPON</strong><span>GAIT CARE SYSTEM</span></div></div><span>PROFILE SETUP · 01</span></header><main class="mobile-onboarding-main"><div class="mobile-progress"><i></i><span>1 / 1</span></div><span class="eyebrow">A GENTLER START</span><h1>나에게 맞는<br /><em>걸음 관찰</em>을 시작해요.</h1><p class="mobile-onboarding-lead">처음 한 번만 현재 상태와 받고 싶은 안내를 알려주세요. 선택한 목적에 맞춰 필요한 화면을 정리해드릴게요.</p><form id="profile-form" class="mobile-profile-form"><section><label for="mobile-profile-name">어떻게 불러드릴까요?</label><input id="mobile-profile-name" name="name" value="${escapeHtml(profile.name ?? "")}" placeholder="이름 또는 별명" required /><div class="mobile-input-grid"><label for="mobile-profile-age">연령<input id="mobile-profile-age" name="age" type="number" min="1" max="120" value="${escapeHtml(profile.age ?? "")}" placeholder="예: 68" required /></label><fieldset><legend>성별 <small>선택</small></legend><label><input type="radio" name="gender" value="female" ${profile.gender === "female" ? "checked" : ""} /> 여성</label><label><input type="radio" name="gender" value="male" ${profile.gender === "male" ? "checked" : ""} /> 남성</label><label><input type="radio" name="gender" value="none" ${!profile.gender || profile.gender === "none" ? "checked" : ""} /> 선택 안 함</label></fieldset></div></section><section><div class="mobile-form-section-title"><b>어떤 관찰이 필요하신가요?</b><small>복수 선택 가능</small></div><div class="mobile-goal-list">${observationGoals.map((goal) => `<label class="mobile-choice-card"><input type="checkbox" name="goals" value="${goal.id}" ${selectedGoals.includes(goal.id) ? "checked" : ""} /><span><b>${goal.label}</b><small>${goal.desc}</small></span><i>✓</i></label>`).join("")}</div></section><section><div class="mobile-form-section-title"><b>어떤 방식으로 안내받을까요?</b><small>필요한 안내만 선택할 수 있어요</small></div><div class="mobile-cue-list">${cueOptions.map((cue) => `<label class="mobile-choice-card"><input type="checkbox" name="cues" value="${cue.id}" ${selectedCues.includes(cue.id) ? "checked" : ""} /><span class="mobile-choice-icon">${icon(cue.id === "laser" ? "cue" : cue.id === "vibration" ? "activity" : "bell")}</span><span><b>${cue.label}</b><small>${cue.desc}</small></span><i>✓</i></label>`).join("")}</div></section><div class="mobile-form-actions"><button class="mobile-primary-button" type="submit">내 맞춤 화면 만들기 ${icon("arrow")}</button><button class="mobile-preview-button" type="button" data-action="preview-dashboard">프로필 입력 전 대시보드 미리보기</button></div></form><p class="mobile-disclaimer">StepOn은 보행과 발 상태를 관찰하는 보조 도구입니다. 의료적 진단을 대신하지 않습니다.</p></main></div>`;
}
