import { escapeHtml } from '../utils/text.js';

export function pressureCalibrationText(calibration) {
  return calibration?.status === 'ready' ? '보행 최고값 = 100%'
    : calibration?.status === 'incomplete' ? '압력 수집 부족 · 다시 보정'
    : calibration?.status === 'mismatch' ? '기기·배치 변경 · 다시 보정'
    : calibration?.status === 'unavailable' ? '압력 수신 대기'
    : '보정 전 · 센서 기본값';
}

export function renderPressureCalibrationStatus(state) {
  if (state.dataSource !== 'esp32') return '';
  return `<div class="pressure-calibration-status"><div><b>내 걸음 기준 압력</b><span>정상 보행 20초의 센서별 최고값을 100%로 표시해요.</span></div><div class="pressure-calibration-feet">${['left', 'right'].map(side => {
    const raw = state.hardware?.transport === 'sta' ? state.hardware.feet?.[side]?.state
      : state.hardware?.footSide === side ? state.hardware.raw : null;
    return `<span><b>${side === 'left' ? '왼발' : '오른발'}</b> ${escapeHtml(pressureCalibrationText(raw?.pressure_calibration))}</span>`;
  }).join('')}</div><button class="text-button" type="button" data-view="devices" data-open-disclosure="device-baselines">BMI·압력 보정 →</button></div>`;
}
