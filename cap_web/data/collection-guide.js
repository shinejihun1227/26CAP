export const PROTOCOL = 'stepon-five-movements-v1';
export const MOVEMENTS = [
  { id: 'standing', name: '가만히 서기', seconds: 30, icon: '01', instruction: '편하게 서서 몸을 움직이지 않고 기다려 주세요.', why: '쉬고 있을 때 불필요한 경고가 나오는지 살펴봐요.' },
  { id: 'walking', name: '평소처럼 걷기', seconds: 60, icon: '02', instruction: '평소 속도로 편하게 걸어 주세요. 센서는 같은 위치에 고정해 주세요.', why: '내 평소 걸음의 기준을 모아요.' },
  { id: 'slow_walking', name: '천천히 걷기', seconds: 60, icon: '03', instruction: '평소보다 천천히, 편안하게 걸어 주세요.', why: '느린 걸음에서도 잘 작동하는지 살펴봐요.' },
  { id: 'start_stop', name: '걷다가 멈추기', seconds: 60, icon: '04', instruction: '10초 걷기 → 5초 멈추기를 네 번 반복해 주세요. 아래 안내가 바뀌어요.', why: '스스로 멈췄을 때와 다시 걷기 시작할 때의 신호를 모아요.' },
  { id: 'turning', name: '방향 바꾸며 걷기', seconds: 60, icon: '05', instruction: '넉넉한 공간에서 걸으며 왼쪽과 오른쪽으로 천천히 방향을 바꿔 주세요.', why: '방향을 바꿀 때 불필요한 경고가 나오는지 살펴봐요.' },
];
export function movementCue(activity, elapsed) {
  if (activity === 'start_stop') return elapsed % 15 < 10 ? '평소처럼 걸어 주세요' : '잠깐 멈춰 서 주세요';
  return MOVEMENTS.find(m => m.id === activity)?.instruction ?? '선택한 동작을 해 주세요';
}
export function sameContext(item, context) {
  return ['participant_id', 'session_id', 'side', 'placement'].every(key => item.metadata?.[key] === context[key]);
}
export function guideProgress(items, context) {
  const own = items.filter(item => sameContext(item, context) && item.protocol === PROTOCOL && item.status === 'complete');
  return MOVEMENTS.map(m => ({ ...m, records: own.filter(item => item.kind === 'recording' && item.activity === m.id) }));
}
