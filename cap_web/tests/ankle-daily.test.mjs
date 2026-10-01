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
 const observe=(degree=0,gyro=0)=>{time+=50;monitor.observe('left',raw(degree,gyro));};
 const prepare=()=>{monitor.command('left','neutral',hub());for(let i=0;i<60;i++)observe();assert.equal(monitor.snapshot().feet.left.phase,'neutral-ready');monitor.command('left','range',hub());for(let i=0;i<300;i++)observe(i%60<30?0:20);assert.equal(monitor.snapshot().feet.left.phase,'ready');};
 return {monitor,raw,hub,observe,prepare,advance:n=>{time+=n;monitor.tick();},boot:v=>{boot=v;},time:()=>time};
}
test('captures quiet baseline and range, reports sustained excursions separately for each foot',()=>{
 const f=fixture();f.prepare();assert.ok(f.monitor.snapshot().feet.left.plan.max>=19.9);assert.equal(f.monitor.snapshot().feet.right.plan,null);
 for(let i=0;i<30;i++)f.observe(20);assert.equal(f.monitor.snapshot().events.length,0);
 for(let i=0;i<10;i++)f.observe(40);assert.equal(f.monitor.snapshot().events.length,0);
 for(let i=0;i<20;i++)f.observe(40);const state=f.monitor.snapshot();assert.equal(state.events.length,1);assert.equal(state.feet.left.state,'outside');assert.ok(state.events[0].peak>=39.9);assert.equal(state.events[0].side,'left');
 f.observe(0);assert.equal(f.monitor.snapshot().feet.left.state,'within');
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
test('events persist without restoring stale calibration; corrupt event fields are discarded',t=>{
 const directory=fs.mkdtempSync(path.join(os.tmpdir(),'stepon-ankle-test-'));
 t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));
 const f=fixture(directory);f.prepare();for(let i=0;i<40;i++)f.observe(40);f.observe();f.monitor.flush();
 const restored=createAnkleDaily({directory,now:f.time});assert.equal(restored.snapshot().events.length,1);assert.equal(restored.snapshot().feet.left.plan,null);
 const p=path.join(directory,'events.json'),events=JSON.parse(fs.readFileSync(p));events.push({...events[0],peak:'<img>'});fs.writeFileSync(p,JSON.stringify(events));assert.equal(createAnkleDaily({directory,now:f.time}).snapshot().events.length,1);
});
test('daily HTTP endpoint blocks cross-origin commands and reports real missing-device errors',async t=>{
 const f=fixture(),server=http.createServer(createAnkleDailyHandler(f.monitor,{snapshot:()=>({feet:{}})}));await new Promise(r=>server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>server.close(r)));
 const url=`http://127.0.0.1:${server.address().port}`;
 assert.equal((await(await fetch(url)).json()).version,1);
 const body=JSON.stringify({side:'left',action:'neutral'});
 assert.equal((await fetch(url,{method:'POST',headers:{'content-type':'application/json',origin:'http://other.example'},body})).status,403);
 const response=await fetch(url,{method:'POST',headers:{'content-type':'application/json'},body});assert.equal(response.status,400);assert.match((await response.json()).error,/BMI270/);
});
