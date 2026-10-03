import test from 'node:test';
import assert from 'node:assert/strict';
import { directionFromToeUp,footDirection } from '../src/mediapipe/foot-direction.js';
import { directionMarker,summaryAnkle } from '../src/data/today-summary.js';
import { todayState } from './fixtures/today-state.mjs';
import { renderTodaySummary } from '../src/components/today-summary.js';
import { renderAnkleDailyContent } from '../src/views/ankle-daily-view.js';
const deg=a=>a*Math.PI/180;
const accel=(forward=0,left=0)=>{const v=[Math.tan(deg(forward)),Math.tan(deg(left)),1],n=Math.hypot(...v);return v.map(x=>x/n);};
const neutral={vector:[0,0,1],deviceId:'test',bootId:'boot'};
const samples=()=>Array.from({length:11},(_,i)=>({ok:true,at:100+i*50,key:`frame-${i}`,deviceId:'test',bootId:'boot',accel:accel(20)}));
test('toe-up reference respects arbitrary proper sensor mounting rotations',()=>{
 for(const rotate of [v=>v,v=>[v[1],v[2],v[0]],v=>[-v[0],v[1],-v[2]],v=>[(v[0]-v[1])/Math.sqrt(2),(v[0]+v[1])/Math.sqrt(2),v[2]]]) {
  const frame=directionFromToeUp({...neutral,vector:rotate(neutral.vector)},samples().map(s=>({...s,accel:rotate(s.accel)})));
  assert.ok(frame);
  for(const [f,l,code] of [[20,0,'front'],[-20,0,'rear'],[0,20,'left'],[0,-20,'right'],[0,0,'center']]) {
   const direction=footDirection(frame,rotate(accel(f,l)),'left');
   assert.equal(direction.code,code);assert.equal(direction.forward,f);assert.equal(direction.left,l);
  }
  assert.equal(footDirection(frame,rotate(accel(0,20)),'left').label,'바깥쪽 측면 들림');
  assert.equal(footDirection(frame,rotate(accel(0,20)),'right').label,'안쪽 측면 들림');
 }
});
test('missing, short, unstable, duplicate or interrupted holds never create direction references',()=>{
 for(const change of [s=>[],s=>s.slice(0,7),s=>s.map(p=>({...p,key:'same'})),s=>s.map(p=>({...p,accel:accel(2)})),
  s=>s.map((p,i)=>({...p,accel:accel(i%2?20:50)})),s=>s.map((p,i)=>({...p,at:i*600})),s=>s.map(p=>({...p,bootId:'other'}))]) {
  assert.equal(directionFromToeUp(neutral,change(samples())),null);
 }
 const frame=directionFromToeUp(neutral,samples());
 assert.equal(footDirection(null,accel(10),'left'),null);
 assert.equal(footDirection({...frame,left:frame.forward},accel(10),'left'),null);
 assert.equal(footDirection(frame,[0,0,-1],'left'),null);
});
test('a stable hold at four samples per second still establishes direction',()=>{
 const slow=samples().slice(0,8).map((s,i)=>({...s,at:100+i*250}));
 assert.ok(directionFromToeUp(neutral,slow));
});
test('directional sphere places front up, rear down, sides correctly, and every excess outside',()=>{
 for(const [forward,left,x,y] of [[20,0,0,-1],[-20,0,0,1],[0,20,-1,0],[0,-20,1,0]]) {
  const direction={source:'toe-up',forward,left};
  for(const tilt of [24,26,100]) {
   const p=directionMarker(tilt,25,direction);
   assert.ok(x===0?Math.abs(p.x-140)<.001:Math.sign(p.x-140)===x);
   assert.ok(y===0?Math.abs(p.y-120)<.001:Math.sign(p.y-120)===y);
   assert.equal(p.distance>80,tilt>25);
  }
 }
 assert.equal(directionMarker(10,25,null),null);
 assert.equal(directionMarker(10,25,{source:'toe-up',forward:0,left:0}),null);
 assert.equal(directionMarker(0,25,{source:'toe-up',forward:0,left:0}).distance,0);
});
test('UI labels raised-side directions; an unknown reference uses only a scalar marker',()=>{
 const now=10000,state=todayState(now),html=renderTodaySummary(state,now);
 for(const text of ['전방 · 발끝','후방 · 뒤꿈치','바깥쪽 측면 들림','올라간 쪽','today-direction-arrow'])assert.ok(html.includes(text));
 state.dailyAnkle.data.feet.left.plan.directionReady=false;
 assert.equal(summaryAnkle(state,'left',now).direction,null);
 const left=renderTodaySummary(state,now).split('data-summary-ankle-side="left"')[1].split('</article>')[0];
 assert.match(left,/data-range-state="within"/);assert.match(left,/data-range-mode="magnitude"/);
 assert.doesNotMatch(left,/data-direction=|today-direction-arrow|전방 · 발끝|후방 · 뒤꿈치/);
 assert.match(left,/왼발 방향 다시 기록/);assert.match(left,/발끝 방향은 확인되지/);
 state.dailyAnkle.data.feet.right.state='moving';assert.equal(summaryAnkle(state,'right',now).direction,null);
 const form=renderAnkleDailyContent();assert.match(form,/10초 방향·범위 기록/);assert.match(form,/처음 4초/);assert.doesNotMatch(form,/15초/);
});
