import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { createAnkleDaily,createAnkleDailyHandler } from '../server/ankle-daily.mjs';
function fixture(directory){
 let time=new Date('2026-10-01T10:00:00+09:00').getTime(),frame=0,boot='boot-1';
 const monitor=createAnkleDaily({directory,now:()=>time});
 const raw=(degrees=0,gyro=0)=>({frame:++frame,boot_id:boot,device_id:'sensor-1',imu_ready:true,accel:{x:Math.sin(degrees*Math.PI/180),y:0,z:Math.cos(degrees*Math.PI/180)},gyro:{x:gyro,y:0,z:0}});
 const hub=()=>({feet:{left:{connected:true,age_ms:0,state:{imu_ready:true,device_id:'sensor-1',boot_id:boot}}}});
 const observe=(degree=0,gyro=0,interval=50)=>{time+=interval;monitor.observe('left',raw(degree,gyro));};
 const startRange=()=>{monitor.command('left','neutral',hub());for(let i=0;i<60;i++)observe();assert.equal(monitor.snapshot().feet.left.phase,'neutral-ready');monitor.command('left','range',hub());};
 const prepare=()=>{startRange();for(let i=0;i<200;i++)observe(i%60<30?0:20);assert.equal(monitor.snapshot().feet.left.phase,'ready');};
 return {monitor,raw,hub,observe,prepare,startRange,advance:n=>{time+=n;monitor.tick();},boot:v=>{boot=v;},time:()=>time};
}
test('captures quiet baseline and range, reports sustained excursions separately for each foot',()=>{
 const f=fixture();f.prepare();assert.ok(f.monitor.snapshot().feet.left.plan.max>=19.9);assert.equal(f.monitor.snapshot().feet.right.plan,null);
 for(let i=0;i<30;i++)f.observe(20);assert.equal(f.monitor.snapshot().events.length,0);
 for(let i=0;i<10;i++)f.observe(40);assert.equal(f.monitor.snapshot().events.length,0);
 for(let i=0;i<20;i++)f.observe(40);const state=f.monitor.snapshot();assert.equal(state.events.length,1);assert.equal(state.feet.left.state,'outside');assert.ok(state.events[0].peak>=39.9);assert.equal(state.events[0].side,'left');
 const vector=state.feet.left.current.vector;assert.equal(vector.length,3);assert.ok(Math.abs(Math.hypot(...vector)-state.feet.left.current.tilt)<.2);
 f.observe(0);assert.equal(f.monitor.snapshot().feet.left.state,'within');assert.deepEqual(f.monitor.snapshot().feet.left.current.vector,[0,0,0]);
});
test('movement, duplicate frames and disconnected time do not imply safe measurements',()=>{
 const f=fixture();f.prepare();for(let i=0;i<40;i++)f.observe(60,90);assert.equal(f.monitor.snapshot().events.length,0);assert.equal(f.monitor.snapshot().feet.left.state,'moving');
 const duplicate=f.raw(60);f.monitor.observe('left',duplicate);for(let i=0;i<40;i++){f.advance(50);f.monitor.observe('left',duplicate);}assert.equal(f.monitor.snapshot().events.length,0);assert.equal(f.monitor.snapshot().feet.left.state,'offline');
 const seconds=f.monitor.snapshot().feet.left.comparedSeconds;f.advance(10000);assert.equal(f.monitor.snapshot().feet.left.comparedSeconds,seconds);
});
test('reboot or a new day invalidates the previous wearing baseline',()=>{
 const f=fixture();f.prepare();f.boot('boot-2');f.observe();assert.equal(f.monitor.snapshot().feet.left.plan,null);assert.equal(f.monitor.snapshot().feet.left.phase,'failed');
 f.prepare();f.advance(86400000);assert.equal(f.monitor.snapshot().feet.left.plan,null);assert.equal(f.monitor.snapshot().feet.left.comparedSeconds,0);
});
test('missing samples cannot create a baseline; commands validate freshness and sequence',()=>{
 const f=fixture();assert.throws(()=>f.monitor.command('right','neutral',f.hub()));assert.throws(()=>f.monitor.command('left','range',f.hub()));
 f.monitor.command('left','neutral',f.hub());f.advance(3100);assert.equal(f.monitor.snapshot().feet.left.phase,'failed');assert.equal(f.monitor.snapshot().feet.left.plan,null);
 assert.throws(()=>f.monitor.command('left','neutral',{feet:{left:{connected:true,age_ms:2000,state:{imu_ready:true}}}}));
});
test('15 distinct quiet values spanning six seconds are enough; 14 are not',()=>{
 for(const count of [14,15]) {
  const f=fixture();f.startRange();
  for(let i=0;i<count;i++) f.observe(i%2?20:0,0,600);
  const quality=f.monitor.snapshot().feet.left.rangeQuality;
  assert.equal(quality.accepted,count);assert.equal(quality.minimumSamples,15);
  assert.ok(Math.abs(quality.spanSeconds-(count-1)*.6)<.001);
  // Keep receiving real frames, but do not count a moving frame as quiet.
  f.observe(0,90,9950-count*600);f.advance(50);
  const result=f.monitor.snapshot().feet.left;
  assert.equal(result.phase,count===15?'ready':'failed');
  assert.equal(result.rangeQuality.accepted,count);
  assert.equal(result.rangeQuality.reason,count===15?null:'samples');
  if(count===15)assert.equal(result.plan.max,20);
  else {assert.equal(result.plan,null);assert.match(result.message,/14\/15/);}
 }
});
test('many values confined to a short interval fail with a duration explanation',()=>{
 const f=fixture();f.startRange();
 for(let i=0;i<180;i++)f.observe(20,90);
 for(let i=0;i<20;i++)f.observe(i%2?20:0);
 const result=f.monitor.snapshot().feet.left;
 assert.equal(result.phase,'failed');assert.equal(result.plan,null);
 assert.equal(result.rangeQuality.reason,'duration');assert.match(result.message,/짧은 구간/);
});
test('flat and very small angles report angle variation, not a sample shortage',()=>{
 for(const angle of [0,4,20]) {
  const f=fixture();f.startRange();
  for(let i=0;i<200;i++)f.observe(angle===4?i%2*4:angle);
  const result=f.monitor.snapshot().feet.left;
  assert.ok(result.rangeQuality.accepted>15);assert.equal(result.phase,'failed');
  assert.equal(result.rangeQuality.reason,'angle');assert.match(result.message,/각도 변화/);
 }
});
test('fewer required samples never admits fast, accelerated, unavailable or duplicate frames',()=>{
 for(const type of ['motion','acceleration','unavailable','duplicate']) {
  const f=fixture();f.startRange();const duplicate=f.raw(20);
  for(let i=0;i<199;i++) {
   f.advance(50);const raw=type==='duplicate'?duplicate:f.raw(20,type==='motion'?90:0);
   if(type==='acceleration')raw.accel.z=2;
   if(type==='unavailable')raw.imu_ready=false;
   f.monitor.observe('left',raw);
  }
  f.advance(50);const result=f.monitor.snapshot().feet.left;
  assert.equal(result.phase,'failed');assert.equal(result.plan,null);
  assert.equal(result.rangeQuality.accepted,type==='duplicate'?1:0);
  if(type==='duplicate') {assert.equal(result.rangeQuality.received,1);assert.equal(result.rangeQuality.reason,'disconnected');}
  else {assert.equal(result.rangeQuality[type+'Rejected'],199);assert.equal(result.rangeQuality.reason,'samples');}
 }
});
test('an interrupted range cannot be saved from old values; retry starts fresh',()=>{
 const f=fixture();f.startRange();
 for(let i=0;i<20;i++)f.observe(i%2?20:0,0,400);
 f.advance(2000);let result=f.monitor.snapshot().feet.left;
 assert.equal(result.phase,'failed');assert.equal(result.rangeQuality.reason,'disconnected');assert.equal(result.plan,null);
 f.observe();f.monitor.command('left','range',f.hub());
 result=f.monitor.snapshot().feet.left;assert.equal(result.rangeQuality.accepted,0);assert.equal(result.rangeQuality.reason,null);
 f.monitor.command('left','cancel',f.hub());assert.equal(f.monitor.snapshot().feet.left.rangeQuality,null);
});
test('capture ends at 10 seconds, embeds toe-up alignment and keeps the original quality floor',()=>{
 const f=fixture();f.startRange();
 assert.equal(f.monitor.snapshot().feet.left.durationSeconds,10);
 assert.equal(f.monitor.snapshot().feet.left.captureStage,'direction');
 for(let i=0;i<80;i++)f.observe(i<10?0:20);
 let state=f.monitor.snapshot().feet.left;
 assert.equal(state.captureStage,'range');assert.equal(state.directionReady,true);
 for(let i=0;i<119;i++)f.observe(i%40<20?0:-15);
 assert.equal(f.monitor.snapshot().feet.left.phase,'range');
 f.observe();state=f.monitor.snapshot().feet.left;
 assert.equal(state.phase,'ready');assert.equal(state.plan.directionReady,true);
 assert.equal(state.rangeQuality.minimumSamples,15);assert.equal(state.rangeQuality.minimumSpanSeconds,6);
 f.observe(20);assert.equal(f.monitor.snapshot().feet.left.current.direction.code,'front');
 f.observe(-20);assert.equal(f.monitor.snapshot().feet.left.current.direction.code,'rear');
 f.boot('new-boot');f.observe();assert.equal(f.monitor.snapshot().feet.left.directionReady,false);
});
test('an unconfirmed toe-up hold records magnitude without inventing anatomical direction',()=>{
 const f=fixture();f.startRange();
 for(let i=0;i<200;i++)f.observe(i<85?0:i%40<20?20:0);
 const state=f.monitor.snapshot().feet.left;
 assert.equal(state.phase,'ready');assert.equal(state.plan.directionReady,false);
 assert.equal(state.current.direction,null);assert.match(state.message,/발끝 방향은 확인되지/);
});
test('events persist without restoring stale calibration; corrupt event fields are discarded',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stepon-ankle-test-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const f=fixture(directory);f.prepare();for(let i=0;i<40;i++)f.observe(40);f.observe();f.monitor.flush();
 const restored=createAnkleDaily({directory,now:f.time});assert.equal(restored.snapshot().events.length,1);assert.equal(restored.snapshot().feet.left.plan,null);
 const p=path.join(directory,'events.json'),events=JSON.parse(fs.readFileSync(p));events.push({...events[0],peak:'<img>'});fs.writeFileSync(p,JSON.stringify(events));assert.equal(createAnkleDaily({directory,now:f.time}).snapshot().events.length,1);
});

test('event direction follows the peak sample, survives storage, and is not reinterpreted by later poses',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stepon-peak-direction-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const f=fixture(directory);f.prepare();for(let i=0;i<30;i++)f.observe(40);
 let event=f.monitor.snapshot().events[0];assert.equal(event.footDirection.code,'front');
 const referenceAt=event.footDirection.referenceAt;
 f.advance(50);const raw=f.raw();raw.accel={x:0,y:Math.sin(50*Math.PI/180),z:Math.cos(50*Math.PI/180)};
 f.monitor.observe('left',raw);event=f.monitor.snapshot().events[0];
 assert.equal(event.footDirection.code,'left');assert.equal(event.peak,50);
 f.observe(40);assert.equal(f.monitor.snapshot().events[0].footDirection.code,'left');
 f.observe();f.monitor.flush();f.boot('new-boot');f.observe();
 const saved=createAnkleDaily({directory,now:f.time}).snapshot().events[0];
 assert.equal(saved.footDirection.code,'left');assert.equal(saved.footDirection.referenceAt,referenceAt);
});

test('unreferenced or upside-down excursion peaks do not retain a plausible but false direction',()=>{
 const f=fixture();f.prepare();for(let i=0;i<30;i++)f.observe(40);
 assert.ok(f.monitor.snapshot().events[0].footDirection);
 f.observe(100);assert.equal(f.monitor.snapshot().events[0].footDirection,null);
 const other=fixture();other.startRange();for(let i=0;i<200;i++)other.observe(i<85?0:i%40<20?20:0);
 for(let i=0;i<30;i++)other.observe(40);
 assert.equal(other.monitor.snapshot().events[0].footDirection,null);
});
test('daily HTTP endpoint blocks cross-origin commands and reports real missing-device errors',async t=>{
 const f=fixture(),server=http.createServer(createAnkleDailyHandler(f.monitor,{snapshot:()=>({feet:{}})}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await(await fetch(url)).json()).version,1);
 const body=JSON.stringify({side:'left',action:'neutral'});
 assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json',origin:'http://other.example'},body})).status,403);
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body});assert.equal(response.status,400);assert.match((await response.json()).error,/BMI270/);
});
