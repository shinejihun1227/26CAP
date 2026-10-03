import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFront, frontChange, visiblePoint } from '../src/mediapipe/front-pose.js';
import { createFrontBaselineCapture, summarizeFrontObservation } from '../src/mediapipe/front-capture.js';
import { createFrontPoseContinuity, interpolateFrontSamples, createFrontGuidance } from '../src/mediapipe/front-temporal.js';
import { readFrontRecords } from '../src/mediapipe/front-records.js';
import { renderFrontRecords } from '../src/records-controller.js';

const anchor={x:.5,y:.55,scale:.3,facing:1};
const row=(at,extra={})=>({at,valid:true,pelvis:2,trunk:3,ankleLeft:4,ankleRight:5,anchor,bridgeable:true,...extra});
const pose=()=>{const p=Array.from({length:33},()=>({x:.5,y:.5,visibility:.95,presence:.95}));
  for(const[i,x,y]of [[0,.5,.1],[11,.35,.25],[12,.65,.25],[23,.39,.53],[24,.61,.53],[25,.39,.72],[26,.61,.72],[27,.39,.9],[28,.61,.9]])p[i]={...p[i],x,y};return p;};

test('front lower-leg alignment is side-specific; missing ankle does not cancel pelvis observation',()=>{
  const p=pose(),base=analyzeFront([p],640,480);
  assert.equal(base.ankleLeft,0);assert.equal(base.ankleRight,0);
  p[27].x+=.05;const result=analyzeFront([p],640,480),delta=frontChange(result,base);
  assert.ok(delta.ankleLeft>12);assert.equal(delta.ankleRight,0);assert.equal(delta.changed,true);
  p[27].visibility=.3;const missing=analyzeFront([p],640,480);
  assert.equal(missing.valid,true);assert.equal(missing.ankleLeft,null);assert.equal(missing.ankleRight,0);
  assert.equal(frontChange(missing,base).ankleLeft,null);
});

test('baseline needs observed steady ankle frames, and brief loss preserves but does not advance progress',()=>{
  const capture=createFrontBaselineCapture(0);
  for(let at=0;at<=1000;at+=100)capture.push(row(at));
  capture.push(row(1500,{valid:false}));capture.push(row(2100));
  assert.equal(capture.snapshot(2100).heldMs,1000);
  for(let at=2200;at<=3100;at+=100)capture.push(row(at));
  assert.deepEqual(capture.snapshot(3100).baseline,{pelvis:2,trunk:3,ankleLeft:4,ankleRight:5});
  const estimated=createFrontBaselineCapture(0);
  for(let at=0;at<=3000;at+=100)estimated.push(row(at,{estimated:true}));
  assert.equal(estimated.snapshot(3000).baseline,null);
  const partial=createFrontBaselineCapture(0);
  for(let at=0;at<=2000;at+=100)partial.push(row(at,{ankleLeft:null}));
  assert.equal(partial.snapshot(2000).baseline.ankleLeft,undefined);
  assert.equal(partial.snapshot(2000).baseline.ankleRight,5);
});

test('bounded interpolation uses both endpoints and distinguishes each measured part',()=>{
  const raw=[row(0),row(100,{valid:false,pelvis:90}),row(200,{pelvis:6})];
  const filled=interpolateFrontSamples(raw);
  assert.equal(filled[1].pelvis,4);assert.equal(filled[1].sources.pelvis,'interpolated');
  assert.equal(raw[1].pelvis,90,'input is untouched');
  const leg=interpolateFrontSamples([row(0),row(100,{ankleLeft:null}),row(200)]);
  assert.equal(leg[1].sources.ankleLeft,'interpolated');assert.equal(leg[1].sources.pelvis,'observed');
});

test('long gaps, identity/scale jumps, reversals, multiple people, stale and unbounded edges are never filled',()=>{
  const cases=[
    [row(0),row(300,{valid:false}),row(600)],
    [row(0),row(100,{valid:false}),row(200,{anchor:{...anchor,x:.8}})],
    [row(0),row(100,{valid:false}),row(200,{anchor:{...anchor,scale:.6}})],
    [row(0),row(100,{valid:false}),row(200,{anchor:{...anchor,facing:-1}})],
    [row(0),row(100,{valid:false,bridgeable:false}),row(200)],
    [row(0),row(100,{valid:false}),row(200,{pelvis:25})],
    [row(0),row(100,{valid:false})], [row(0,{valid:false}),row(100)],
  ];
  for(const samples of cases)assert.ok(interpolateFrontSamples(samples).filter(s=>!s.valid).every(s=>s.sources.pelvis==='missing'));
});

test('live missing landmarks are visibly held for at most 400 ms and never passed off as measured',()=>{
  const tracker=createFrontPoseContinuity(visiblePoint),p=pose(),r=analyzeFront([p],640,480);
  tracker.update([p],r,0);const missing=pose();missing[27].visibility=.1;
  const held=tracker.update([missing],analyzeFront([missing],640,480),300);
  assert.deepEqual(held.held,[27]);assert.equal(held.poses[0][27].estimated,true);assert.equal(held.expiresAt,400);
  assert.equal(tracker.update([missing],analyzeFront([missing],640,480),401).held.length,0);
  tracker.update([p],r,500);
  const multiple=tracker.update([p,p],{valid:false,bridgeable:false},600);
  assert.deepEqual(multiple.poses,[]);assert.equal(multiple.discontinuous,true);
  assert.deepEqual(tracker.update([],{valid:false,bridgeable:true},700).poses,[]);
  tracker.update([p],r,800);
  assert.equal(tracker.update([p],{...r,anchor:{...r.anchor,x:.9}},900).discontinuous,true);
});

test('interpolation recovers short losses while peaks, change time and minimum measured time stay honest',()=>{
  const samples=Array.from({length:101},(_,i)=>row(i*100,{changed:true,...(i%5===2?{valid:false,pelvis:99}: {})}));
  const result=summarizeFrontObservation(samples,0,10000);
  assert.equal(result.validSeconds,6);assert.equal(result.interpolatedSeconds,4);assert.equal(result.coveredRatio,100);
  assert.equal(result.eligible,true);assert.equal(result.pelvisPeak,2);assert.equal(result.changedSeconds,6);
  const moreMissing=Array.from({length:101},(_,i)=>row(i*100,{valid:i%3!==1}));
  assert.equal(summarizeFrontObservation(moreMissing,0,10000).eligible,false);
  const unbounded=Array.from({length:101},(_,i)=>row(i*100,{valid:i<30}));
  const partial=summarizeFrontObservation(unbounded,0,10000);
  assert.equal(partial.eligible,false);assert.equal(partial.metrics.pelvis.available,true);assert.equal(partial.interpolatedSeconds,0);
});

test('each ankle keeps its own coverage and missing data does not invalidate the visible parts',()=>{
  const samples=Array.from({length:101},(_,i)=>row(i*100,{ankleLeft:null}));
  const result=summarizeFrontObservation(samples,0,10000);
  assert.equal(result.eligible,true);assert.equal(result.metrics.ankleLeft.available,false);
  assert.equal(result.metrics.ankleLeft.peak,null);assert.equal(result.metrics.ankleRight.peak,5);
});

test('posture cues require one continuous measured second for the same part and sign',()=>{
  const guidance=createFrontGuidance();
  for(let at=0;at<1000;at+=100)assert.deepEqual(guidance.update({pelvis:7},at),[]);
  assert.deepEqual(guidance.update({pelvis:7},1000),['pelvis']);
  assert.deepEqual(guidance.update(null,1100),[]);
  assert.deepEqual(guidance.update({pelvis:7},1200),[]);
  assert.deepEqual(guidance.update({pelvis:7,estimated:true},2300),[]);
  assert.deepEqual(guidance.update({pelvis:7},2400),[]);
  assert.deepEqual(guidance.update({pelvis:-7},2500),[]);
});

test('new records retain per-part quality and estimates; legacy records survive and invalid totals do not',()=>{
  const now=Date.now(),r={at:now,...summarizeFrontObservation(Array.from({length:101},(_,i)=>row(i*100,{valid:i%5!==2})),0,10000)};
  const legacy={at:now-1,eligible:true,ratio:80,changedSeconds:2};
  const bad={...r,interpolatedSeconds:10};
  const records=readFrontRecords({getItem:()=>JSON.stringify([r,legacy,bad])},now).records;
  assert.deepEqual(records,[legacy,r]);
  const html=renderFrontRecords(records);assert.match(html,/직접 인식 \/ 보간/);assert.match(html,/왼발 4°/);
  assert.doesNotMatch(html,/99°/);
});
