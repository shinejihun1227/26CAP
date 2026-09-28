import test from 'node:test';
import assert from 'node:assert/strict';
import { PROTOCOL, guideProgress, movementCue } from '../data/collection-guide.js';
import { createInteractionGuard } from '../src/utils/interaction-guard.js';
import { renderFogCue } from '../src/components/ai-status-card.js';
import fs from 'node:fs';

test('disabled or unacknowledged outputs are not displayed as active and browser cannot bypass PC stop', () => {
  const state={dataSource:'esp32',ai:{available:true,cue:{enabled:false,feet:{left:{requested:true,acknowledged:true}}}}};
  assert.match(renderFogCue(state),/자동 출력 중지됨/);
  state.ai.cue.enabled=true; state.ai.cue.feet.left.acknowledged=false;
  assert.doesNotMatch(renderFogCue(state),/유지 명령 전달 중/);
  const source=fs.readFileSync(new URL('../src/main.js',import.meta.url),'utf8');
  assert.doesNotMatch(source,/triggerAiActuation|lastActuatedFoot/);
});

test('completed movements restore by participant/session/foot, excluding failures and old unlabeled captures', () => {
  const context = { participant_id: 'P1', session_id: 'S1', side: 'left', placement: 'shoe' };
  const good = { kind: 'recording', protocol: PROTOCOL, status: 'complete', activity: 'walking', metadata: context };
  const items = [good, {...good, status:'failed'}, {...good, protocol:undefined}, {...good, metadata:{...context,side:'right'}}, {...good, metadata:{...context,session_id:'S2'}}, {...good, activity:'standing'}];
  const result = guideProgress(items, context);
  assert.equal(result.find(m => m.id === 'walking').records.length, 1);
  assert.equal(result.filter(m => m.records.length).length, 2);
  assert.match(movementCue('start_stop', 9.9), /걸어/);
  assert.match(movementCue('start_stop', 10), /멈춰/);
  assert.match(movementCue('start_stop', 15), /걸어/);
});

test('polling does not replace a pressed control before pointer/keyboard click; release flushes once', () => {
  const handlers = new Map(), timers = new Map(); let next = 0, renders = 0;
  const host = {addEventListener(k, f){handlers.set('host:'+k,f)},removeEventListener(){},setTimeout(f){timers.set(++next,f);return next},clearTimeout(id){timers.delete(id)}};
  const root = {contains:()=>true,addEventListener(k,f){handlers.set(k,f)},removeEventListener(){}};
  const target = {closest:()=>target};
  const guard = createInteractionGuard(root, () => renders++, host);
  for (const [begin, end, key] of [['pointerdown','pointerup'], ['keydown','keyup',' ']]) {
    handlers.get(begin)({type:begin,target,key});
    assert.equal(guard.defer(),true); assert.equal(guard.defer(),true);
    handlers.get('host:'+end)();
    assert.equal(guard.defer(),true, 'release must wait until click dispatch completes');
    handlers.get('host:click')();
    for(const callback of [...timers.values()]) callback(); timers.clear();
    assert.equal(guard.defer(),false);
  }
  assert.equal(renders,2);
  handlers.get('pointerdown')({type:'pointerdown',target}); guard.defer(); handlers.get('host:pointercancel')();
  for(const callback of [...timers.values()]) callback();
  assert.equal(guard.defer(),false); assert.equal(renders,3); guard.destroy();
});
