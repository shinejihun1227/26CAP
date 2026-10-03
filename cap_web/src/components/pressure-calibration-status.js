import { escapeHtml } from '../utils/text.js';

export function pressureCalibrationForFoot(state, side) {
  const raw = state.hardware?.transport === 'sta' ? state.hardware.feet?.[side]?.state
    : state.hardware?.footSide === side ? state.hardware.raw : null;
  return raw?.pressure_calibration;
}

// Label older servers honestly until the standing-reference backend is active.
export function pressureReferenceScore(calibration) {
  return calibration?.method === 'standing-50-v1' ? 50 : calibration?.reference_score === 90 ? 90 : calibration?.status === 'ready' ? 100 : 50;
}

export function displayedPressureReference(state) {
  return pressureReferenceScore(['left', 'right'].map(side => pressureCalibrationForFoot(state, side)).find(c => c?.status === 'ready'));
}

export function pressureCalibrationText(calibration) {
  return calibration?.status === 'ready' ? calibration.method === 'standing-50-v1' ? '서 있을 때 = 50점' : `이전 보행 기준 ${pressureReferenceScore(calibration)}점 · 다시 보정`
    : calibration?.status === 'recalibration_required' ? '서 있는 기준 필요 · BMI·압력 다시 보정'
    : calibration?.status === 'incomplete' ? '압력 수집 부족 · 다시 보정'
    : calibration?.status === 'mismatch' ? '기기·배치 변경 · 다시 보정'
    : calibration?.status === 'unavailable' ? '압력 수신 대기'
    : '보정 전 · 센서 기본값';
}

export function renderPressureCalibrationStatus(state) {
  if (state.dataSource !== 'esp32') return '';
  return `<div class="pressure-calibration-status"><div><b>서 있을 때 50점 · 압력 비교</b><span>보정 첫 5초에 편히 서 주세요. 그때의 센서별 값을 50점으로 저장하고, 움직일 때도 같은 기준으로 비교해요. 화면은 0~100점으로 표시해요.</span></div><div class="pressure-calibration-feet">${['left', 'right'].map(side => {
    return `<span><b>${side === 'left' ? '왼발' : '오른발'}</b> ${escapeHtml(pressureCalibrationText(pressureCalibrationForFoot(state, side)))}</span>`;
  }).join('')}</div><button class="text-button" type="button" data-view="devices" data-open-disclosure="device-baselines">BMI·압력 보정 →</button></div>`;
}
