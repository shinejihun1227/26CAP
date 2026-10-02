import test from 'node:test';
import assert from 'node:assert/strict';
import { createFrontBaselineCapture, summarizeFrontObservation, BASELINE_HOLD_MS, BASELINE_TIMEOUT_MS, FRONT_OBSERVATION_MS } from '../src/mediapipe/front-capture.js';
import { readFrontRecords } from '../src/mediapipe/front-records.js';

const sample = (at, extra = {}) => ({ at, valid: true, pelvis: 3, trunk: 2, ...extra });

test('a stable baseline completes at 2, 3, 5 and 10 analysis results per second', () => {
  for (const hz of [2, 3, 5, 10]) {
    const capture = createFrontBaselineCapture(0);
    for (let i = 0; i <= hz * 2; i++) capture.push(sample(i * 1000 / hz));
    const result = capture.snapshot(BASELINE_HOLD_MS);
    assert.deepEqual(result.baseline, { pelvis: 3, trunk: 2 }, `${hz} Hz`);
    assert.equal(result.heldMs, 2000);
  }
});

test('one uncertain frame pauses the hold instead of destroying the preceding good seconds', () => {
  const capture = createFrontBaselineCapture(0);
  for (let at = 0; at <= 2000; at += 100) capture.push(sample(at, at === 1000 ? { valid: false, reason: '왼쪽 골반 확인' } : {}));
  assert.equal(capture.snapshot(2000).heldMs, 1800);
  assert.equal(capture.snapshot(2000).done, false);
  capture.push(sample(2100)); capture.push(sample(2200));
  assert.deepEqual(capture.snapshot(2200).baseline, { pelvis: 3, trunk: 2 });
});

test('duplicate, old, invalid and frozen results cannot complete a baseline', () => {
  const capture = createFrontBaselineCapture(100);
  capture.push(sample(0));
  for (let i = 0; i < 100; i++) capture.push(sample(100));
  assert.equal(capture.snapshot(100).heldMs, 0);
  assert.equal(capture.snapshot(1000).samples, 0);
  capture.push(sample(1100, { pelvis: NaN }));
  const result = capture.snapshot(100+BASELINE_TIMEOUT_MS);
  assert.equal(result.done, true); assert.equal(result.baseline, null);
});

test('a long loss or a moving posture needs a new stable hold', () => {
  for (const mode of ['gap', 'movement']) {
    const capture = createFrontBaselineCapture(0);
    for (let at = 0; at <= 1000; at += 100) capture.push(sample(at));
    const start = mode === 'gap' ? 2000 : 1100;
    const pelvis = mode === 'movement' ? 12 : 3;
    capture.push(sample(start, { pelvis }));
    assert.equal(capture.snapshot(start).heldMs, 0);
    for (let at = start + 100; at <= start + 1900; at += 100) capture.push(sample(at, { pelvis }));
    assert.equal(capture.snapshot(start + 1900).done, false);
    capture.push(sample(start + 2000, { pelvis }));
    assert.deepEqual(capture.snapshot(start + 2000).baseline, { pelvis, trunk: 2 });
  }
});

test('the 10 second observation uses actual observed duration at low and high frame rates', () => {
  for (const hz of [2, 3, 5, 10]) {
    const samples = Array.from({ length: hz * 10 + 1 }, (_, i) => sample(i * 1000 / hz, { changed: true }));
    const result=summarizeFrontObservation(samples,0,FRONT_OBSERVATION_MS);
    assert.equal(result.eligible,true);assert.equal(result.ratio,100);assert.equal(result.changedSeconds,10);
    assert.equal(result.durationSeconds,10);assert.equal(result.pelvisPeak,3);assert.equal(result.trunkPeak,2);
    assert.equal(summarizeFrontObservation(samples, 0, 10000, true).eligible, false);
  }
  const gap = [sample(0), sample(100), sample(9900), sample(10000)];
  const missing=summarizeFrontObservation(gap,0,10000);
  assert.equal(missing.eligible,false);assert.equal(missing.ratio,2);assert.equal(missing.pelvisPeak,null);
  const late = Array.from({length:203},(_,i)=>sample(i*100,{changed:true}));
  assert.equal(summarizeFrontObservation(late,0,20200).changedSeconds,10);
});

test('70 percent is still required; rounded display, replay and short sessions cannot pass',()=>{
  const rows=Array.from({length:71},(_,i)=>sample(i*100,{changed:true}));
  assert.equal(summarizeFrontObservation(rows,0,10000).eligible,true);
  assert.equal(summarizeFrontObservation(rows.slice(0,-1),0,10000).eligible,false);
  assert.equal(summarizeFrontObservation(rows,0,7000).eligible,false);
  const repeated=Array.from({length:100},()=>[sample(0),sample(100)]).flat();
  assert.equal(summarizeFrontObservation(repeated,0,10000).validSeconds,.1);
  const near=rows.slice(0,-1);near.push(sample(6990));
  const result=summarizeFrontObservation(near,0,10000);
  assert.equal(result.eligible,false);assert.equal(result.ratio,69);assert.equal(result.validSeconds,6.9);
});

test('new ten-second results and historical twenty-second results survive storage validation',()=>{
  const now=Date.now(),current={at:now,...summarizeFrontObservation(Array.from({length:101},(_,i)=>sample(i*100,{changed:true})),0,10000)};
  const legacy={at:now-1000,eligible:true,ratio:90,changedSeconds:18};
  const storage={getItem:()=>JSON.stringify([legacy,current,{...current,changedSeconds:11},{...current,plannedSeconds:20}])};
  const saved=readFrontRecords(storage,now).records;
  assert.deepEqual(saved,[legacy,current]);
});
