import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createSensorFeedback, createSensorFeedbackHandler } from '../server/sensor-feedback.mjs';
import { renderSensorFeedback } from '../src/components/sensor-feedback.js';
import { pressureCenter } from '../src/data/pressure-center.js';
import { todayState } from './fixtures/today-state.mjs';
import { requestLatestSensorFeedback } from '../src/services/sensor-feedback-api.js';
import { actionGroups, feedbackBasis, recordedFootDirection, evidenceText, romEvidenceDetail } from '../src/data/sensor-feedback.js';

const start = new Date('2026-10-01T10:00:00+09:00').getTime();
function fixture(options = {}) {
  let t = start, frame = 0, rom = [];
  const service = createSensorFeedback({ ankleDaily: { snapshot: () => ({ events: rom }) }, now: () => t, ...options });
  const raw = (front = 90, side = 'left', more = {}) => ({ ...todayState().hardware.feet[side].state,
    frame: ++frame, boot_id: 'boot-1', device_id: side, imu_ready: true,
    accel: { x: 0, y: 0, z: 1 }, gyro: { x: 0, y: 0, z: 0 }, pressure: [front, front, 100 - front, 100 - front], ...more });
  const observe = (front = 90, side = 'left', more) => { t += 100; service.observe(side, raw(front, side, more)); };
  const sustain = (front = 90, side = 'left') => { for (let i = 0; i < 32; i++) observe(front, side); };
  const evidence = (kind = 'cop', side = 'left') => service.snapshot().entries.find(e => e.kind === kind && e.side === side).evidence;
  const addRom = (extra={}) => { rom = [{ id: 'rom-1', side: 'right', at: t - 2000, endedAt: t, peak: 38, threshold: 30, sensorX: -32, sensorY: 12, ...extra }]; };
  return { service, raw, observe, sustain, evidence, addRom, time: () => t, advance: n => t += n };
}
const selection = e => ({ kind: e.kind, side: e.side, eventId: e.id });
test('pressure events never accumulate across a change in standing reference',()=>{
  const f=fixture();
  for(let i=0;i<25;i++)f.observe(90,'left',{pressure_calibration:{id:'old',status:'ready',method:'standing-50-v1'}});
  for(let i=0;i<20;i++)f.observe(90,'left',{pressure_calibration:{id:'new',status:'ready',method:'standing-50-v1'}});
  assert.equal(f.evidence(),null);
  for(let i=0;i<12;i++)f.observe(90,'left',{pressure_calibration:{id:'new',status:'ready',method:'standing-50-v1'}});
  assert.equal(f.evidence().pressureCalibrationId,'new');
  assert.equal(f.evidence().pressureBasis,'standing-50-v1');
  assert.match(feedbackBasis(f.evidence()),/센서별 50점/);
});
const successful = ids => ({ ok: true, json: async () => ({ message: { content: JSON.stringify({ walkingAction: ids[0], checkAction: ids[1] }) } }) });

test('CoP collects only sustained quiet-foot directional bias and keeps feet separate', () => {
  const f = fixture();
  for (let i = 0; i < 29; i++) f.observe(90);
  assert.equal(f.evidence(), null);
  for (let i = 0; i < 3; i++) f.observe(90);
  assert.equal(f.evidence().direction, 'front'); assert.equal(f.evidence().peakPercent, 90);
  assert.equal(f.evidence('cop', 'right'), null);
  const id = f.evidence().id; f.sustain(85); assert.equal(f.evidence().id, id);
  f.sustain(10, 'right'); assert.equal(f.evidence('cop', 'right').direction, 'rear');
  f.sustain(10); assert.notEqual(f.evidence().id, id); assert.equal(f.evidence().direction, 'rear');
});

test('transient walking, missing load/IMU, duplicate frames, gaps and reboots cannot accumulate a pressure event', () => {
  for (const more of [{ gyro: { x: 90, y: 0, z: 0 } }, { imu_ready: false }, { pressure: [0,0,0,0] }, { pressure_ready: false }]) {
    const f = fixture(); for (let i = 0; i < 40; i++) f.observe(90, 'left', more); assert.equal(f.evidence(), null);
  }
  const f = fixture(), raw = f.raw();
  for (let i = 0; i < 40; i++) { f.advance(100); f.service.observe('left', raw); }
  assert.equal(f.evidence(), null); assert.equal(f.service.snapshot().pressureState.left, 'offline');
  for (let i = 0; i < 20; i++) f.observe(); f.advance(1000);
  for (let i = 0; i < 20; i++) f.observe(); assert.equal(f.evidence(), null);
  f.observe(90, 'left', { boot_id: 'boot-2' });
  for (let i = 0; i < 20; i++) f.observe(); assert.equal(f.evidence(), null);
});

test('a new day clears CoP runs; four independent sensors keep their distinct weighted center', () => {
  const f = fixture(); f.sustain(); assert.ok(f.evidence());
  f.advance(86400000); assert.equal(f.evidence(), null); f.observe(); assert.equal(f.evidence(), null);
  assert.equal(pressureCenter({ pressure: [80,10,10,0] }).position, .9);
  assert.equal(pressureCenter({ pressure: [80,80,20,20], sensor_profile: 'two-shared' }), null);
});

test('ROM input uses the confirmed peak sensor direction, not a guessed anatomical direction', async () => {
  let sent, url;
  const f = fixture({ fetchImpl: async (u, options) => { url = u; sent = JSON.parse(options.body); return successful(['walk_even_surface', 'repeat_baseline']); } });
  f.addRom(); const result = await f.service.generate(selection(f.evidence('rom', 'right')));
  assert.equal(result.status, 200); assert.equal(result.evidence.direction, 'X− 방향');
  assert.equal(result.evidence.rangeMax, 25); assert.equal(url, 'http://127.0.0.1:11434/api/chat');
  assert.match(sent.messages[0].content, /해부학적/); assert.match(sent.messages[1].content, /"sensorXDeg":-32/);
  const input=JSON.parse(sent.messages[1].content);
  assert.equal(input.anatomicalDirectionKnown,false);assert.equal(input.thresholdDeg,30);assert.equal(input.seconds,2);
  assert.deepEqual(sent.format.properties.walkingAction.enum,['walk_even_surface','walk_supportive_shoes']);
  assert.doesNotMatch(JSON.stringify(input.choices),/walk_front_pressure|walk_rear_pressure/);
  assert.doesNotMatch(sent.messages[1].content, /device_id|boot_id|participant|video/);
});

test('LLM requests are serialized, responses stay bound to a frozen event, repeat requests use cache', async () => {
  let finish, calls = 0;
  const f = fixture({ fetchImpl: () => { calls++; return new Promise(resolve => finish = resolve); } });
  f.sustain(); const initial = f.evidence(), request = selection(initial);
  const pending = f.service.generate(request);
  assert.equal((await f.service.generate(request)).status, 429);
  f.sustain(98); finish(successful(['walk_front_pressure', 'repeat_pressure']));
  const result = await pending; assert.equal(result.evidence.peakPercent, 90);
  assert.equal((await f.service.generate(request)).evidence.peakPercent, 90); assert.equal(calls, 1);
  f.sustain(10); assert.equal((await f.service.generate(request)).status, 409);
  assert.equal((await f.service.generate({ kind: 'cop', side: 'right', eventId: initial.id })).status, 409);
});

test('offline, invalid output and timeout show failure with cooldown, never fabricated AI advice', async () => {
  for (const fetchImpl of [async () => { throw Error('offline'); }, async () => successful(['check_rear', 'diagnose']), async () => successful(['check_front', 'check_front']), async () => successful(['walk_rear_pressure','check_front']), async () => successful(['walk_front_pressure','walk_front_pressure']), async () => ({ ok: false })]) {
    const f = fixture({ fetchImpl }); f.sustain(); const request = selection(f.evidence());
    assert.equal((await f.service.generate(request)).status, 503);
    assert.equal((await f.service.generate(request)).status, 429);
  }
  const f = fixture({ timeoutMs: 5, fetchImpl: (_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(Object.assign(Error(), { name: 'AbortError' })))) });
  f.sustain(); assert.equal((await f.service.generate(selection(f.evidence()))).error, 'model_timeout');
});

function request(body, headers = {}, method = 'POST') { const req = Readable.from([JSON.stringify(body)]); req.method = method; req.headers = { host: '172.20.10.2:8000', origin: 'http://172.20.10.2:8000', 'content-type': 'application/json', ...headers }; return req; }
const response = () => ({ writeHead(status) { this.status = status; }, end(body) { this.body = JSON.parse(body); } });
test('phone same-origin requests work, cross-site/free prompts/arbitrary URLs/large input are rejected', async () => {
  const f = fixture({ fetchImpl: async () => successful(['walk_front_pressure', 'check_surface']) }); f.sustain();
  const handler = createSensorFeedbackHandler(f.service), body = selection(f.evidence());
  const ok = response(); await handler(request(body), ok); assert.equal(ok.status, 200);
  for (const [input, headers, expected] of [[body, { origin: 'http://other' }, 403], [body, { 'sec-fetch-site': 'cross-site' }, 403], [{ ...body, prompt: 'pretend' }, {}, 400], [{ ...body, url: 'http://other' }, {}, 400], [{ eventId: 'a'.repeat(2000) }, {}, 413]]) {
    const res = response(); await handler(request(input, headers), res); assert.equal(res.status, expected);
  }
});

test('UI binds each result to its event, hides late results for new events and escapes output', () => {
  const f = fixture(); f.sustain(); const evidence = f.evidence();
  const state = { dataSource: 'esp32', sensorFeedback: { receivedAt: Date.now(), data: f.service.snapshot() } };
  assert.match(renderSensorFeedback(state, 'cop'), /AI 피드백 받기/);
  state.sensorFeedbackRequests = { 'cop-left': { eventId: evidence.id, result: { evidence, actionIds: ['walk_front_pressure', 'check_front'], model: '<script>oops</script>', generatedAt: start } } };
  let html = renderSensorFeedback(state, 'cop'); assert.match(html, /앞쪽 압력센서/); assert.doesNotMatch(html, /<script>/);
  for(const text of ['평소 걸을 때','다음에 확인할 점','이 안내를 고른 기준','준비된 문구 중 AI가 선택','뒤꿈치에만 힘을 주어 걷지'])assert.ok(html.includes(text));
  f.sustain(10); state.sensorFeedback.data = f.service.snapshot();
  html = renderSensorFeedback(state, 'cop'); assert.doesNotMatch(html, /OLLAMA · 일반 보행 안내/); assert.match(html, /뒤쪽 압력/);
  state.sensorFeedback.error = 'offline'; assert.match(renderSensorFeedback(state, 'cop'), /AI 피드백 받기/);
  assert.doesNotMatch(renderSensorFeedback(state, 'cop'), /\sdisabled/);
  state.dataSource = 'demo'; assert.match(renderSensorFeedback(state, 'cop'), /AI 피드백 받기/);
  assert.doesNotMatch(renderSensorFeedback(state, 'cop'), /OLLAMA · 일반 보행 안내/);
});

test('one click resolves the newest record and immediately requests feedback without record selection', async () => {
  const f=fixture({fetchImpl:async()=>successful(['walk_front_pressure','repeat_pressure'])});f.sustain();
  const calls=[],updates=[];
  const answer=await requestLatestSensorFeedback('cop','left',{onRecord:(data,evidence)=>updates.push(evidence),fetchImpl:async(url,options)=>{
    calls.push([url,options]);
    if(options.method!=='POST')return {ok:true,json:async()=>f.service.snapshot()};
    const response=await f.service.generate(JSON.parse(options.body));
    return {ok:response.status===200,json:async()=>response};
  }});
  assert.equal(calls.length,2);assert.equal(updates.length,1);
  assert.deepEqual(JSON.parse(calls[1][1].body),selection(f.evidence()));
  assert.equal(answer.result.eventId,f.evidence().id);
  assert.deepEqual(answer.result.actionIds,['walk_front_pressure','repeat_pressure']);
});

test('a button is present without an event; a click explains preparation without calling the model', async () => {
  const f=fixture();let calls=0;
  const answer=await requestLatestSensorFeedback('rom','left',{fetchImpl:async()=>{calls++;return {ok:true,json:async()=>f.service.snapshot()};}});
  assert.equal(calls,1);assert.equal(answer.needsData,true);assert.match(answer.message,/일부러 범위를 넘길 필요는 없어요/);
  const state={dataSource:'esp32',sensorFeedback:{data:f.service.snapshot()},sensorFeedbackRequests:{'rom-left':{notice:answer.message}}};
  const html=renderSensorFeedback(state,'rom');
  assert.equal((html.match(/data-action="sensor-feedback"/g)||[]).length,2);
  assert.match(html,/data-view="ankle"/);assert.doesNotMatch(html,/\sdisabled|OLLAMA · 일반 보행 안내/);
  state.sensorFeedbackRequests['rom-left']={pending:true,eventId:null};
  assert.match(renderSensorFeedback(state,'rom'),/최신 기록 확인 중/);
  assert.equal((renderSensorFeedback(state,'rom').match(/ disabled/g)||[]).length,2);
});

test('click-time feedback rejects mismatched results and preserves server error messages', async () => {
  const f=fixture();f.sustain();const evidence=f.evidence();
  for(const response of [
    {ok:false,json:async()=>({message:'Ollama 실행을 확인하세요.'})},
    {ok:true,json:async()=>({eventId:'another-event',kind:'cop',side:'left',evidence,actionIds:['check_front','check_surface']})},
    {ok:true,json:async()=>({eventId:evidence.id,kind:'cop',side:'left',evidence,actionIds:['walk_rear_pressure','check_front']})},
  ]) {
    await assert.rejects(()=>requestLatestSensorFeedback('cop','left',{fetchImpl:async(_,opts)=>opts.method==='POST'?response:{ok:true,json:async()=>f.service.snapshot()}}),/Ollama 실행|응답 기록/);
  }
});

test('pressure direction selects distinct walking guidance and excludes the opposite sensor', async()=>{
 for(const [front,direction] of [[90,'front'],[10,'rear']]) {
  let sent;
  const f=fixture({fetchImpl:async(_,opts)=>{sent=JSON.parse(opts.body);return successful([`walk_${direction}_pressure`,`check_${direction}`]);}});
  f.sustain(front);const evidence=f.evidence();
  assert.deepEqual(actionGroups(evidence).walking,[`walk_${direction}_pressure`]);
  const result=await f.service.generate(selection(evidence));assert.equal(result.status,200);
  const input=JSON.parse(sent.messages[1].content);assert.equal(input.direction,direction);assert.equal(input.peakPercent,90);assert.equal(input.seconds,3.1);
  assert.deepEqual(Object.keys(input.choices.walking),[`walk_${direction}_pressure`]);
  assert.ok(!Object.hasOwn(input.choices.check,`check_${direction==='front'?'rear':'front'}`));
  assert.match(feedbackBasis(evidence),/거의 멈춘/);assert.match(feedbackBasis(evidence),/80%/);
 }
});

test('uncalibrated sensor axes never become anatomical direction or personalized correction',()=>{
 for(const [x,y] of [[30,0],[-30,0],[0,30],[0,-30]]) {
  const evidence={kind:'rom',sensorX:x,sensorY:y,rangeMax:25};
  assert.deepEqual(actionGroups(evidence),actionGroups({kind:'rom',sensorX:0,sensorY:0}));
  assert.match(feedbackBasis(evidence),/부상 위험도는 알 수 없어/);
 }
});

const savedDirection=(code,forward,left)=>({source:'toe-up',code,forward,left,referenceAt:start-10000});
test('recorded raised edge produces foot-specific cautions for both feet and every direction',async()=>{
 for(const [side,code,forward,left,edge,label] of [
  ['left','left',0,42,'outer','바깥쪽'],['left','right',0,-42,'inner','안쪽'],
  ['right','left',0,42,'inner','안쪽'],['right','right',0,-42,'outer','바깥쪽'],
  ['left','front',42,0,'toe','발끝'],['right','rear',-42,0,'heel','뒤꿈치'],
 ]) {
  let sent;
  const f=fixture({fetchImpl:async(_,opts)=>{sent=JSON.parse(opts.body);return successful([`walk_${edge}_raised`,'check_attachment']);}});
  f.addRom({side,peak:42,threshold:35,footDirection:savedDirection(code,forward,left)});
  const evidence=f.evidence('rom',side);
  assert.equal(recordedFootDirection(evidence).edge,edge);
  assert.equal(evidenceText(evidence),`${side==='left'?'왼발':'오른발'} ${label}이 들리는 꺾임을 조심하세요!`);
  assert.match(romEvidenceDetail(evidence),/최대 42° \/ 기록 기준 30° · 12° 초과/);
  const result=await f.service.generate(selection(evidence));assert.equal(result.status,200);
  const input=JSON.parse(sent.messages[1].content);
  assert.equal(input.footDirectionKnown,true);assert.equal(input.footDirection.edge,edge);
  assert.deepEqual(Object.keys(input.choices.walking),[`walk_${edge}_raised`]);
  const html=renderSensorFeedback({dataSource:'esp32',sensorFeedback:{data:f.service.snapshot()},sensorFeedbackRequests:{[`rom-${side}`]:{eventId:evidence.id,result}}},'rom');
  assert.match(html,/sensor-feedback-caution/);assert.ok(html.includes(evidenceText(evidence)));
  assert.match(html,/측정값·방향 근거 보기/);assert.doesNotMatch(html,/방향 다시 기록/);
 }
});

test('legacy, invalid and ambiguous directions never create inward or outward cautions',()=>{
 const base={kind:'rom',side:'left',at:start-2000,peak:42,rangeMax:30,sensorX:-42,sensorY:0};
 for(const footDirection of [null,savedDirection('left',0,-42),savedDirection('left',0,20),
  {...savedDirection('left',0,42),source:'sensor-axis'}, {...savedDirection('left',0,42),referenceAt:start},
  {...savedDirection('left',0,42),left:NaN}]) {
  const evidence={...base,footDirection};assert.equal(recordedFootDirection(evidence),null);
  assert.equal(evidenceText(evidence),'왼발이 기록한 범위를 넘어 꺾이지 않도록 조심하세요.');
  assert.match(romEvidenceDetail(evidence),/방향 미확인/);
  assert.deepEqual(actionGroups(evidence).walking,['walk_even_surface','walk_supportive_shoes']);
 }
 assert.equal(recordedFootDirection({...base,peak:95,footDirection:savedDirection('left',0,42)}),null);
 const html=renderSensorFeedback({dataSource:'esp32',sensorFeedback:{data:{entries:[{kind:'rom',side:'left',evidence:base}]}}},'rom');
 assert.match(html,/왼발 방향 다시 기록/);assert.doesNotMatch(html,/안쪽이 들리는 꺾임|바깥쪽이 들리는 꺾임/);
});

test('Ollama cannot return a caution for the opposite recorded edge',async()=>{
 const f=fixture({fetchImpl:async()=>successful(['walk_outer_raised','check_attachment'])});
 f.addRom({side:'left',peak:42,footDirection:savedDirection('right',0,-42)});
 const result=await f.service.generate(selection(f.evidence('rom','left')));
 assert.equal(result.status,503);assert.equal(result.actionIds,undefined);
});
