// Estimates are display/coverage support only. They never establish a baseline,
// a measured peak, or a sustained posture-change cue.
export const FRONT_INTERPOLATION_MS = 500;
export const FRONT_HOLD_MS = 400;
export const FRONT_METRICS = ['pelvis', 'trunk', 'ankleLeft', 'ankleRight'];
const finite = Number.isFinite;
export function sameFrontSubject(a, b) {
  if (!a || !b) return false;
  return Math.hypot(a.x - b.x, a.y - b.y) <= .15
    && a.scale > 0 && b.scale / a.scale >= .7 && b.scale / a.scale <= 1.4
    && a.facing === b.facing;
}
export function interpolateFrontSamples(samples) {
  const rows = samples.map(s => ({ ...s, sources: Object.fromEntries(FRONT_METRICS.map(k => [k,
    s.valid && finite(s[k]) && !s.estimated ? 'observed' : 'missing'])) }));
  for (const key of FRONT_METRICS) {
    let previous = -1;
    for (let i = 0; i < rows.length; i++) {
      if (rows[i].sources[key] !== 'observed') continue;
      if (previous >= 0 && i > previous + 1) {
        const a = rows[previous], b = rows[i], gap = b.at - a.at;
        const safe = gap > 0 && gap <= FRONT_INTERPOLATION_MS && sameFrontSubject(a.anchor, b.anchor)
          && Math.abs(a[key] - b[key]) <= (key.startsWith('ankle') ? 15 : 8)
          && rows.slice(previous + 1, i).every(r => r.bridgeable !== false
            && (!r.anchor || sameFrontSubject(a.anchor, r.anchor)));
        if (safe) for (let j = previous + 1; j < i; j++) {
          rows[j][key] = a[key] + (b[key] - a[key]) * (rows[j].at - a.at) / gap;
          rows[j].sources[key] = 'interpolated';
        }
      }
      previous = i;
    }
  }
  return rows;
}

export function createFrontPoseContinuity(isVisible) {
  let points = [], anchor = null, lastAt = -Infinity;
  const reset = () => { points = []; anchor = null; lastAt = -Infinity; };
  return { reset, update(poses, result, at) {
    const discontinuous=poses?.length>1||Boolean(result.anchor&&anchor&&!sameFrontSubject(anchor,result.anchor));
    if (!finite(at) || at <= lastAt || result.bridgeable === false || poses?.length > 1
      || (result.anchor && anchor && !sameFrontSubject(anchor, result.anchor))) reset();
    if (!finite(at) || result.bridgeable === false || poses?.length > 1) return { poses: [], held: [],discontinuous };
    lastAt = at;
    if (result.anchor) anchor = result.anchor;
    const p = poses?.[0] ?? [], held = [];
    const display = Array.from({ length: 33 }, (_, i) => {
      if (isVisible(p[i])) { points[i] = { point: { ...p[i] }, at }; return p[i]; }
      if (points[i] && at - points[i].at >= 0 && at - points[i].at <= FRONT_HOLD_MS) {
        held.push(i); return { ...points[i].point, estimated: true };
      }
      return p[i];
    });
    return { poses: poses?.length || held.length ? [display] : [], held,discontinuous,
      expiresAt:held.length?Math.min(...held.map(i=>points[i].at+FRONT_HOLD_MS)):null };
  } };
}

export function createFrontGuidance() {
  const runs = new Map();
  const reset = () => runs.clear();
  return { reset, update(change, at) {
    const active = [];
    for (const key of FRONT_METRICS) {
      const value = change?.[key], threshold = key === 'pelvis' ? 5 : key === 'trunk' ? 8 : 12;
      if (!finite(value) || change?.estimated || Math.abs(value) <= threshold) { runs.delete(key); continue; }
      let run = runs.get(key);
      if (!run || at <= run.last || at - run.last > 500 || Math.sign(value) !== run.sign)
        run = { start: at, last: at, sign: Math.sign(value) };
      run.last = at; runs.set(key, run);
      if (at - run.start >= 1000) active.push(key);
    }
    return active;
  } };
}
