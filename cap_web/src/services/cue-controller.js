export function speakCue(message) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = "ko-KR";
  utterance.rate = 0.9;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
  return true;
}

export const cueMessages = {
  laser: "레이저 기준점을 따라 천천히 발을 내딛어 주세요.",
  vibration: "진동 안내를 확인하고 천천히 걸어주세요.",
  voice: "현재 보행 상태를 확인하고 다음 걸음을 준비해 주세요.",
};

export function outputTestError(error, side) {
  const foot = side === 'right' ? '오른발' : '왼발';
  const code = error?.message || '';
  if (code === 'real_sensor_mode_required') return '실센서 모드에서 ESP32를 연결한 뒤 테스트하세요.';
  if (code === 'selected_foot_offline') return `${foot}이 연결되지 않았어요. 기기 설정의 분석·출력 대상과 IP를 확인하세요.`;
  if (code === 'drv2605_not_ready') return `${foot} DRV2605L이 인식되지 않았어요. 전원·GND·SDA GPIO13·SCL GPIO14를 확인한 뒤 EN/RESET을 누르세요.`;
  if (code === 'vibration_unavailable') return `${foot} 진동 명령이 거부됐어요. DRV2605L 연결과 센서 갱신 상태를 확인하세요.`;
  if (code === 'laser_disabled_for_safety') return `${foot} 펌웨어에서 레이저가 비활성화되어 있어요. ENABLE_LASER_OUTPUT=true인 최신 4-2 펌웨어를 업로드하세요.`;
  return `${foot} 출력 명령에 실패했어요. 연결을 확인하세요. (${code || '응답 없음'})`;
}

// A delivered command is not proof of physical motor/laser operation.
export async function runOutputTest({ kind, side, enabled, laser, vibration, notify,
  wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!enabled) throw new Error('real_sensor_mode_required');
  if (!['laser', 'vibration'].includes(kind)) throw new Error('invalid_output_test');
  const foot = side === 'right' ? '오른발' : '왼발';
  const name = kind === 'laser' ? '레이저' : '진동';
  notify(`${foot} ${name} 테스트 명령 전달 중…`);
  if (kind === 'vibration') {
    await vibration(47, side);
    notify(`${foot} 진동 명령이 접수됐어요. 실제 모터가 움직이는지 확인하세요.`);
    return;
  }
  // Always attempt OFF, including when the ON response is lost after acceptance.
  try {
    await laser(true, side);
    notify(`${foot} 레이저 명령이 접수됐어요. 실제 불빛이 켜지는지 확인하세요.`);
    await wait(650);
  } finally {
    try { await laser(false, side); }
    catch (error) { notify(`레이저 종료 응답을 받지 못했어요. 보드의 자동 종료를 확인하세요. ${outputTestError(error, side)}`); }
  }
}
