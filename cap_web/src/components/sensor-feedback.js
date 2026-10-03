import { escapeHtml as e } from '../utils/text.js';
import { FEEDBACK_ACTIONS, evidenceText, sensorDirection, feedbackBasis, validFeedbackActions, recordedFootDirection, romEvidenceDetail } from '../data/sensor-feedback.js';

const name = side => side === 'left' ? '왼발' : '오른발';
const time = at => new Date(at).toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
export function renderSensorFeedback(state, kind) {
  const source = state.sensorFeedback, real = state.dataSource === 'esp32';
  const busy = Object.values(state.sensorFeedbackRequests || {}).some(r => r.pending);
  const rows = ['left', 'right'].map(side => {
    const record = real ? source?.data?.entries?.find(entry => entry.kind === kind && entry.side === side)?.evidence : null;
    const request = state.sensorFeedbackRequests?.[`${kind}-${side}`];
    const matching = Boolean(request?.eventId && request.eventId === record?.id);
    const result = matching && validFeedbackActions(record,request?.result?.actionIds) ? request.result : null;
    const evidence = result?.evidence || record;
    const direction = kind==='rom' && evidence ? recordedFootDirection(evidence) : null;
    const empty = !real ? '실제 센서를 연결해 주세요.' : source?.error ? '관찰 서버 연결을 확인해 주세요.' : kind === 'rom'
      ? '오늘 확인된 범위 이탈 기록이 없어요.'
      : ({ offline: '신발 연결 후 관찰해요.', moving: '발이 거의 멈추면 쏠림을 확인해요.', pressure_missing: '발을 디딘 압력값이 필요해요.', collecting: '쏠림이 지속되는지 확인 중이에요.' }[source?.data?.pressureState?.[side]] || '오늘 지속된 압력 쏠림 기록이 없어요.');
    return `<article class="sensor-feedback-row" data-feedback-row="${kind}-${side}">
      <div class="sensor-feedback-heading"><b>${name(side)}</b><span>${evidence ? `${time(evidence.at)} 관찰 기록` : '관찰 대기'}</span></div>
      ${evidence ? `<p class="sensor-feedback-observation ${kind==='rom'?'sensor-feedback-caution':''}">${e(evidenceText(evidence))}</p>
        ${kind === 'rom' ? `<p class="sensor-feedback-direction-note">${direction?'최대 기울기 순간, 발에서 들린 쪽을 기준으로 안내해요.':'이 기록에는 발의 방향 기준이 없어요. 방향을 다시 기록하면 안쪽·바깥쪽을 안내해요.'}</p>
        ${!direction?`<button type="button" class="today-link" data-view="ankle" data-daily-focus="${side}">${name(side)} 방향 다시 기록 ↗</button>`:''}
        <details class="sensor-feedback-evidence" data-ui-disclosure="feedback-${kind}-${side}"><summary>측정값·방향 근거 보기</summary><p>${e(romEvidenceDetail(evidence))}<br>센서 ${e(sensorDirection(evidence.sensorX, evidence.sensorY))} · X ${e(evidence.sensorX)}° / Y ${e(evidence.sensorY)}°<br>${direction?'당시 발끝 들기 보정 기준이에요. 실제 관절 꺾임 각도나 손상 방향을 뜻하지 않아요.':'센서 X/Y 축만으로 안쪽·바깥쪽을 정하지 않아요.'}</p></details>` : ''}
        ${result ? `<div class="sensor-feedback-answer" role="status"><span class="sensor-feedback-model">OLLAMA · 일반 보행 안내</span><ol>${result.actionIds.map((id,index) => `<li><b>${index===0?'평소 걸을 때':'다음에 확인할 점'}</b>${e(FEEDBACK_ACTIONS[id])}</li>`).join('')}</ol><details class="sensor-feedback-evidence" data-ui-disclosure="feedback-basis-${kind}-${side}"><summary>이 안내를 고른 기준</summary><p>${e(feedbackBasis(evidence))}</p></details><small>${e(result.model)} · ${time(result.generatedAt)} · 준비된 문구 중 AI가 선택 · 요청 시점 기록 기준</small></div>` : ''}`
        : `<p class="sensor-feedback-empty">${empty}</p>`}
      <button type="button" class="sensor-feedback-button" data-action="sensor-feedback" data-feedback-kind="${kind}" data-feedback-side="${side}" aria-label="${name(side)} ${kind === 'rom' ? '발 움직임 범위' : '압력 중심'} AI 피드백 받기" ${busy ? 'disabled' : ''}>${request?.pending ? request.eventId ? 'AI 피드백 작성 중…' : '최신 기록 확인 중…' : request?.error || result ? 'AI 피드백 다시 받기' : 'AI 피드백 받기'}<span aria-hidden="true">↗</span></button>
      ${request?.notice ? `<div class="sensor-feedback-notice" role="status"><p>${e(request.notice)}</p><button type="button" class="today-link" data-view="${kind === 'rom' && real ? 'ankle' : 'devices'}" ${kind === 'rom' && real ? `data-daily-focus="${side}"` : ''}>${kind === 'rom' && real ? '발 움직임 범위 기록하기' : '기기 연결 확인'} <span aria-hidden="true">↗</span></button></div>` : ''}
      ${request?.error ? `<p class="sensor-feedback-error" role="status">${e(request.error)}</p>` : ''}
      ${request?.result && !matching ? '<p class="sensor-feedback-empty" role="status">요청 후 새로운 관찰 기록이 들어왔어요. 버튼을 다시 누르면 최신 기록으로 피드백을 받아요.</p>' : ''}
    </article>`;
  }).join('');
  return `<section class="sensor-feedback" aria-label="${kind === 'rom' ? '범위 이탈' : '압력 쏠림'} AI 피드백"><header><span class="sensor-feedback-icon" aria-hidden="true">✦</span><div><h3>${kind === 'rom' ? '범위를 벗어난 방향 확인' : '오래 쏠린 압력 확인'}</h3><p>최근 기록으로 평소 보행 안내와 다음 확인할 점을 받아요.</p></div></header><div class="sensor-feedback-rows">${rows}</div>
    <details class="sensor-feedback-help" data-ui-disclosure="feedback-help-${kind}"><summary>어떤 기록으로 안내하나요?</summary><p>${kind === 'rom' ? '정지에 가까운 상태에서 기록 범위 + 5°를 1초 이상 넘긴 오늘의 최근 기록을 발별로 사용해요. 최대 기울기 순간에 저장한 방향, 개인 기준과 지속 시간을 전달해요. 발끝 들기 보정이 있으면 들린 쪽에 맞는 주의 문구를, 없으면 일반 주의 문구를 보여줘요. 이전 기록에 새 보정 방향을 소급해서 붙이지 않아요.' : '발이 정지에 가까울 때 앞쪽 또는 뒤쪽 압력 비중이 80% 이상으로 3초 지속된 오늘의 최근 기록을 사용해요. 쏠린 방향, 최대 비중과 지속 시간을 전달해요. 앞쪽·뒤쪽 쏠림에 맞는 안내와 센서 확인을 선택해요. PC 웹 서버를 다시 켜면 압력 쏠림 기록은 초기화돼요.'}</p><p>Ollama는 이 PC에서 측정 요약을 보고 준비된 문구 중 보행 안내 1개와 확인 행동 1개를 고릅니다. 같은 기록은 저장된 답을 다시 보여줄 수 있어요. 위 수치는 앱의 관찰 조건이며 부상 위험·잘못된 걸음·맞춤 스트레칭을 판단하는 기준이 아닙니다. 통증이나 불편함이 있으면 멈추고 전문가에게 확인하세요.</p><p>일반 안내 참고: <a href="https://www.nhs.uk/live-well/exercise/walking-for-health/" target="_blank" rel="noopener noreferrer">NHS 걷기와 신발 안내</a> · <a href="https://www.nia.nih.gov/health/falls-and-falls-prevention/falls-and-fractures-older-adults-causes-and-prevention" target="_blank" rel="noopener noreferrer">NIA 보행 환경과 낙상 예방</a>. 이 자료가 센서 판정 기준을 검증한 것은 아닙니다.</p></details></section>`;
}
