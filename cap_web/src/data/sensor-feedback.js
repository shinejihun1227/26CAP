// The language model chooses from these observation actions; it cannot invent
// a diagnosis, anatomical direction, exercise prescription or new threshold.
export const FEEDBACK_ACTIONS = {
  walk_even_surface: '평소에는 평평하고 장애물이 없는 길에서 편안한 속도로 걸으세요. 표시된 센서 방향의 반대쪽으로 발을 억지로 꺾지 마세요.',
  walk_supportive_shoes: '발에 잘 맞고 발을 지지해 주는 신발을 신고, 편안한 속도로 걸으세요. 걷다가 통증이나 불편함이 생기면 멈추세요.',
  walk_front_pressure: '앞쪽 쏠림을 줄이려고 뒤꿈치에만 힘을 주어 걷지 마세요. 평평한 바닥에서 편안한 속도로 걸으세요.',
  walk_rear_pressure: '뒤쪽 쏠림을 줄이려고 발끝으로만 걷지 마세요. 평평한 바닥에서 편안한 속도로 걸으세요.',
  check_attachment: '센서가 처음 보정할 때와 같은 위치에 단단히 붙어 있는지 확인하세요.',
  repeat_baseline: '발을 편히 놓고 기준 자세를 다시 맞춘 뒤, 같은 움직임을 비교해 보세요.',
  comfortable_motion: '불편함이 없다면 앉아서 편한 범위로 발끝을 천천히 움직여 보세요. 반대 방향으로 억지로 꺾지 마세요.',
  check_front: '앞쪽 압력센서가 접히거나 신발에 눌려 있지 않은지 확인하세요.',
  check_rear: '뒤쪽 압력센서가 접히거나 신발에 눌려 있지 않은지 확인하세요.',
  check_surface: '잠시 멈춘 뒤 바닥이 고른지, 신발 안에 이물질이 없는지 확인하세요.',
  repeat_pressure: '편히 발을 디딘 상태에서 앞뒤 압력 표시를 다시 확인하세요. 억지로 50:50을 맞출 필요는 없어요.',
};
export const actionGroups = evidence => evidence.kind === 'rom'
  ? { walking: ['walk_even_surface', 'walk_supportive_shoes'], check: ['check_attachment', 'repeat_baseline'] }
  : { walking: [evidence.direction === 'front' ? 'walk_front_pressure' : 'walk_rear_pressure'],
    check: [evidence.direction === 'front' ? 'check_front' : 'check_rear', 'check_surface', 'repeat_pressure'] };
export const allowedActions = evidence => Object.values(actionGroups(evidence)).flat();
export function validFeedbackActions(evidence, ids) {
  const groups=actionGroups(evidence);
  return Array.isArray(ids) && ids.length===2 && groups.walking.includes(ids[0]) && groups.check.includes(ids[1]);
}
export function feedbackBasis(evidence) {
  if(evidence.kind==='rom') return `센서 ${sensorDirection(evidence.sensorX,evidence.sensorY)} · 개인 기준 ${evidence.rangeMax}° + 표시 여유 5°를 1초 이상 넘긴 기록이에요. 실제 발목 안쪽·바깥쪽 방향과 부상 위험도는 알 수 없어 일반적인 보행 안내를 드려요.`;
  return `${evidence.direction==='front'?'앞쪽':'뒤쪽'} 압력 비중 80% 이상이 3초 이상 이어진 기록이에요. ${evidence.pressureBasis === 'walk-max-v1' ? '센서별 보행 최고값으로 보정한 비율을 사용했어요. ' : ''}발이 거의 멈춘 구간의 상대값이므로, 이 값만으로 걷는 자세가 잘못됐다고 판단하지 않아요.`;
}
export function sensorDirection(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return '확인 불가';
  const axis = Math.abs(x) >= Math.abs(y) ? 'X' : 'Y', value = axis === 'X' ? x : y;
  return Math.abs(value) < .1 ? '기준 부근' : `${axis}${value >= 0 ? '+' : '−'} 방향`;
}
export function evidenceText(evidence) {
  const foot = evidence.side === 'left' ? '왼발' : '오른발';
  if (evidence.kind === 'rom') return `${foot} · 센서 ${sensorDirection(evidence.sensorX, evidence.sensorY)}으로 최대 ${evidence.peak}° 기울었어요. 기록 범위보다 ${Math.max(0, Math.round((evidence.peak - evidence.rangeMax) * 10) / 10)}° 컸어요.`;
  return `${foot} · ${evidence.direction === 'front' ? '앞쪽' : '뒤쪽'} 압력 비중이 ${evidence.seconds}초 동안 80% 이상이었어요. 관찰 중 최대 ${evidence.peakPercent}%예요.`;
}
