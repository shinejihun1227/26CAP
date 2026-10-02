import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFront, frontBaseline, frontChange, drawFrontPose } from '../src/mediapipe/front-pose.js';
import { renderFrontContent } from '../src/views/front-view.js';
import { renderAnkleDailyContent } from '../src/views/ankle-daily-view.js';
import { renderPurposeContent } from '../src/views/purpose-view.js';
import { initialState } from '../src/data/dashboard-data.js';

const pose=()=>{const p=Array.from({length:33},()=>({x:.5,y:.5,visibility:.95,presence:.95}));for(const [i,x,y] of [[0,.5,.1],[11,.35,.25],[12,.65,.25],[23,.39,.53],[24,.61,.53],[25,.39,.72],[26,.61,.72],[27,.39,.9],[28,.61,.9]])p[i]={...p[i],x,y};return p;};
test('front measurement requires one confidently detected frontal person',()=>{
  assert.equal(analyzeFront([pose()],640,480).valid,true);
  assert.equal(analyzeFront([],640,480).valid,false);
  assert.equal(analyzeFront([pose(),pose()],640,480).valid,false);
  const p=pose();p[27].visibility=.4;assert.equal(analyzeFront([p],640,480).valid,true);
  assert.deepEqual(analyzeFront([p],640,480).supportMissing,['왼쪽 발목']);
  p[27].visibility=1;p[27].y=1.1;assert.equal(analyzeFront([p],640,480).valid,true);
  p[23].visibility=.4;assert.equal(analyzeFront([p],640,480).valid,false);
  assert.deepEqual(analyzeFront([p],640,480).missing,['왼쪽 골반']);
  const narrow=pose();for(const i of [11,12,23,24])narrow[i].x=.5;assert.equal(analyzeFront([narrow],640,480).valid,false);
});
test('baseline removes initial image tilt and rejects short or unstable captures',()=>{
  const samples=Array.from({length:31},(_,i)=>({at:i*100,valid:true,pelvis:3,trunk:2}));
  const baseline=frontBaseline(samples);assert.deepEqual(baseline,{pelvis:3,trunk:2});
  assert.equal(frontChange({valid:true,pelvis:7,trunk:9},baseline).changed,false);
  assert.equal(frontChange({valid:true,pelvis:9,trunk:2},baseline).changed,true);
  assert.equal(frontChange({valid:false},baseline),null);
  assert.equal(frontBaseline(samples.slice(0,10)),null);
  assert.equal(frontBaseline(samples.map((s,i)=>i===15?{...s,pelvis:15}:s)),null);
});
test('uncertain poses still draw dashed landmarks and empty detections clear the overlay',()=>{
  const calls=[],ctx=new Proxy({}, {get:(_,key)=>(...args)=>calls.push([key,...args]),set:()=>true});
  const p=pose();p[27].visibility=.4;
  drawFrontPose(ctx,[p],640,480,{valid:false});
  assert.ok(calls.some(c=>c[0]==='setLineDash'&&c[1].length===2));
  assert.ok(calls.some(c=>c[0]==='setLineDash'&&c[1].length===0), 'confident edges stay solid despite an uncertain ankle');
  assert.ok(calls.some(c=>c[0]==='arc'&&c[1]===p[27].x*640));
  calls.length=0;drawFrontPose(ctx,[],640,480);assert.deepEqual(calls,[['clearRect',0,0,640,480]]);
});
test('home connects both calibrations and three distinct observation routes',()=>{
  const html=renderPurposeContent(structuredClone(initialState));
  for(const side of ['left','right'])assert.match(html,new RegExp(`data-ai-side="${side}"`));
  for(const view of ['live','ankle','mediapipe'])assert.ok(html.includes(`data-view="${view}"`));
  assert.match(html,/양발 보정/);
  const front=renderFrontContent();assert.match(front,/data-front-canvas/);assert.doesNotMatch(front,/data-rom-metric|왼쪽 어깨 벌림|발목만 측정/);
  const daily=renderAnkleDailyContent();assert.doesNotMatch(daily,/<video/);assert.match(daily,/실제 발목 관절 가동범위와는 다릅니다/);assert.match(daily,/Wi-Fi 단절/);
});
