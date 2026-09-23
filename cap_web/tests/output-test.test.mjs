import test from 'node:test';
import assert from 'node:assert/strict';
import { runOutputTest, outputTestError } from '../src/services/cue-controller.js';
import { createInsoleHub } from '../server/insole-hub.mjs';
import { renderDevicesView } from '../src/views/devices-view.js';
import { initialState } from '../src/data/dashboard-data.js';

test('test notification waits for hardware acknowledgement and names the selected foot', async () => {
  const messages = [], calls = []; let resolve;
  const done = runOutputTest({ kind:'vibration', side:'right', enabled:true, notify:s=>messages.push(s),
    vibration:(effect,side)=>{ calls.push([effect,side]); return new Promise(r=>resolve=r); } });
  assert.deepEqual(calls, [[47,'right']]);
  assert.equal(messages.length, 1); assert.match(messages[0], /전달 중/);
  resolve({queued:true}); await done;
  assert.match(messages[1], /오른발 진동 명령이 접수/);
  assert.match(messages[1], /실제 모터/);
});

test('rejected and demo output tests never report an accepted command', async () => {
  const messages = []; let commands = 0;
  const options = {kind:'vibration',side:'left',enabled:true,notify:s=>messages.push(s),
    vibration:async()=>{commands++;throw new Error('drv2605_not_ready');}};
  await assert.rejects(runOutputTest(options), /drv2605_not_ready/);
  assert.ok(messages.every(s=>!s.includes('접수')));
  await assert.rejects(runOutputTest({...options,enabled:false}), /real_sensor_mode_required/);
  assert.equal(commands,1);
  assert.match(outputTestError(new Error('drv2605_not_ready'),'left'), /GPIO13.*GPIO14.*RESET/);
  assert.match(outputTestError(new Error('selected_foot_offline'),'right'), /오른발이 연결되지/);
});

test('laser test is bounded and attempts OFF even after an uncertain ON response', async () => {
  for (const lostResponse of [false,true]) {
    const calls=[], messages=[];
    const done = runOutputTest({kind:'laser',side:'left',enabled:true,notify:s=>messages.push(s),
      laser:async(on,side)=>{calls.push([on,side]);if(on&&lostResponse)throw new Error('timeout');},
      wait:async ms=>assert.equal(ms,650)});
    if(lostResponse) await assert.rejects(done,/timeout/); else await done;
    assert.deepEqual(calls,[[true,'left'],[false,'left']]);
    assert.equal(messages.some(s=>s.includes('접수')), !lostResponse);
  }
});

test('a failed laser OFF request has a visible failure message', async () => {
  const messages=[];
  await runOutputTest({kind:'laser',side:'right',enabled:true,notify:s=>messages.push(s),wait:async()=>{},
    laser:async on=>{if(!on)throw new Error('device_timeout');}});
  assert.match(messages.at(-1), /종료 응답을 받지 못/);
});

test('hub exposes missing driver and firmware error codes without leaking arbitrary response HTML', async t => {
  let sequence=0, ready=false, body={error:'laser_disabled_for_safety'}, calls=0;
  const hub=createInsoleHub({pollIntervalMs:5,fetchImpl:async url=>{
    if(new URL(url).pathname==='/api/state') return new Response(JSON.stringify({
      firmware:'04_2_sta_bilateral_wroom',wifi_mode:'STA',device_id:'test-left',boot_id:'test-boot',
      foot_side:'left',frame:++sequence,millis:sequence*16,pressure_count:4,pressure_layout:'stepon-pressure-4-v1',
      pressure_channels:[0,2,4,6],pressure:[0,0,0,0],shtc3_channels:[3,4,5,6],
      temperature:[20,20,20,20],humidity:[40,40,40,40],shtc3_ready:[true,true,true,true],
      imu_ready:false,drv2605_ready:ready}));
    calls++; return new Response(typeof body==='string'?body:JSON.stringify(body),{status:409});
  }});
  t.after(()=>hub.stop()); hub.register({side:'left',url:'http://192.168.0.2'});
  const until=async fn=>{for(let i=0;i<100;i++){if(fn())return;await new Promise(r=>setTimeout(r,10));}throw new Error('hub not ready');};
  await until(()=>hub.snapshot().feet.left.connected);
  await assert.rejects(hub.command('left','vibrate'), /drv2605_not_ready/); assert.equal(calls,0);
  await assert.rejects(hub.command('right','vibrate'), /selected_foot_offline/);
  await assert.rejects(hub.command('left','laser',true), /laser_disabled_for_safety/);
  body='<script>secret</script>'; await assert.rejects(hub.command('left','laser',true), /^Error: device_http_409$/);
  ready=true; await until(()=>hub.snapshot().feet.left.state?.drv2605_ready);
  body={error:'vibration_unavailable'};
  await assert.rejects(hub.command('left','vibrate'), /vibration_unavailable/);
});

test('device settings show the vibration driver independently from Wi-Fi and the IMU', () => {
  const state=structuredClone(initialState);
  state.dataSource='esp32';state.connected=true;
  state.hardware={sensors:{drv2605:{ready:false},imu:{ready:true}}};
  const html=renderDevicesView(state);
  assert.match(html,/진동 드라이버/);assert.match(html,/DRV2605L/);
  assert.match(html,/DRV2605L[^]*?확인 필요/);
});
