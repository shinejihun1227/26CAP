import test from 'node:test';
import assert from 'node:assert/strict';
import { initialState } from '../src/data/dashboard-data.js';
import { validateFrame } from '../server/insole-hub.mjs';
import { normalizeEsp32State, normalizeBilateralState } from '../src/services/esp32-api.js';
import { renderBilateralHeatmap } from '../src/components/bilateral-heatmap.js';
import { analyzeRehabFrame } from '../src/data/gait-algorithms.js';
import { buildSensorSample } from '../src/trends/trend-math.js';
import { sanitizeSensorSample } from '../server/trend-store.mjs';

function frame(side, channels, pressure = [10, 20, 30, 40]) {
  return { firmware: '04_2_sta_bilateral_wroom', wifi_mode: 'STA', device: 'StepOn-WROOM',
    device_id: `wroom-${side}`, boot_id: 'test-boot', foot_side: side, frame: 1, millis: 16,
    pressure_count: 4, pressure_layout: 'stepon-pressure-4-v1', pressure_channels: channels,
    pressure_ready: true, pressure, pressure_raw: pressure.map((p) => Math.round(p * 4095 / 100)),
    shtc3_channels: [3, 4, 5, 6], temperature: [-127, -127, -127, -127], humidity: [-127, -127, -127, -127],
    shtc3_ready: [false, false, false, false], imu_ready: true, accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 } };
}

function directFrame(side, pressure) {
  return {...frame(side,[0,1,2,3],pressure),firmware:'04_3_sta_bilateral_wroom_direct',
    sensor_profile:'four-independent',pressure_physical_count:4,pressure_sensor_map:[0,1,2,3],
    pressure_transport:'direct-adc1',pressure_input_gpio:[34,35,32,33]};
}

test('4-3 direct ADC preserves four independent spots and labels actual GPIOs', () => {
  for(let pressed=0;pressed<4;pressed++) {
    const pressure=[0,0,0,0];pressure[pressed]=80;
    const payload=directFrame('left',pressure);
    validateFrame(payload,'left');
    const state=normalizeEsp32State(payload,structuredClone(initialState));
    assert.deepEqual(state.pressure,pressure);
    const html=renderBilateralHeatmap(state);
    const active=(html.match(/<span\b[^>]*>/g)??[]).filter(tag=>tag.includes('data-pressure-state="active"'));
    assert.equal(active.length,1);
    assert.match(active[0],new RegExp(`data-sensor-index="${pressed}"`));
    assert.match(active[0],new RegExp(`GPIO${[34,35,32,33][pressed]} 직접 입력`));
    assert.doesNotMatch(active[0],/MUX/);
  }
  for(const change of [{pressure_input_gpio:[34,35,32,32]},{pressure_input_gpio:[34,35,25,33]},
    {pressure_input_gpio:[34,35,32]},{pressure_input_gpio:['34',35,32,33]},
    {pressure_input_gpio:undefined},{pressure_transport:'mux'}]) {
    assert.throws(()=>validateFrame({...directFrame('left'),...change},'left'),/direct_pressure_pins/);
  }
});

test('direct 4-3 and MUX 4-2 retain separate per-foot wiring labels', () => {
  const payload={service:'stepon-bilateral-v1',frame:10,feet:{
    left:{connected:true,age_ms:0,state:directFrame('left')},
    right:{connected:true,age_ms:0,state:frame('right',[0,2,4,6])}}};
  const state=normalizeBilateralState(payload,structuredClone(initialState));
  assert.deepEqual(state.bilateralPressure.left,[10,20,30,40]);
  assert.deepEqual(state.bilateralPressure.right,[10,20,30,40]);
  assert.match(renderBilateralHeatmap(state),/왼발 GPIO34 \/ 오른발 C0/);
  assert.match(renderBilateralHeatmap(state),/왼발 GPIO33 \/ 오른발 C6/);
});

test('each supported wiring sends a single-sensor input to exactly one matching web pressure spot', () => {
  for (const channels of [[0, 2, 4, 6], [0, 1, 2, 3]]) for (let pressed = 0; pressed < 4; pressed++) {
    const pressure = [0, 0, 0, 0]; pressure[pressed] = 80;
    const payload = frame('left', channels, pressure);
    validateFrame(payload, 'left');
    const state = normalizeEsp32State(payload, structuredClone(initialState));
    assert.deepEqual(state.pressure, pressure);
    assert.deepEqual(state.hardware.pressureChannels, channels);
    const html = renderBilateralHeatmap(state);
    assert.equal((html.match(/data-pressure-state="active"/g) ?? []).length, 1);
    const activeSpot = (html.match(/<span\b[^>]*>/g) ?? []).find(tag => tag.includes('data-pressure-state="active"'));
    assert.ok(activeSpot, 'the pressed sensor has an active marker');
    assert.match(activeSpot, /data-sensor-side="left"/);
    assert.match(activeSpot, new RegExp(`data-sensor-index="${pressed}"`));
    assert.match(html, new RegExp(`MUX CH${channels[pressed]}`));
  }
});

test('new and legacy boards retain independent channel labels when used together', () => {
  const payload = { service: 'stepon-bilateral-v1', frame: 10, feet: {
    left: { connected: true, age_ms: 0, state: frame('left', [0, 1, 2, 3]) },
    right: { connected: true, age_ms: 0, state: frame('right', [0, 2, 4, 6]) },
  } };
  for (const side of ['left', 'right']) {
    validateFrame(payload.feet[side].state, side);
    const previous = structuredClone(initialState); previous.rehab.config.activeFoot = side;
    const state = normalizeBilateralState(payload, previous);
    assert.deepEqual(state.hardware.raw.pressure_channels, payload.feet[side].state.pressure_channels);
    assert.deepEqual(state.hardware.pressureChannels, payload.feet[side].state.pressure_channels);
    assert.deepEqual(state.bilateralPressure.left, [10, 20, 30, 40]);
    assert.deepEqual(state.bilateralPressure.right, [10, 20, 30, 40]);
    assert.match(renderBilateralHeatmap(state), /왼발 C3 \/ 오른발 C6/);
  }
});

test('trend records preserve physical wiring and separate new and legacy conditions', () => {
  const now = Date.now(), conditions = [];
  for (const channels of [[0, 1, 2, 3], [0, 2, 4, 6]]) {
    const state = normalizeEsp32State(frame('left', channels), structuredClone(initialState));
    state.sensorReceivedAt = state.sensorAdvancedAt = now;
    state.rehab = analyzeRehabFrame({ state, history: {}, now }).rehab;
    const record = sanitizeSensorSample(buildSensorSample(state, 'P01', 'flat', now), now);
    assert.deepEqual(record.condition.pressureChannels, channels);
    assert.equal(record.values.pressure, 25);
    conditions.push(record.conditionKey);
  }
  assert.notEqual(conditions[0], conditions[1]);
});

test('unrecognized, reordered, duplicate or missing STA channels remain rejected', () => {
  for (const channels of [[0, 1, 2, 4], [1, 0, 2, 3], [0, 1, 1, 3], [0, 1, 2], ['0', 1, 2, 3], null, undefined]) {
    assert.throws(() => validateFrame(frame('left', channels), 'left'), /pressure_layout/);
  }
  const legacy = normalizeEsp32State(frame('left', undefined), structuredClone(initialState));
  assert.deepEqual(legacy.hardware.pressureChannels, [0, 2, 4, 6]);
});
