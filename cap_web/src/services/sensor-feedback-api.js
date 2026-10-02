import { validFeedbackActions } from '../data/sensor-feedback.js';

// Resolve the latest server record at click time. No record selection or page change.
export async function requestLatestSensorFeedback(kind, side, { fetchImpl = fetch, onRecord = () => {} } = {}) {
  if (!['rom', 'cop'].includes(kind) || !['left', 'right'].includes(side)) throw Error('피드백 항목을 다시 확인해 주세요.');
  const response = await fetchImpl('/api/sensor-feedback', { cache: 'no-store', signal: AbortSignal.timeout(5000) });
  const data = await response.json();
  if (!response.ok || data.version !== 1 || !Array.isArray(data.entries)) throw Error('관찰 서버 연결을 확인하고 다시 눌러 주세요.');
  const evidence = data.entries.find(entry => entry.kind === kind && entry.side === side)?.evidence;
  onRecord(data, evidence || null);
  if (!evidence) return { needsData: true, message: kind === 'rom'
    ? '아직 AI가 해석할 범위 이탈 기록이 없어요. 신발을 연결하고 양발의 움직임 범위를 먼저 기록해 주세요. 일부러 범위를 넘길 필요는 없어요.'
    : '아직 AI가 해석할 지속된 압력 쏠림 기록이 없어요. 신발을 연결하고 평소처럼 사용하며 압력값을 확인해 주세요. 일부러 한쪽에 힘을 줄 필요는 없어요.' };
  if (evidence.kind !== kind || evidence.side !== side || typeof evidence.id !== 'string') throw Error('관찰 기록 형식을 확인하지 못했어요. 다시 눌러 주세요.');
  const reply = await fetchImpl('/api/sensor-feedback', { method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind, side, eventId: evidence.id }), signal: AbortSignal.timeout(65000) });
  const result = await reply.json();
  if (!reply.ok) throw Error(result.message || 'AI 안내를 불러오지 못했어요.');
  if (result.eventId !== evidence.id || result.kind !== kind || result.side !== side
    || result.evidence?.id !== evidence.id || result.evidence?.kind !== kind || result.evidence?.side !== side
    || !validFeedbackActions(evidence,result.actionIds)) throw Error('응답 기록이 일치하지 않아요. 다시 눌러 주세요.');
  return { result };
}
