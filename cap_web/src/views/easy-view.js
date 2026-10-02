import { renderTopbar } from '../components/topbar.js';
import { aiPresentation } from '../components/ai-status-card.js';
import { renderPurposeContent } from './purpose-view.js';

export function renderEasyContent(state = {}) {
  return renderPurposeContent(state);
}

export function renderEasyLiveContent(state) {
  const fog = aiPresentation(state), alert = state.dataSource === 'esp32' && ['warning', 'confirmed'].includes(fog.status);
  return `<section class="easy-page ankle-easy-live"><header class="easy-heading"><span>AI 보행동결</span><h1>${alert ? '잠시 멈춰 주세요' : '현재 보행 신호'}</h1><p>BMI 보정 → AI 분석 → FoG 알림</p></header><section class="easy-fog-status ${alert ? 'is-alert' : ''}"><b>${state.dataSource === 'esp32' ? fog.meta.label : '신발 연결 후 확인'}</b><p>${fog.meta.detail}</p><button data-action="mobile-fog-sound">${state.fogSoundEnabled ? '소리 알림 끄기' : '소리 켜기 · 테스트'}</button><button data-view="devices" data-open-disclosure="device-baselines">양발 BMI 보정 하러가기</button><button data-action="fog-cue-stop" ${!state.ai?.available?'disabled':''}>진동·레이저 자동 출력 중지</button></section><div class="easy-secondary-actions"><button data-view="ankle">발 움직임 기록</button><button data-view="mediapipe">정면 보행 관찰</button></div></section>`;
}

export function renderEasyView(state) {
  return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">${renderEasyContent(state)}</main></div>`;
}
