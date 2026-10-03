export const FRONT_RECORD_KEY = 'stepon-front-observations-v1';
function validTiming(r) {
  if (r.protocol === undefined) return true; // Preserve older 20-second records.
  const home=r.protocol==='front-home-10s-v3';
  if(home){
    if(!Number.isFinite(r.interpolatedSeconds)||r.interpolatedSeconds<0||r.validSeconds+r.interpolatedSeconds>r.durationSeconds+.002
      ||!Number.isFinite(r.coveredRatio)||r.coveredRatio<r.ratio||r.coveredRatio>100)return false;
    for(const key of ['pelvis','trunk','ankleLeft','ankleRight']){
      const m=r.metrics?.[key];
      if(!m||!Number.isFinite(m.observedSeconds)||!Number.isFinite(m.interpolatedSeconds)
        ||m.observedSeconds<0||m.interpolatedSeconds<0||m.observedSeconds+m.interpolatedSeconds>r.durationSeconds+.002
        ||typeof m.available!=='boolean'||m.available!==(m.observedSeconds>=1)
        ||(m.available? !Number.isFinite(m.peak)||m.peak<0||m.peak>180:m.peak!==null))return false;
    }
  }
  return (home||r.protocol === 'front-10s-v2') && r.plannedSeconds === 10
    && Number.isFinite(r.durationSeconds) && r.durationSeconds >= 0 && r.durationSeconds <= 10
    && Number.isFinite(r.validSeconds) && r.validSeconds >= 0 && r.validSeconds <= r.durationSeconds
    && r.changedSeconds <= r.validSeconds
    && (!r.eligible || r.reason==='complete' && r.durationSeconds === 10
      && (home?r.validSeconds>=6-.002&&r.validSeconds+Math.min(r.interpolatedSeconds,2)>=7-.002:r.validSeconds >= 7))
    && ['complete','interrupted','insufficient_visibility'].includes(r.reason)
    && ['pelvisPeak','trunkPeak'].every(key=>r[key]===null || Number.isFinite(r[key]) && r[key]>=0 && r[key]<=180);
}
export function readFrontRecords(storage, now = Date.now()) {
  try {
    const data = JSON.parse(storage.getItem(FRONT_RECORD_KEY) || '[]');
    if (!Array.isArray(data)) throw Error('invalid_records');
    return { records: data.filter(r => r && Number.isFinite(r.at) && r.at <= now && r.at > now - 30 * 86400000
      && typeof r.eligible === 'boolean' && Number.isFinite(r.ratio) && r.ratio >= 0 && r.ratio <= 100
      && Number.isFinite(r.changedSeconds) && r.changedSeconds >= 0 && r.changedSeconds <= 20 && validTiming(r)).sort((a,b) => a.at-b.at).slice(-20), error: null };
  } catch { return { records: [], error: '이 브라우저의 정면 보행 기록을 읽지 못했어요.' }; }
}
