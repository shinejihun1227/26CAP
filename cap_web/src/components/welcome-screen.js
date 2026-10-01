import { icon } from './icons.js';
import { escapeHtml as e } from '../utils/text.js';
import { renderAppFeatures, renderFeatureScope } from './app-features.js';

export function renderWelcomeScreen(state) {
  const profile = state.profile?.configured ? state.profile : {};
  return `<div class="welcome-page">
    <header class="welcome-brand"><span class="welcome-mark" aria-hidden="true">S</span><b>STEPON</b><span>내 걸음 관찰의 시작</span></header>
    <main class="welcome-layout">
      <div class="welcome-intro"><span class="welcome-kicker">두 발의 센서, 한눈에 보는 내 걸음</span><h1>내 걸음,<br><em>내 발에 맞게.</em></h1><p>보행동결부터 발의 움직임, 보행 자세까지<br class="welcome-wide-only"> 세 가지 기능을 함께 사용해요.</p></div>
      <section class="welcome-profile" aria-labelledby="welcome-profile-title">
        <div class="welcome-form-heading">${icon('user')}<h2 id="welcome-profile-title">이름만 알려 주세요</h2></div>
        <form id="profile-form">
          <label for="profile-name">이름 또는 별명</label><input id="profile-name" name="name" autocomplete="nickname" maxlength="24" value="${e(profile.name)}" placeholder="어떻게 불러드릴까요?" required>
          <label for="profile-age">나이 <span>선택</span></label><div class="welcome-age"><input id="profile-age" name="age" type="number" inputmode="numeric" min="1" max="120" step="1" value="${e(profile.age)}" placeholder="입력하지 않아도 돼요"><span aria-hidden="true">세</span></div>
          <p data-profile-error role="alert"></p>
          <p class="welcome-privacy">${icon('shield')} 입력한 정보는 이 브라우저에 저장돼요.</p>
          <button class="welcome-start" type="submit">StepOn 시작하기 ${icon('arrow')}</button>
          <button class="welcome-skip" type="button" data-action="preview-dashboard">입력 없이 둘러보기</button>
        </form>
      </section>
      <section class="welcome-features" aria-labelledby="welcome-features-title"><div class="welcome-feature-heading"><h2 id="welcome-features-title">StepOn이 함께 살펴드려요</h2><span>세 가지 기능 모두 제공</span></div>${renderAppFeatures()}</section>
      <footer class="welcome-footer"><p>내 움직임의 변화를 살펴보는 관찰 도구예요. 알림은 시작 후 켜고 끌 수 있어요.</p>${renderFeatureScope()}</footer>
    </main>
  </div>`;
}
