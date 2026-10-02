// Count distinct, fresh model results in time rather than requiring a fixed FPS.
export const FRONT_FRESH_MS = 800;
export const BASELINE_HOLD_MS = 2000;
export const BASELINE_TIMEOUT_MS = 8000;
export const FRONT_OBSERVATION_MS = 10000;
export const FRONT_PROTOCOL = 'front-10s-v2';
const median = values => {
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
};
const valid = s => s?.valid && [s.at, s.pelvis, s.trunk].every(Number.isFinite);

export function createFrontBaselineCapture(started) {
  let samples = [], heldMs = 0, previous = null, lastAt = -Infinity;
  let reason = '초록 점이 보이는 자세로 잠시 유지해 주세요.', baseline = null;
  const reset = () => { samples = []; heldMs = 0; previous = null; };
  return {
    push(sample) {
      if (baseline || !Number.isFinite(sample?.at) || sample.at < started
        || sample.at > started + BASELINE_TIMEOUT_MS || sample.at <= lastAt) return;
      lastAt = sample.at;
      if (samples.length && sample.at - samples.at(-1).at > FRONT_FRESH_MS) reset();
      if (!valid(sample)) {
        previous = null; // Brief uncertainty pauses progress, without erasing the good samples.
        reason = sample.reason || '관절점을 다시 확인하고 있어요.';
        return;
      }
      if (samples.length && (Math.abs(sample.pelvis - median(samples.map(s => s.pelvis))) > 3
        || Math.abs(sample.trunk - median(samples.map(s => s.trunk))) > 3)) {
        reset();
        reason = '자세 변화가 보여요. 편하게 멈추면 자동으로 다시 모아요.';
      } else reason = '잘 인식되고 있어요. 지금 자세를 유지해 주세요.';
      if (previous) heldMs += sample.at - previous.at;
      samples.push(sample);
      previous = sample;
      if (heldMs >= BASELINE_HOLD_MS && samples.length >= 5) {
        baseline = { pelvis: median(samples.map(s => s.pelvis)), trunk: median(samples.map(s => s.trunk)) };
      }
    },
    snapshot(now) {
      if (!baseline && samples.length && now - samples.at(-1).at > FRONT_FRESH_MS) {
        reset();
        reason = '인식이 끊겼어요. 얼굴·양쪽 어깨·골반이 보이는지 확인해 주세요.';
      }
      return { baseline, heldMs: Math.min(BASELINE_HOLD_MS, heldMs), samples: samples.length,
        done: Boolean(baseline) || now - started >= BASELINE_TIMEOUT_MS, reason };
    },
  };
}

export function summarizeFrontObservation(samples, started, ended, interrupted = false) {
  const stop = Math.min(ended, started + FRONT_OBSERVATION_MS);
  // Keep only distinct, ordered frame times. A replay cannot increase coverage.
  const ordered = [];
  for (const s of samples) if (Number.isFinite(s?.at) && s.at >= started && s.at <= stop
    && (!ordered.length || s.at > ordered.at(-1).at)) ordered.push(s);
  let validMs = 0, changedMs = 0;
  for (let i = 1; i < ordered.length; i++) {
    const a = ordered[i - 1], b = ordered[i], gap = b.at - a.at;
    if (!a.valid || !b.valid || gap <= 0 || gap > FRONT_FRESH_MS) continue;
    const duration = Math.max(0, Math.min(b.at, stop) - Math.max(a.at, started));
    validMs += duration;
    if (a.changed && b.changed) changedMs += duration;
  }
  const elapsed = Math.max(0, Math.min(FRONT_OBSERVATION_MS, ended - started));
  const ratio = Math.min(100, Math.floor(validMs / Math.max(1, elapsed) * 100 + 1e-6));
  const eligible = !interrupted && elapsed >= FRONT_OBSERVATION_MS && validMs + 1e-6 >= elapsed * .7;
  const peak = key => {
    const values = ordered.filter(s => s.valid && Number.isFinite(s[key])).map(s => Math.abs(s[key]));
    return values.length ? Number(Math.max(...values).toFixed(1)) : null;
  };
  return { protocol: FRONT_PROTOCOL, eligible, ratio, plannedSeconds: FRONT_OBSERVATION_MS / 1000,
    durationSeconds: Number((elapsed / 1000).toFixed(1)), validSeconds: Math.floor((validMs + 1e-6) / 100) / 10,
    reason: interrupted ? 'interrupted' : eligible ? 'complete' : 'insufficient_visibility',
    pelvisPeak: eligible ? peak('pelvis') : null, trunkPeak: eligible ? peak('trunk') : null,
    changedSeconds: Math.floor((changedMs + 1e-6) / 100) / 10 };
}
