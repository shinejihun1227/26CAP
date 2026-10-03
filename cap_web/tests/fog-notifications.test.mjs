import test from 'node:test';
import assert from 'node:assert/strict';
import { createFogNotifications, isLiveFog, FOG_VOICE_MESSAGE } from '../src/services/fog-notifications.js';
import { createMobileFogAudio } from '../src/services/mobile-fog-audio.js';
import { normalizeAiState } from '../src/services/ai-api.js';
import { aiPresentation } from '../src/components/ai-status-card.js';
import { renderFogControl, renderFogPopup } from '../src/components/fog-control.js';

const live = (extra = {}, ai = {}) => ({ dataSource:'esp32', aiEnabled:true,
  ai:{ available:true, ready:true, deviceConnected:true, windowReady:true, state:'confirmed',
    detectionEnabled:true, lastWindowAtMs:10000, ...ai }, ...extra });

test('only fresh real confirmed inference opens a warning, never demo, paused, stale or missing input', () => {
  assert.equal(isLiveFog(live(), 10000), true);
  for(const state of [live({dataSource:'demo'}),live({paused:true}),live({fogLocalStop:true}),live({aiEnabled:false}),
    ...[{detectionEnabled:false},{available:false},{ready:false},{deviceConnected:false},{windowReady:false},
      {state:'warning'},{state:'normal'},{lastWindowAtMs:null},{lastWindowAtMs:10001},{lastWindowAtMs:7999}].map(ai=>live({},ai))]) {
    assert.equal(isLiveFog(state,10000),false);
  }
});

test('a real popup requests immediate server output sync; audio preview and stale results do not', async () => {
  let syncs=0, alerts=0;
  const notifications=createFogNotifications({audio:createMobileFogAudio({AudioContextCtor:null}),
    speak:()=>true,cancelSpeech:()=>{},onAlert:()=>alerts++,syncCue:async()=>syncs++,now:()=>10000});
  await notifications.activate();
  assert.equal(syncs,0);
  notifications.observe(live({}, {lastWindowAtMs:7999}));
  notifications.observe(live({dataSource:'demo'}));
  assert.equal(alerts,0);
  notifications.observe(live()); notifications.observe(live());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(alerts,1);assert.equal(syncs,1);
  notifications.observe(live({}, {detectionEnabled:false}));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(syncs,1);
});

test('an output sync failure keeps the popup visible and reports the connection error',async()=>{
  let alerts=0,errors=0;
  const notifications=createFogNotifications({audio:createMobileFogAudio({AudioContextCtor:null}),
    onAlert:()=>alerts++,syncCue:async()=>{throw Error('offline');},onCueError:()=>errors++,now:()=>10000});
  notifications.observe(live());
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(alerts,1);assert.equal(errors,1);
});

test('popup works without audio permission; repeated confirmed samples speak once per episode', async () => {
  const speech=[], alerts=[];
  const notifications=createFogNotifications({audio:createMobileFogAudio({AudioContextCtor:null}),
    speak:text=>{speech.push(text);return true;},onAlert:()=>alerts.push(true),now:()=>10000,cancelSpeech:()=>{}});
  notifications.observe(live());
  assert.equal(alerts.length,1);assert.equal(speech.length,0);
  assert.deepEqual(await notifications.activate(),{ok:true,voice:true,tone:false});
  assert.match(speech[0],/음성 알림 테스트/);
  notifications.observe(live()); notifications.observe(live({}, {lastWindowAtMs:9990}));
  assert.equal(alerts.length,1);assert.equal(speech.length,1);
  notifications.observe(live({}, {state:'normal'}));notifications.observe(live());
  assert.equal(alerts.length,2);assert.equal(speech.at(-1),FOG_VOICE_MESSAGE);
  assert.match(FOG_VOICE_MESSAGE,/포그가 발생하였습니다/);
  await notifications.deactivate();
  notifications.observe(live({}, {state:'normal'}));notifications.observe(live());
  assert.equal(alerts.length,3);assert.equal(speech.length,2);
});

test('stopping detection cancels pending audio and speech; resume needs a fresh ready result', async () => {
  const tones=[];let cancelled=0,alerts=0,spoken=0;
  class AudioContext {
    state='suspended';currentTime=0;destination={};
    async resume(){this.state='running';} async suspend(){this.state='suspended';}
    createGain(){return {connect(){},gain:{setValueAtTime(){},exponentialRampToValueAtTime(){},setTargetAtTime(){}}};}
    createOscillator(){const tone={frequency:{setValueAtTime(){}},connect(){},start(){},stops:[],stop(time){this.stops.push(time);}};tones.push(tone);return tone;}
  }
  const notifications=createFogNotifications({audio:createMobileFogAudio({AudioContextCtor:AudioContext}),
    speak:()=>{spoken++;return true;},onAlert:()=>alerts++,now:()=>10000,cancelSpeech:()=>cancelled++});
  await notifications.activate();notifications.observe(live());
  assert.equal(tones.length,3);
  notifications.silence();notifications.observe(live({}, {detectionEnabled:false}));
  assert.equal(cancelled,1);assert.ok(tones.every(t=>t.stops.length===2 && t.stops[1]===undefined));
  notifications.observe(live({}, {ready:false}));
  assert.equal(alerts,1);assert.equal(spoken,2);
  notifications.observe(live());assert.equal(alerts,2);assert.equal(spoken,3);
});

test('background polling cannot start warnings or speech', async () => {
  let alerts=0;
  const notifications=createFogNotifications({audio:createMobileFogAudio({AudioContextCtor:null}),onAlert:()=>alerts++,now:()=>10000});
  notifications.observe(live(),{foreground:false});assert.equal(alerts,0);
  notifications.observe(live(),{foreground:true});assert.equal(alerts,1);
});

test('paused backend state strips scores; unconfirmed stop is never shown as confirmed PC stop', () => {
  globalThis.window={location:{search:'',origin:'http://127.0.0.1:8000'},localStorage:{getItem:()=>null}};
  const ai=normalizeAiState({service:'stepon-ai-bridge',api_version:2,detection:{enabled:false},
    detector_loaded:true,device_connected:true,window_ready:true,state:'confirmed',decision_score:.9,fog_score:.9});
  assert.equal(ai.ready,false);assert.equal(ai.state,null);assert.equal(ai.score,null);
  assert.equal(aiPresentation({ai}).status,'detection_paused');
  assert.equal(aiPresentation({ai:{...ai,available:false}}).status,'detection_unconfirmed');
  assert.match(renderFogControl({ai:{...ai,available:false}}),/PC 중지 미확인/);
  assert.match(renderFogControl({ai,fogControlError:'<script>'}),/&lt;script&gt;/);
  assert.match(renderFogPopup({preview:true}),/알림 테스트 · 실제 감지가 아닙니다/);
  assert.doesNotMatch(renderFogPopup({preview:true}),/data-action="fog-detection-toggle"/);
  assert.match(renderFogPopup(),/role="alertdialog"/);
});
