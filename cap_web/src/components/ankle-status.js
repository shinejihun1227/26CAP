import { escapeHtml as e } from '../utils/text.js';
import { ANKLE_MARGIN_DEG } from '../mediapipe/ankle-monitor.js';
const deg = n => Number.isFinite(n) ? `${n.toFixed(1)}°` : '—';
export function renderAnkleStatus(feet = {}, { compact = false } = {}) {
  return `<div class="ankle-status-grid">${['left', 'right'].map(side => {
    const f = feet[side] || {}, plan = f.plan;
    const code = f.code || 'unprepared', name = side === 'left' ? '왼발' : '오른발';
    const detail = code === 'outside' ? '잠시 멈춰 자세와 신발을 확인하세요.'
      : code === 'within' ? '멈췄을 때의 발 기울기를 비교합니다.'
      : code === 'moving' ? '걷는 동안에는 정확한 비교가 어려워요.'
      : code === 'changed' ? '기기 또는 전원이 바뀌었어요.'
      : code === 'checking' ? '잠깐 멈춰 확인해 주세요.'
      : plan ? '신발 전원과 연결을 확인해 주세요.' : '신발을 신고 앉아서 기준을 기록하세요.';
    return `<article class="ankle-foot-status is-${code}" data-ankle-foot="${side}"><div class="ankle-status-top"><b>${name}</b><span>${f.ok ? '센서 연결됨' : '센서 확인 필요'}</span></div><h3>${e(f.label || '오늘 기준 기록 필요')}</h3><p>${detail}</p>${!compact ? `<dl class="ankle-values"><div><dt>카메라 최소–최대</dt><dd>${plan ? `${deg(plan.cameraMin)} – ${deg(plan.cameraMax)}` : '기록 전'}</dd></div><div><dt>현재 발 기울기</dt><dd>${deg(f.tilt)}</dd></div></dl>` : ''}${plan && !compact ? `<small>기준 자세 대비 센서 ${deg(plan.sensorMax)}까지 관찰 · 표시 여유 ${ANKLE_MARGIN_DEG}°</small>` : ''}</article>`;
  }).join('')}</div>`;
}
export function renderAnkleLivePanel(state) {
  return `<section class="ankle-live-panel"><div class="ankle-section-title"><div><span>오늘의 개인 기준</span><h2>발 기울기 확인</h2></div><button type="button" data-view="mediapipe">기준 다시 기록</button></div>${renderAnkleStatus(state.ankle)}<p class="ankle-scope-note">발의 기울기 비교입니다. 발목 관절각·부상 위험을 판단하지 않아요. 신발을 다시 신으면 기준도 다시 기록하세요.</p></section>`;
}
