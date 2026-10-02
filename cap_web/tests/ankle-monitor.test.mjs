import test from 'node:test';
import assert from 'node:assert/strict';
import { inclination, readAnkleSensor, neutralFromSamples, preparationFromRecord, createAnkleMonitor } from '../src/mediapipe/ankle-monitor.js';
import { renderEasyContent, renderEasyLiveContent } from '../src/views/easy-view.js';
import { renderOverview } from '../src/views/overview-view.js';
import { renderLiveView } from '../src/views/live-view.js';
import { initialState } from '../src/data/dashboard-data.js';
import { session } from './rom-fixtures.mjs';

const T = new Date('2026-10-01T12:00:00+09:00').getTime();
const gravity = deg => ({ x: Math.sin(deg*Math.PI/180), y: 0, z: Math.cos(deg*Math.PI/180) });
function state(time = T, angle = 0, overrides = {}) {
  return { dataSource: 'esp32', connected: true, sensorReceivedAt: time, hardware: { feet: { left: { connected: true, age_ms: 0,
    state: { foot_side: 'left', imu_ready: true, device_id: 'left-device', boot_id: 'boot-a', frame: time-T, accel: gravity(angle), gyro: {x:0,y:0,z:0}, ...overrides } } } } };
}
const sample = (time, angle = 0, overrides = {}) => readAnkleSensor(state(time, angle, overrides), 'left', time);
const neutral = () => neutralFromSamples(Array.from({length:16},(_,i)=>sample(T+i*200)));
const paired = () => Array.from({length:36},(_,i)=>sample(T+4000+i*250, i%12*2));
const plan = () => preparationFromRecord(session({id:'record-1'}), neutral(), paired(), T+15000);

test('relative gravity inclination is rotation-invariant and never subtracts a camera joint angle', () => {
  assert.ok(Math.abs(inclination([0,0,1], [.5,0,Math.sqrt(.75)])-30)<1e-8);
  assert.ok(Math.abs(inclination([1,0,0], [Math.sqrt(.75),.5,0])-30)<1e-8);
  assert.equal(inclination([0,0,0],[1,0,0]),null);
  assert.equal(inclination([NaN,0,1],[1,0,0]),null);
});
test('only real, fresh, identified, quiet BMI data is usable', () => {
  assert.equal(sample(T).ok,true);
  assert.equal(readAnkleSensor({...state(),dataSource:'demo'},'left',T).ok,false);
  assert.equal(readAnkleSensor({...state(),connected:false},'left',T).ok,false);
  assert.equal(readAnkleSensor({...state(),paused:true},'left',T).ok,false);
  assert.equal(readAnkleSensor(state(),'right',T).ok,false);
  assert.equal(readAnkleSensor(state(),'left',T+1001).ok,false);
  for(const override of [{imu_ready:false},{boot_id:''},{foot_side:'right'},{frame:null},{accel:{x:null,y:0,z:1}},{gyro:{x:NaN,y:0,z:0}}]) assert.equal(sample(T,0,override).ok,false);
  assert.equal(sample(T,0,{gyro:{x:13,y:0,z:0}}).code,'moving');
  assert.equal(sample(T,0,{accel:{x:0,y:0,z:1.3}}).code,'moving');
  const bad=state(); bad.hardware.feet.left.age_ms=NaN; assert.equal(readAnkleSensor(bad,'left',T).ok,false);
});
test('neutral requires sustained unique frames from one boot and a steady posture', () => {
  assert.ok(neutral());
  assert.equal(neutralFromSamples([sample(T)]),null);
  assert.equal(neutralFromSamples(Array(16).fill(sample(T))),null);
  assert.equal(neutralFromSamples(Array.from({length:16},(_,i)=>sample(T+i*200,i*2))),null);
  assert.equal(neutralFromSamples(Array.from({length:16},(_,i)=>sample(T+i*200,0,{boot_id:i>5?'other':'boot-a'}))),null);
});
test('paired range needs a valid camera record, enough quiet samples and actual movement', () => {
  const p=plan(); assert.ok(p); assert.equal(p.cameraMin,80); assert.equal(p.cameraMax,99);
  assert.ok(p.sensorMax>15 && p.sensorMax<30); assert.notEqual(p.sensorMax,p.cameraMax);
  assert.equal(preparationFromRecord(session({interrupted:true}),neutral(),paired(),T+15000),null);
  assert.equal(preparationFromRecord(session(),neutral(),paired().slice(0,5),T+15000),null);
  assert.equal(preparationFromRecord(session(),neutral(),Array.from({length:36},(_,i)=>sample(T+4000+i*250)),T+15000),null);
  assert.equal(preparationFromRecord(session(),neutral(),paired().map(s=>({...s,bootId:'other'})),T+15000),null);
});
test('monitor waits for sustained excursions and distinct frames; motion/offline are not safe readings', () => {
  let time=T+15000; const m=createAnkleMonitor({now:()=>time}); assert.equal(m.save(plan()),true);
  assert.equal(m.snapshot(state(time,10)).left.code,'within');
  assert.equal(m.snapshot(state(time,40)).left.code,'checking');
  time+=1100; const stale=state(time,40); stale.hardware.feet.left.state.frame=15000;
  assert.equal(m.snapshot(stale).left.code,'checking');
  for(let i=0;i<6;i++){time+=250;m.snapshot(state(time,40));}
  assert.equal(m.snapshot(state(time,40)).left.code,'outside');
  assert.equal(m.snapshot(state(time,40,{gyro:{x:15,y:0,z:0}})).left.code,'moving');
  assert.equal(m.snapshot(state(time,40)).left.code,'checking');
  time+=2000; assert.equal(m.snapshot(state(time-2000,40)).left.code,'offline');
  assert.equal(m.snapshot(state(time,0)).left.code,'within');
});
test('baseline identity, participant, date and explicit clear prevent reuse of another preparation', () => {
  let time=T+15000; const m=createAnkleMonitor({now:()=>time}); m.save(plan());
  assert.equal(m.snapshot(state(time,0,{boot_id:'restarted'})).left.code,'changed');
  assert.equal(m.snapshot(state(time,0,{device_id:'new-shoe'})).left.code,'changed');
  assert.equal(m.snapshot(state(time)).right.code,'unprepared');
  m.setParticipant('P02'); assert.equal(m.snapshot(state(time)).left.code,'unprepared');
  m.setParticipant('P01'); assert.equal(m.snapshot(state(time)).left.code,'within');
  m.clearSide('left'); assert.equal(m.snapshot(state(time)).left.code,'unprepared');
  m.save(plan()); m.clear('record-1'); assert.equal(m.snapshot(state(time)).left.code,'unprepared');
  m.save(plan()); time+=86400000; assert.equal(m.snapshot(state(time)).left.code,'unprepared');
});
test('session storage restores only current valid plans and tolerates malformed storage', () => {
  const memory=new Map(), storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v)};
  const a=createAnkleMonitor({storage,now:()=>T+15000}); a.save(plan());
  const b=createAnkleMonitor({storage,now:()=>T+15000}); assert.equal(b.snapshot(state(T+15000)).left.code,'within');
  assert.doesNotThrow(()=>createAnkleMonitor({storage:{getItem:()=>'{broken'},now:()=>T}).snapshot(state()));
  assert.equal(b.save({...plan(),sensorMax:null}),false);
});
test('easy pages replace dense dashboards with preparation and status actions', () => {
  const s={...structuredClone(initialState),easyMode:true};
  const home=renderEasyContent(s), live=renderEasyLiveContent(s);
  assert.match(home,/오늘 요약/); assert.match(home,/보행동결 FoG 점수/);
  assert.match(home,/data-view="devices" data-open-disclosure="device-baselines"/);
  assert.match(home,/data-view="ankle"/); assert.match(home,/압력 중심/);
  assert.doesNotMatch(home,/판정 점수|열지도|cadence|undefined|NaN/);
  assert.match(live,/AI 보행동결/); assert.match(live,/data-view="ankle"/);
  assert.equal(renderOverview(s,{embedded:true}),home);
  assert.equal(renderLiveView(s,{embedded:true}),live);
});
