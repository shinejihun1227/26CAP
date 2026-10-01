import { escapeHtml as e } from '../utils/text.js';

export function renderFogControl(state) {
  const stopped = state.fogLocalStop || state.ai?.detectionEnabled === false;
  const unknown = state.fogControlError || (!state.ai?.available && stopped ? 'PC 연결이 끊겨 현재 중지 상태를 확인할 수 없어요.' : null);
  const supported = state.ai?.available && typeof state.ai.detectionEnabled === 'boolean';
  const note = state.dataSource === 'esp32' ? 'PC·휴대폰에 같은 설정 적용' : '시연 화면 · 실기기 모드에서 경고를 받을 수 있어요';
  const label = state.fogControlPending ? '변경 중…' : unknown ? '중지 다시 요청' : stopped ? '감지 재개' : '감지 중지';
  const status = unknown ? '이 화면 알림 중지 · PC 중지 미확인' : stopped ? 'FoG 감지 중지됨' : supported ? 'FoG 감지 모드 켜짐' : 'FoG 연결 확인 중';
  return `<div class="fog-detection-control ${stopped?'is-stopped':''}" data-fog-control><div><b data-live-copy>${status}</b><span data-live-copy>${unknown?e(unknown):stopped?'팝업·음성·자동 출력 중지':note}</span></div><button type="button" data-action="fog-detection-toggle" aria-pressed="${Boolean(stopped)}" ${state.fogControlPending?'disabled':''}>${label}</button></div>`;
}

export function renderFogPopup({ preview = false } = {}) {
  return `<section class="fog-alert-overlay" role="alertdialog" aria-modal="true" aria-labelledby="fog-alert-title" aria-describedby="fog-alert-description"><div class="fog-alert-card">${preview?'<div class="fog-test-label">알림 테스트 · 실제 감지가 아닙니다</div>':''}<span class="fog-alert-icon" aria-hidden="true">!</span><p>보행동결 신호 감지</p><h2 id="fog-alert-title">FoG가 발생하였습니다.</h2><b id="fog-alert-description">잠시 멈추고 안전을 확인해 주세요.</b><small>AI가 감지한 관찰 신호이며 의료적 확정 진단은 아닙니다.</small><button type="button" data-action="dismiss-fog-popup">${preview?'테스트 닫기':'확인했습니다'}</button>${preview?'':'<button type="button" class="fog-popup-stop" data-action="fog-detection-toggle">감지 중지하기</button>'}</div></section>`;
}
