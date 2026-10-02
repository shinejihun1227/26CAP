import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/data/dashboard-data.js';
import { normalizeEsp32State, normalizeBilateralState, markEsp32Disconnected } from '../src/services/esp32-api.js';
import { thermalDisplayForFoot } from '../src/components/thermal-display.js';
import { renderBilateralHeatmap } from '../src/components/bilateral-heatmap.js';
import { renderInsoleConnections } from '../src/components/insole-connection.js';
import { readObservationFeet } from '../src/data/observation-monitor.js';
import { buildSensorSample } from '../src/trends/trend-math.js';

function payload(side = 'left', ready = [true, true], shared = true) {
  return { foot_side: side, device_id: `test-${side}`, boot_id:'test-boot', frame:1,
    sensor_profile:shared?'two-shared':'four-independent',
    pressure_layout:shared?'stepon-pressure-2-shared-v1':'stepon-pressure-4-v1',
    pressure_count:4, pressure_physical_count:shared?2:4,
    pressure_sensor_map:shared?[0,0,1,1]:[0,1,2,3], pressure_channels:shared?[0,0,1,1]:[0,2,4,6],
    thermal_physical_count:shared?2:4, thermal_sensor_map:shared?[0,0,1,1]:[0,1,2,3],
    thermal_transport:shared?'dual-i2c':'tca9548a', shtc3_channels:shared?[]:[3,4,5,6],
    temperature:shared?[30,30,32,32]:[30,31,32,33], humidity:shared?[50,50,60,60]:[50,51,60,61],
    shtc3_ready:shared?[ready[0],ready[0],ready[1],ready[1]]:ready,
    pressure:[20,20,40,40], pressure_ready:true, imu_ready:true,
    accel:{x:0,y:0,z:1},gyro:{x:0,y:0,z:0} };
}
function stateFor(ready=[true,true], side='left') {
  const state=normalizeEsp32State(payload(side,ready),structuredClone(initialState));
  state.sensorReceivedAt=state.sensorAdvancedAt=10000;
  return state;
}
const values = result => result.samples.map(sample=>sample.value);

test('two physical readings stay exact; two extra slots use their unweighted mean with bounded offsets',()=>{
  const state=stateFor(), before=structuredClone(state);
  const temperature=thermalDisplayForFoot(state,'left','temperature',10000);
  const humidity=thermalDisplayForFoot(state,'left','humidity',10000);
  assert.deepEqual(values(temperature),[30,30.85,32,31.15]);
  assert.deepEqual(values(humidity),[50,54.4,60,55.6]);
  assert.equal(temperature.mean,31);assert.equal(humidity.mean,55);
  assert.equal(temperature.physicalCount,2);assert.equal(temperature.estimatedCount,2);
  assert.deepEqual(temperature.samples.map(s=>s.estimated),[false,true,false,true]);
  assert.deepEqual(state,before,'presentation leaves raw measurements and readiness untouched');
});
test('either remaining sensor fills the other three slots using only that foot',()=>{
  for(const ready of [[true,false],[false,true]]) {
    const state=stateFor(ready), temperature=thermalDisplayForFoot(state,'left','temperature',10000);
    const realIndex=ready[0]?0:2, mean=ready[0]?30:32;
    assert.equal(temperature.physicalCount,1);assert.equal(temperature.estimatedCount,3);
    assert.equal(temperature.samples[realIndex].value,mean);assert.equal(temperature.samples[realIndex].estimated,false);
    for(const sample of temperature.samples) assert.ok(Math.abs(sample.value-mean)<=0.151);
    assert.equal(new Set(values(temperature)).size,4);
    assert.deepEqual(values(thermalDisplayForFoot(state,'right','temperature',10000)),[null,null,null,null]);
    assert.equal(state.hardware.sensors.thermal.count,1);
  }
});
test('loss, reconnection and flat readings are deterministic without stale invented data',()=>{
  const state=stateFor([true,false]);
  const first=thermalDisplayForFoot(state,'left','temperature',10000);
  assert.deepEqual(thermalDisplayForFoot(state,'left','temperature',11000),first);
  assert.deepEqual(values(thermalDisplayForFoot(stateFor([false,false]),'left','temperature',10000)),[null,null,null,null]);
  assert.deepEqual(values(thermalDisplayForFoot(markEsp32Disconnected(state,new Error('offline')),'left','temperature',10000)),[null,null,null,null]);
  assert.deepEqual(values(thermalDisplayForFoot(state,'left','temperature',12501)),[null,null,null,null]);
  const recovered=normalizeEsp32State(payload(),state);
  assert.equal(thermalDisplayForFoot(recovered,'left','temperature',10000).samples[2].estimated,false);
});
test('invalid, sentinel and out-of-range readings are excluded; humidity remains in 0–100%',()=>{
  for(const [field,bad] of [['temp',-127],['temp',NaN],['temp',101],['humidity',null],['humidity',-1],['humidity',101]]) {
    const state=stateFor();state.thermal.left[0][field]=state.thermal.left[1][field]=bad;
    assert.equal(thermalDisplayForFoot(state,'left','temperature',10000).physicalCount,1);
  }
  for(const value of [0,100]) {
    const state=stateFor([true,false]);state.thermal.left[0].humidity=state.thermal.left[1].humidity=value;
    const result=thermalDisplayForFoot(state,'left','humidity',10000);
    assert.equal(result.samples[0].value,value);
    assert.ok(values(result).every(v=>v>=0&&v<=100));
  }
});
test('mixed two/four configurations are chosen per foot, independent of selected analysis side',()=>{
  const state=normalizeBilateralState({service:'stepon-bilateral-v1',feet:{
    left:{connected:true,age_ms:10,state:payload('left',[true,false])},
    right:{connected:true,age_ms:10,state:payload('right',[true,false,true,true],false)}
  }},structuredClone(initialState));
  state.sensorReceivedAt=10000;
  assert.equal(thermalDisplayForFoot(state,'left','temperature',10000).estimatedCount,3);
  const right=thermalDisplayForFoot(state,'right','temperature',10000);
  assert.deepEqual(values(right),[30,null,32,33]);assert.equal(right.estimatedCount,0);
  state.hardware.feet.left.age_ms=2600;
  assert.deepEqual(values(thermalDisplayForFoot(state,'left','temperature',10000)),[null,null,null,null]);
});
test('observations and saved trend samples count real sensors only after heatmap estimation',()=>{
  const state=stateFor([true,false]);
  thermalDisplayForFoot(state,'left','temperature',10000);
  const feet=readObservationFeet(state,10000);
  assert.equal(feet.left.temperatures.length,1);assert.equal(feet.left.temperature,30);assert.equal(feet.left.thermalTotal,2);
  const sample=buildSensorSample(state,'P01','flat',10000);
  assert.equal(sample.values.temperature,30);assert.equal(sample.values.humidity,50);
  assert.deepEqual(sample.condition.thermalChannels,['heel']);
});
test('heatmap groups estimate guidance above clean numeric labels and retains provenance',()=>{
  const state=stateFor([true,false]);delete state.sensorReceivedAt;delete state.sensorAdvancedAt;
  const html=renderBilateralHeatmap({...state,heatmapMode:'temperature'});
  assert.equal((html.match(/data-value-source="estimated"/g)||[]).length,3);
  assert.doesNotMatch(html,/heat-estimate-tag/);
  assert.match(html,/실측 평균으로 보완한 추정값/);
  assert.match(html,/실측 1\/2/);assert.match(html,/왼발 실측 평균/);
  assert.equal((html.match(/data-value-source="unavailable"/g)||[]).length,4);
  const hubState=normalizeBilateralState({service:'stepon-bilateral-v1',feet:{left:{connected:true,age_ms:10,state:payload('left',[true,false])}}},structuredClone(initialState));
  assert.match(renderInsoleConnections(hubState),/SHTC3 실측 1\/2/);
});
test('existing preview measurements without device readiness metadata still render',()=>{
  const result=thermalDisplayForFoot(structuredClone(initialState),'left','temperature',10000);
  assert.equal(result.physicalCount,4);assert.equal(result.estimatedCount,0);
});
