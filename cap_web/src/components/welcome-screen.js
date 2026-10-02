import { icon } from './icons.js';
import { escapeHtml as e } from '../utils/text.js';
import { renderAppFeatures, renderFeatureScope } from './app-features.js';

// Decorative insole illustration: no measured values or connection status.
function welcomeIllustration() {
  const sole = 'M76 17 C104 17 116 46 112 78 C109 107 89 117 94 146 C100 173 98 205 77 211 C51 221 39 193 43 163 C50 130 35 117 32 88 C28 47 47 18 76 17Z';
  return `<div class="welcome-visual" aria-hidden="true"><svg viewBox="0 0 220 260" fill="none">
    <ellipse cx="110" cy="223" rx="96" ry="23" stroke="#7ea7af" stroke-opacity=".28"/>
    <path d="M20 224H200 M110 24V244" stroke="#7ea7af" stroke-opacity=".2" stroke-dasharray="3 7"/>
    <g transform="translate(-1 11) rotate(-12 75 120) scale(.86)"><path d="${sole}" fill="#325f6d" stroke="#8bb5bd" stroke-width="1.5"/><path d="M75 48V179" stroke="#8bb5bd" stroke-dasharray="3 5"/><circle cx="75" cy="66" r="19" fill="#9bd3c3" fill-opacity=".16"/><circle cx="75" cy="66" r="7" fill="#b8e3d7"/><circle cx="72" cy="173" r="13" fill="#9bd3c3" fill-opacity=".16"/><circle cx="72" cy="173" r="5" fill="#b8e3d7"/></g>
    <g transform="translate(109 18) rotate(12 46 120) scale(.86)"><path d="${sole}" transform="translate(150 0) scale(-1 1)" fill="#234b5c" stroke="#8aacc1" stroke-width="1.5"/><path d="M75 48V179" stroke="#8aacc1" stroke-dasharray="3 5"/><circle cx="75" cy="66" r="19" fill="#b1cfe5" fill-opacity=".16"/><circle cx="75" cy="66" r="7" fill="#c0d9eb"/><circle cx="78" cy="173" r="13" fill="#b1cfe5" fill-opacity=".16"/><circle cx="78" cy="173" r="5" fill="#c0d9eb"/></g>
    <path d="M37 235V242H62 M182 235V242H158" stroke="#b8d2d8" stroke-width="1.5"/>
  </svg><span>두 발에서 시작하는 기록</span></div>`;
}

export function renderWelcomeScreen(state) {
  const profile = state.profile?.configured ? state.profile : {};
  return `<div class="welcome-page">
    <header class="welcome-brand"><span class="welcome-mark" aria-hidden="true">S</span><b>STEPON<span>보행 · 움직임 기록</span></b><span class="welcome-brand-note">나에게 맞춘 걸음 관찰</span></header>
    <main class="welcome-layout">
      <section class="welcome-intro" aria-labelledby="welcome-title"><div class="welcome-intro-copy"><span class="welcome-kicker">매일의 움직임을 이해하는 작은 시작</span><h1 id="welcome-title">내 걸음과 움직임,<br><em>한눈에</em> 살펴보세요.</h1><p>양발 센서와 카메라로 기록하고,<br>나에게 어떤 변화가 있는지 확인해요.</p></div>${welcomeIllustration()}<ol class="welcome-journey" aria-label="StepOn 사용 순서"><li><b>01</b>양발 보정</li><li><b>02</b>움직임 관찰</li><li><b>03</b>기록 확인</li></ol></section>
      <section class="welcome-profile" aria-labelledby="welcome-profile-title">
        <div class="welcome-form-heading"><span class="welcome-form-icon" aria-hidden="true">${icon('user')}</span><span class="welcome-form-kicker">나의 기록 시작하기</span><h2 id="welcome-profile-title">어떻게 불러드릴까요?</h2><p>별명만 입력해도 모든 기능을 이용할 수 있어요.</p></div>
        <form id="profile-form">
          <label for="profile-name">이름 또는 별명</label><input id="profile-name" name="name" autocomplete="nickname" maxlength="24" value="${e(profile.name)}" placeholder="예: 김지은" required>
          <label for="profile-age">나이 <span>선택</span></label><div class="welcome-age"><input id="profile-age" name="age" type="number" inputmode="numeric" min="1" max="120" step="1" value="${e(profile.age)}" placeholder="입력하지 않아도 돼요"><span aria-hidden="true">세</span></div>
          <p data-profile-error role="alert"></p>
          <button class="welcome-start" type="submit">StepOn 시작하기 ${icon('arrow')}</button>
          <button class="welcome-skip" type="button" data-action="preview-dashboard">입력 없이 먼저 둘러보기</button>
          <p class="welcome-privacy">${icon('shield')} 입력한 정보는 이 브라우저에 저장돼요.</p>
        </form>
      </section>
      <section class="welcome-features" aria-labelledby="welcome-features-title"><div class="welcome-feature-heading"><h2 id="welcome-features-title">StepOn과 함께 살펴볼 세 가지</h2><span>기능 선택 없이 모두 이용</span></div>${renderAppFeatures({compact:true})}</section>
      <footer class="welcome-footer"><p>${icon('shield')}<span>움직임의 변화를 살피는 관찰 도구예요.<br>의료적 진단을 대신하지 않습니다.</span></p>${renderFeatureScope()}</footer>
    </main>
  </div>`;
}
