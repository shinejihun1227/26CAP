import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { createInsoleHub, createInsoleHandler } from '../server/insole-hub.mjs';
import { createAiHandler } from '../server/ai-proxy.mjs';
import { normalizeAiState, markAiUnavailable } from '../src/services/ai-api.js';
import { aiPresentation, renderAiStatusCard } from '../src/components/ai-status-card.js';
import { renderAlgorithmSummary } from '../src/components/algorithm-summary.js';
import { initialState } from '../src/data/dashboard-data.js';

globalThis.window = { location: { search:'', origin:'http://127.0.0.1:8000' }, localStorage:{getItem:()=>null} };
const valid = { service:'stepon-ai-bridge', api_version:2, detector_loaded:true, device_connected:true, window_ready:true,
  state:'warning', status:'warning', fog_score:0.8, decision_score:0.4, model:'ensemble', feet:{}, coverage:1, selected_foot:'left' };

test('web displays the effective model score and preserves raw score as evidence',()=>{
  const ai=normalizeAiState(valid);
  assert.equal(ai.score,0.4); assert.equal(ai.rawScore,0.8); assert.equal(ai.ready,true);
  assert.equal(aiPresentation({ai, aiEnabled:true, dataSource:'esp32', connected:true}).score,0.4);
});
test('warming up, missing calibration, offline and transport errors cannot retain scores',()=>{
  const old=normalizeAiState(valid);
  for(const extra of [{window_ready:false,status:'warming_up'}, {detector_loaded:false,status:'calibration_missing'}, {device_connected:false,status:'device_offline'}]) {
    const ai=normalizeAiState({...valid,...extra},old);
    assert.equal(ai.ready,false); assert.equal(ai.score,null); assert.equal(ai.state,null);
  }
  const ai=markAiUnavailable(old,new Error('offline'));
  assert.equal(ai.score,null); assert.equal(ai.state,null); assert.deepEqual(ai.feet,{});
});
test('paused and disabled screens hide model scores; null never turns into zero',()=>{
  const ai=normalizeAiState(valid);
  for(const extra of [{paused:true},{aiEnabled:false}]) assert.equal(aiPresentation({ai,connected:true,dataSource:'esp32',...extra}).score,null);
  for(const value of [null,undefined,NaN,Infinity,'0.4',-1,1.1]) assert.equal(normalizeAiState({...valid,decision_score:value}).score,null);
});
test('AI summary never substitutes a local proxy when the bridge is missing',()=>{
  const html=renderAlgorithmSummary({...structuredClone(initialState), ai:markAiUnavailable({},new Error('offline')), aiEnabled:true});
  assert.match(html, /<strong>—<\/strong>/); assert.doesNotMatch(html,/로컬 FoG proxy/);
});
test('calibration state and untrusted model diagnostics render safely',()=>{
  const ai=normalizeAiState({...valid,detector_loaded:false,window_ready:false,status:'calibration_missing', model:'<script>x</script>',
    feet:{left:{status:'calibration_missing',device_connected:true,last_error:'<img src=x>',received_hz:60}}});
  const html=renderAiStatusCard({ai,aiEnabled:true,dataSource:'esp32',connected:true});
  assert.match(html,/개인 보정 필요/); assert.match(html,/data-ai-side="left"/); assert.match(html,/&lt;img/); assert.doesNotMatch(html,/<script>/);
});
const listen = async(handler,t)=>{
  const server=http.createServer(handler); await new Promise(r=>server.listen(0,'127.0.0.1',r));
  t.after(()=>{server.closeAllConnections();server.close();}); return `http://127.0.0.1:${server.address().port}`;
};
test('same-origin AI proxy forwards calibration, propagates errors and blocks cross-origin writes',async(t)=>{
  const calls=[];
  const base=await listen(createAiHandler({fetchImpl:async(url,opts)=>{calls.push([String(url),opts]);return new Response(JSON.stringify(valid));}}),t);
  assert.equal((await (await fetch(base+'/api/ai/state')).json()).decision_score,0.4);
  const opts={method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({side:'left'})};
  assert.equal((await fetch(base+'/api/ai/calibration/start',opts)).status,200);
  assert.equal(JSON.parse(calls[1][1].body).side,'left');
  assert.equal((await fetch(base+'/api/ai/calibration/start',{...opts,headers:{...opts.headers,origin:'https://outside.example'}})).status,403);
  assert.equal((await fetch(base+'/api/ai/arbitrary')).status,404);
  const bad=await listen(createAiHandler({fetchImpl:async()=>{throw new Error('offline');}}),t);
  const res=await fetch(bad+'/api/ai/state'); assert.equal(res.status,503); assert.equal((await res.json()).fog_score,null);
});
test('collector sample cursor preserves distinct frames and does not replay duplicate snapshots',async(t)=>{
  let n=0, frozen=false;
  const hub=createInsoleHub({pollIntervalMs:2,fetchImpl:async()=>new Response(JSON.stringify({
    firmware:'04_sta_bilateral',wifi_mode:'STA',device_id:'test-left',boot_id:'boot1',foot_side:'left',frame:frozen?n:++n,millis:n*16,
    pressure_count:4,pressure_layout:'stepon-pressure-4-v1',pressure_channels:[0,2,4,6],pressure:[1,2,3,4],
    shtc3_channels:[3,4,5,6],temperature:[30,30,30,30],humidity:[40,40,40,40],shtc3_ready:[true,true,true,true],
    imu_ready:true,accel:{x:0,y:0,z:1},gyro:{x:0,y:0,z:0}
  }))});
  t.after(()=>hub.stop());hub.register({side:'left',url:'http://192.168.137.2'});
  while(n<10) await new Promise(r=>setTimeout(r,5));
  frozen=true; await new Promise(r=>setTimeout(r,10));
  const batch=hub.samples(0,5);assert.equal(batch.samples.length,5);assert.equal(batch.next_cursor,5);
  const rest=hub.samples(batch.next_cursor);assert.ok(rest.samples.length>=5);
  assert.equal(new Set([...batch.samples,...rest.samples].map(s=>s.state.frame)).size,n);
  assert.equal(hub.samples(rest.next_cursor).samples.length,0);
  assert.equal(hub.samples(999999).dropped,true);
  assert.throws(()=>hub.samples(-1),/invalid_sample_cursor/);
  const base=await listen(createInsoleHandler(hub),t);
  const response=await(await fetch(base+'/api/insoles/samples?after=5&limit=2')).json();
  assert.equal(response.samples.length,2);assert.equal(response.samples[0].cursor,6);
});
