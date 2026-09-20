// Full HTTP transport with synthetic sensors and real bundled RF/CNN weights.
// All recordings and calibration fixtures are temporary, never user calibration.
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createInsoleHub, createInsoleHandler } from '../server/insole-hub.mjs';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const delay=(ms)=>new Promise(r=>setTimeout(r,ms));
const listen=async(server)=>{await new Promise(r=>server.listen(0,'127.0.0.1',r));return server.address().port;};
const freePort=async()=>{const s=http.createServer();const port=await listen(s);await new Promise(r=>s.close(r));return port;};
const waitFor=async(fn,ms=45000)=>{const until=Date.now()+ms;let error;while(Date.now()<until){try{const value=await fn();if(value)return value;}catch(e){error=e;}await delay(100);}throw new Error(`condition timeout: ${error?.message??''}`);};

test('C3 and WROOM sensor histories reach real RF/CNN through Python and the web proxy', {timeout:75000}, async(t)=>{
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'stepon-synthetic-e2e-'));
  const processes=[]; let logs='';
  t.after(async()=>{for(const child of processes)child.kill();await delay(300);assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temp,{recursive:true,force:true});});
  const cal={vertical_channel:'raw_acc_z',vertical_sign:-1,forward_channel:'raw_acc_x',lateral_channel:'raw_acc_y',vertical_confidence:0.9,forward_confidence:0.8,zscore_mean_vfl:[-1,0,0],zscore_std_vfl:[0.15,0.2,0.1],gyro_yaw_channel:null,test_only:true};
  for(const side of ['left','right'])await fs.writeFile(path.join(temp,`${side}.calibration.json`),JSON.stringify({...cal,foot_side:side}));
  const began=performance.now(), active={left:true,right:true};
  const hub=createInsoleHub({fetchImpl:async(url)=>{
    const side=url.includes('.2/')?'left':'right'; if(!active[side])throw new Error('synthetic_device_offline');
    const n=Math.floor((performance.now()-began)*64/1000), t=n/64;
    return new Response(JSON.stringify({firmware:side==='right'?'04_2_sta_bilateral_wroom':'04_sta_bilateral',wifi_mode:'STA',device_id:`synthetic-${side}`,boot_id:'synthetic-boot',foot_side:side,frame:n,millis:n*1000/64,
      pressure_count:4,pressure_layout:'stepon-pressure-4-v1',pressure_channels:[0,2,4,6],pressure:[10,20,30,40],
      shtc3_channels:[3,4,5,6],temperature:[30,30,30,30],humidity:[40,40,40,40],shtc3_ready:[true,true,true,true],imu_ready:true,
      accel:{x:0.2*Math.sin(2*Math.PI*1.5*t),y:0.06*Math.cos(2*Math.PI*1.5*t),z:1+0.12*Math.sin(2*Math.PI*3*t)},gyro:{x:0,y:0,z:0}}));
  }});
  const collector=http.createServer(createInsoleHandler(hub));const hubPort=await listen(collector);
  t.after(()=>{hub.stop();collector.closeAllConnections();collector.close();});
  hub.register({side:'left',url:'http://192.168.137.2'});hub.register({side:'right',url:'http://192.168.137.3'});
  const aiPort=await freePort(), webPort=await freePort();
  const start=(exe,args,env={})=>{const p=spawn(exe,args,{cwd:root,env:{...process.env,...env},windowsHide:true});processes.push(p);p.stdout.on('data',d=>logs+=d);p.stderr.on('data',d=>logs+=d);p.on('error',e=>logs+=e.message);return p;};
  const python=process.env.STEPON_TEST_PYTHON || path.join(root,'.venv-ai',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  start(python,['-u','web/ai_bridge/server.py','--hub-url',`http://127.0.0.1:${hubPort}`,'--port',`${aiPort}`,'--data-dir',temp]);
  start(process.execPath,['cap_web/dev-server.mjs',`${webPort}`],{STEPON_AI_URL:`http://127.0.0.1:${aiPort}`,STEPON_ROM_DATA_DIR:path.join(temp,'rom'),STEPON_TREND_DATA_DIR:path.join(temp,'trends')});
  const base=`http://127.0.0.1:${webPort}`;
  const get=async()=>{const r=await fetch(base+'/api/ai/state');if(!r.ok)return null;return r.json();};
  try{
    const result=await waitFor(async()=>{const s=await get();return s?.coverage===2&&s.window_ready?s:null;});
    assert.equal(result.api_version,2);assert.equal(result.source,'insole_hub');
    assert.ok(result.score_percent>=0&&result.score_percent<=100);
    for(const foot of Object.values(result.feet)){assert.ok(foot.received_hz>=32);assert.ok(foot.window_count>0);}
    const html=await(await fetch(base+'/?view=safety&esp32=1&transport=sta&ai=1')).text();assert.match(html,/ai-integration.css/);
    console.log(JSON.stringify({synthetic_e2e:true,coverage:result.coverage,state:result.state,score:result.score_percent,received_hz:Object.fromEntries(Object.entries(result.feet).map(([s,f])=>[s,f.received_hz]))}));
    const post=async(action)=>fetch(base+`/api/ai/calibration/${action}`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({side:'left'})});
    const begin=await post('start');assert.equal(begin.status,200);assert.equal((await begin.json()).feet.left.status,'calibrating');
    const cancel=await post('cancel');assert.equal(cancel.status,200);assert.equal((await cancel.json()).feet.left.capture.status,'cancelled');
    active.left=false;
    const partial=await waitFor(async()=>{const s=await get();return s?.coverage===1&&s.selected_foot==='right'?s:null;},6000);
    assert.equal(partial.feet.left.decision_score,null);
    active.right=false;
    const offline=await waitFor(async()=>{const s=await get();return s&&!s.window_ready?s:null;},6000);
    assert.equal(offline.decision_score,null);assert.equal(offline.fog_score,null);assert.equal(offline.state,null);
  }catch(error){throw new Error(`${error.stack}\nProcess logs:\n${logs}`);}
});
