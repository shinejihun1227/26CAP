import test from 'node:test';
import assert from 'node:assert/strict';
import { summaryFog, summaryAnkle, summaryCop, sphereMarker } from '../src/data/today-summary.js';
import { tiltRotationVector, inclination } from '../src/mediapipe/ankle-monitor.js';
import { renderTodaySummary } from '../src/components/today-summary.js';
import { openNavigationShortcut } from '../src/utils/navigation-shortcuts.js';
import { todayState } from './fixtures/today-state.mjs';
const now = 1000000;

test('FoG table shows each model decision and the backend-selected result without averaging feet', () => {
  const s=todayState(now), result=summaryFog(s,now);
  assert.deepEqual(result.feet.map(f=>f.value),[23,68]);
  assert.equal(result.value,68);assert.equal(result.selected,'right');
  s.ai.feet.left.decision_score=0;assert.equal(summaryFog(s,now).feet[0].value,0);
  s.ai.feet.left.last_window_at_ms=now-3000;assert.equal(summaryFog(s,now).feet[0].value,null);
  s.ai.lastWindowAtMs=now+1;assert.equal(summaryFog(s,now).value,null);
});

test('FoG missing data, pause, stop and demo cannot retain previous live scores', () => {
  for(const alter of [s=>s.ai.available=false,s=>s.fogLocalStop=true,s=>s.ai.detectionEnabled=false,s=>s.aiEnabled=false,s=>s.paused=true,s=>s.dataSource='mock']) {
    const s=todayState(now);alter(s);const d=summaryFog(s,now);
    assert.equal(d.value,null);assert.ok(d.feet.every(f=>f.value===null&&f.rf===null&&f.cnn===null));
  }
  const s=todayState(now);s.ai.feet.right.ready=false;assert.equal(summaryFog(s,now).value,null);
});

test('range color compares each own recorded maximum, separate from +5 degree sustained event rule', () => {
  const s=todayState(now);
  assert.equal(summaryAnkle(s,'left',now).outside,false);assert.equal(summaryAnkle(s,'right',now).outside,true);
  s.dailyAnkle.data.feet.left.current.tilt=25;assert.equal(summaryAnkle(s,'left',now).outside,false);
  s.dailyAnkle.data.feet.left.current.tilt=26;const d=summaryAnkle(s,'left',now);
  assert.equal(d.outside,true);assert.equal(d.eventConfirmed,false);
  s.dailyAnkle.data.feet.right.plan.max=40;assert.equal(summaryAnkle(s,'right',now).outside,false);
});

test('unprepared, stale, disconnected or moving ranges show no falsely safe blue point', () => {
  for(const alter of [s=>s.dailyAnkle.data.feet.left.plan=null,s=>s.dailyAnkle.receivedAt=now-2001,
    s=>s.dailyAnkle.error='network',s=>s.dailyAnkle.data.feet.left.state='moving',s=>s.dailyAnkle.data.feet.left.state='offline',s=>s.paused=true]) {
    const s=todayState(now);alter(s);const d=summaryAnkle(s,'left',now);
    assert.equal(d.tilt,null);assert.equal(sphereMarker(d.tilt,d.plan?.max,d.vector),null);
  }
});

test('sphere projection always makes within/outside unambiguous regardless of direction', () => {
  for(const vector of [[1,0,0],[-1,0,0],[0,1,0],[0,0,1],[3,-5,8]]) {
    const inside=sphereMarker(24,25,vector),outside=sphereMarker(25.1,25,vector);
    assert.ok(Math.hypot(inside.x-140,inside.y-120)<80);
    assert.ok(Math.hypot(outside.x-140,outside.y-120)>80);
  }
  assert.equal(sphereMarker(0,25,[0,0,0]).distance,0);
  assert.equal(sphereMarker(null,25,null),null);
  assert.equal(sphereMarker(180,25,null),null, 'an indeterminate gravity rotation must not invent a direction');
});

test('gravity rotation vector length equals inclination for arbitrary sensor mounting', () => {
  for(const [a,b] of [[[0,0,1],[.5,0,Math.sqrt(.75)]],[[0,1,0],[0,Math.sqrt(.75),.5]],[[1,0,0],[0,1,0]]]) {
    assert.ok(Math.abs(Math.hypot(...tiltRotationVector(a,b))-inclination(a,b))<1e-8);
  }
  assert.deepEqual(tiltRotationVector([0,0,1],[0,0,1]),[0,0,0]);
  assert.equal(tiltRotationVector([0,0,1],[0,0,-1]),null);
});

test('front/rear CoP uses physical channels once, unaffected by synthetic heatmap values', () => {
  const s=todayState(now);s.bilateralPressure={left:[1,99,2,88],right:[100,100,100,100]};
  const left=summaryCop(s,'left',now),right=summaryCop(s,'right',now);
  assert.equal(left.front,80);assert.equal(left.rear,20);assert.equal(left.label,'앞쪽 중심');
  assert.equal(right.front,25);assert.equal(right.label,'뒤쪽 중심');
  s.hardware.feet.left.state.pressure=[50,50,50,50];assert.equal(summaryCop(s,'left',now).label,'가운데 중심');
});

test('no pressure, stale transport and invalid sensor maps suppress CoP rather than inventing a center', () => {
  for(const alter of [s=>s.hardware.feet.left.state.pressure=[0,0,0,0],s=>s.hardware.feet.left.state.pressure_ready=false,
    s=>s.hardware.feet.left.connected=false,s=>s.hardware.feet.left.age_ms=2001,s=>s.sensorReceivedAt=now-2001,
    s=>s.hardware.feet.left.state.pressure_sensor_map=[0,1,0,1],s=>s.paused=true]) {
    const s=todayState(now);alter(s);assert.equal(summaryCop(s,'left',now).position,null);
  }
});

test('today page exposes both setup links, explicit data meaning, blue/red status, and front/rear readings', () => {
  const html=renderTodaySummary(todayState(now),now);
  assert.match(html,/data-open-disclosure="device-baselines"/);assert.match(html,/data-view="ankle"/);
  assert.match(html,/data-daily-focus="left"/);assert.match(html,/data-daily-focus="right"/);
  assert.match(html,/data-range-state="within"/);assert.match(html,/data-range-state="outside"/);
  assert.match(html,/data-cop-position="0.800"/);assert.match(html,/data-cop-position="0.250"/);
  assert.match(html,/실제 발목 관절 ROM과 달라요/);assert.doesNotMatch(html,/NaN|undefined/);
});

test('calibration shortcuts open and focus the actual setup area without starting captures', () => {
  let scrolled=0,focused=0;const target={open:false,scrollIntoView(){scrolled++;},querySelector:()=>({focus(){focused++;}})};
  const selectors=[];const root={querySelector:s=>{selectors.push(s);return target;}};
  assert.equal(openNavigationShortcut(root,'devices',{openDisclosure:'device-baselines'}),true);assert.equal(target.open,true);
  assert.equal(openNavigationShortcut(root,'ankle',{dailyFocus:'right'}),true);
  assert.deepEqual(selectors,['[data-ui-disclosure="device-baselines"]','[data-daily-side="right"]']);
  assert.equal(scrolled,2);assert.equal(focused,2);
  assert.equal(openNavigationShortcut(root,'ankle',{dailyFocus:'invalid'}),false);
});
