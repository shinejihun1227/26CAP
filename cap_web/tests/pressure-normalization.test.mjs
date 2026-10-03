import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { normalizeStandingPressure, createPressureNormalization } from '../server/pressure-normalization.mjs';
import { createInsoleHub } from '../server/insole-hub.mjs';
import { normalizeBilateralState } from '../src/services/esp32-api.js';
import { initialState } from '../src/data/dashboard-data.js';
import { renderBilateralHeatmap } from '../src/components/bilateral-heatmap.js';
import { pressureCenter } from '../src/data/pressure-center.js';
import { pressureCalibrationText } from '../src/components/pressure-calibration-status.js';

const raw = (side='left', shared=false) => ({ foot_side:side,device_id:`test-${side}`,boot_id:'boot',frame:1,millis:16,
  firmware:'04_2_sta_bilateral_wroom',wifi_mode:'STA',pressure_count:4,pressure_ready:true,
  sensor_profile:shared?'two-shared':'four-independent',pressure_layout:shared?'stepon-pressure-2-shared-v1':'stepon-pressure-4-v1',
  pressure_physical_count:shared?2:4,pressure_channels:shared?[0,0,1,1]:[0,2,4,6],pressure_sensor_map:shared?[0,0,1,1]:[0,1,2,3],
  pressure:shared?[12,12,24,24]:[12,24,36,48],pressure_raw:shared?[500,500,1000,1000]:[500,1000,1500,2000],
  thermal_physical_count:shared?2:4,thermal_sensor_map:shared?[0,0,1,1]:[0,1,2,3],thermal_transport:shared?'dual-i2c':'tca',
  shtc3_channels:shared?[]:[3,4,5,6],temperature:[30,30,30,30],humidity:[25,25,25,25],shtc3_ready:[true,true,true,true] });
const calibration = (p=raw()) => ({version:2,method:'standing-50-v1',id:'a'.repeat(32),status:'ready',device_id:p.device_id,
  foot_side:p.foot_side,sensor_profile:p.sensor_profile,pressure_channels:p.pressure_channels,sensor_map:p.pressure_sensor_map,
  reference_raw:p.pressure_raw.map(v=>v*2)});

test('different standing references yield equal fractions without changing raw or RF/CNN samples',()=>{
  const p=raw(), before=structuredClone(p), result=normalizeStandingPressure(p,calibration(p));
  assert.deepEqual(result.pressure,[25,25,25,25]); assert.deepEqual(p,before);
  assert.deepEqual(result.pressure_raw,p.pressure_raw); assert.deepEqual(result.pressure_adc_percent,p.pressure);
  assert.equal(pressureCenter(result).position,.5);
  const high=normalizeStandingPressure({...p,pressure_raw:[0,2000,4000,4095]},calibration(p));
  assert.deepEqual(high.pressure,[0,50,66.7,51.2]);
  assert.deepEqual(high.pressure_calibration.over_reference,[false,false,true,true]);
});

test('standing scores 50, walking keeps the same reference, twice the reference scores 100',()=>{
  for (const side of ['left','right']) {
    const p=raw(side), c={...calibration(p),reference_raw:[2000,2000,2000,2000]};
    const result=normalizeStandingPressure({...p,pressure_raw:[1000,2000,3000,4095]},c);
    assert.deepEqual(result.pressure,[25,50,75,100]);
    assert.deepEqual(result.pressure_calibration.over_reference,[false,false,true,true]);
    assert.equal(result.pressure_calibration.reference_score,50);
    assert.equal(result.pressure_calibration.source_id,c.id);
    assert.match(result.pressure_calibration.id,/^[a-f0-9]{32}$/);
    assert.notEqual(result.pressure_calibration.id,c.id,'separate historical 100-point records');
    assert.equal(normalizeStandingPressure(p,c).pressure_calibration.id,result.pressure_calibration.id);
    assert.notEqual(normalizeStandingPressure(p,{...c,id:'b'.repeat(32)}).pressure_calibration.id,result.pressure_calibration.id);
    const justOver=normalizeStandingPressure({...p,pressure_raw:[2001,2001,2001,2001]},c);
    assert.deepEqual(justOver.pressure_calibration.over_reference,[true,true,true,true]);
  }
});

test('the UI labels the scale actually served, including an older server before restart',()=>{
  assert.equal(pressureCalibrationText({status:'ready',method:'standing-50-v1',reference_score:50}),'서 있을 때 = 50점');
  assert.match(pressureCalibrationText({status:'ready',reference_score:90}),/이전 보행 기준 90점/);
  assert.match(pressureCalibrationText({status:'ready'}),/이전 보행 기준 100점/);
});

test('side, device, wiring, missing readings and absent references do not silently normalize',()=>{
  const p=raw(), c=calibration(p);
  for(const change of [{device_id:'different'},{foot_side:'right'},{pressure_channels:[0,1,2,3]}])
    assert.equal(normalizeStandingPressure({...p,...change},c).pressure_calibration.status,'mismatch');
  for(const change of [{pressure_ready:false},{pressure_raw:null},{pressure_raw:[null,10,10,10]}])
    assert.equal(normalizeStandingPressure({...p,...change},c).pressure_calibration.status,'unavailable');
  for(const broken of [null,{...c,status:'incomplete'},{...c,reference_raw:[0,0,0,0]}])
    assert.deepEqual(normalizeStandingPressure(p,broken).pressure,p.pressure);
});

test('two shared physical sensors show exact calibrated percentages, without decorative offsets',()=>{
  const p=raw('left',true), result=normalizeStandingPressure(p,calibration(p));
  assert.deepEqual(result.pressure,[25,25,25,25]);
  const state=normalizeBilateralState({service:'stepon-bilateral-v1',feet:{left:{connected:true,age_ms:0,state:result}}},structuredClone(initialState));
  const html=renderBilateralHeatmap(state);
  assert.match(html,/서 있을 때 = 50점/);
  assert.equal((html.match(/<span>25<\/span>/g)||[]).length,4);
});

test('standing references survive reload and each foot has its own device-bound reference',async t=>{
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),'stepon-pressure-'));
  t.after(()=>fs.rm(dir,{recursive:true,force:true}));
  const p=raw(), c=calibration(p);
  await fs.writeFile(path.join(dir,'left.calibration.json'),JSON.stringify({pressure_normalization:c}));
  const store=createPressureNormalization(dir);await store.refresh();
  assert.deepEqual(store.apply('left',p).pressure,[25,25,25,25]);
  assert.equal(store.apply('right',raw('right')).pressure_calibration.status,'needed');
  await fs.writeFile(path.join(dir,'left.calibration.json'),JSON.stringify({pressure_normalization:{...c,reference_raw:[1000,1000,1500,2000]}}));
  await store.refresh();assert.deepEqual(store.apply('left',p).pressure,[25,50,50,50]);
  await fs.writeFile(path.join(dir,'left.calibration.json'),'invalid');await store.refresh();
  assert.equal(store.apply('left',p).pressure_calibration.status,'needed');
});

test('hub presents calibrated values but retains original sample history for AI',async t=>{
  const p=raw();let counter=0;
  const hub=createInsoleHub({presentFrame:(_side,frame)=>normalizeStandingPressure(frame,calibration(p)),
    fetchImpl:async()=>new Response(JSON.stringify({...p,frame:++counter,millis:counter*16}))});
  t.after(()=>hub.stop());hub.register({side:'left',url:'http://192.168.0.12'});
  for(let i=0;i<100&&!hub.snapshot().feet.left.connected;i++)await new Promise(resolve=>setTimeout(resolve,5));
  assert.deepEqual(hub.snapshot().feet.left.state.pressure,[25,25,25,25]);
  assert.deepEqual(hub.samples(0).samples[0].state.pressure,p.pressure);
  assert.equal(hub.samples(0).samples[0].state.pressure_calibration,undefined);
});

test('one calibrated foot and one raw foot do not create a misleading bilateral comparison',()=>{
  const left=raw(),right=raw('right');
  const state=normalizeBilateralState({service:'stepon-bilateral-v1',feet:{
    left:{connected:true,age_ms:0,state:normalizeStandingPressure(left,calibration(left))},
    right:{connected:true,age_ms:0,state:right}}},structuredClone(initialState));
  assert.equal(state.hardware.bilateralAvailable,false);
  assert.equal(state.metrics.balance,null);
  assert.deepEqual(state.bilateralPressure.left,[25,25,25,25]);
  assert.deepEqual(state.bilateralPressure.right,right.pressure);
});

test('old walking maxima require recalibration instead of silently becoming standing values',()=>{
  const p=raw(), c={...calibration(p),version:1,method:'walk-max-v1',max_raw:[1000,1000,1000,1000]};
  const result=normalizeStandingPressure(p,c);
  assert.equal(result.pressure_calibration.status,'recalibration_required');
  assert.deepEqual(result.pressure,p.pressure);
});

test('direct pin changes invalidate the reference even if logical sensor channels stay identical',()=>{
  const p={...raw(),pressure_channels:[0,1,2,3],pressure_transport:'direct-adc1',pressure_input_gpio:[34,35,32,33]};
  const c={...calibration(p),pressure_transport:p.pressure_transport,pressure_input_gpio:p.pressure_input_gpio};
  assert.equal(normalizeStandingPressure(p,c).pressure_calibration.status,'ready');
  assert.equal(normalizeStandingPressure({...p,pressure_input_gpio:[34,35,33,32]},c).pressure_calibration.status,'mismatch');
});
