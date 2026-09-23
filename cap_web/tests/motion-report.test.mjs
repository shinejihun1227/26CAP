import test from 'node:test';
import assert from 'node:assert/strict';
import { session } from './rom-fixtures.mjs';
import { comparableRecords, motionCards, recordInsights, angleSeries, renderAngleChart, renderRecordComparison } from '../src/mediapipe/motion-report.js';

const current = () => session({id:'now',capturedAt:'2026-09-23T08:00:00.000Z'});
const before = () => session({id:'before',capturedAt:'2026-09-22T08:00:00.000Z'});
test('comparison uses earlier eligible records of the same person and exact conditions', () => {
  const now=current(), good=before();
  const records=[good,now,session({id:'future',capturedAt:'2026-09-24T08:00:00.000Z'}),session({id:'bad',capturedAt:good.capturedAt,interrupted:true})];
  for (const config of [{participant:'P02'},{setup:'다른 위치'},{metric:'left_knee'},{posture:'standing'},{confidence:.65},{modelVersion:'another-model'},{width:1280,height:720}]) records.push(session({id:JSON.stringify(config),capturedAt:good.capturedAt,config}));
  assert.deepEqual(comparableRecords(now,records).map(s=>s.id),['before']);
  assert.deepEqual(comparableRecords(session({interrupted:true}),records),[]);
  assert.deepEqual(comparableRecords(null,records),[]);
});
test('empty or stale camera data stays unknown; real zero angles remain zero', () => {
  assert.deepEqual(motionCards({metric:'left_knee'}).map(c=>c.value),['—','—','—','—']);
  const live={metric:'left_knee',analysis:{valid:true,primary:0},fresh:true};
  assert.equal(motionCards(live)[0].value,'0°');
  assert.equal(motionCards({...live,fresh:false})[0].value,'—');
  assert.equal(motionCards({...live,analysis:{valid:false,primary:90}})[0].value,'—');
});
test('saved cards and comparison bars use stored range, median and valid sample ratio', () => {
  const record=current(), baseline=before(), cards=motionCards({record,baseline});
  assert.equal(cards[0].label,'기록 중앙 각도');
  assert.equal(cards[0].value,`${record.summary.byMetric.left_ankle.median}°`);
  assert.equal(cards[1].value,`${record.summary.byMetric.left_ankle.observedRange}°`);
  assert.equal(cards[2].value,'100%');
  assert.equal(cards[3].value,'0°');
  const html=renderRecordComparison(record,baseline);
  assert.match(html,/유효 표본 비율/); assert.doesNotMatch(html,/안정도|정상 범위|NaN|undefined/);
  const bad=session({interrupted:true});
  assert.equal(motionCards({record:bad,baseline})[3].value,'—');
  assert.match(renderRecordComparison(bad,baseline),/두 개가 있어야/);
});
test('timeline uses actual timestamps and breaks lines at missing observations', () => {
  const samples=[{t:200,valid:true,values:{left_knee:0}},{t:700,valid:false,values:{left_knee:90}},{t:1100,valid:true,values:{left_knee:45}},{t:2200,valid:true,values:{left_knee:90}}];
  assert.deepEqual(angleSeries(samples,'left_knee'),[{t:.2,value:0},{t:.7,value:null},{t:1.1,value:45},{t:2.2,value:90}]);
  const html=renderAngleChart(samples,'left_knee',null,15);
  const path=html.match(/class="motion-chart-current" d="([^"]*)"/)[1];
  assert.equal((path.match(/M/g)||[]).length,2); assert.equal((path.match(/L/g)||[]).length,1);
  assert.match(html,/2.2초 · 90°/); assert.match(html,/15초/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});
test('observation summary reports measured peaks, gaps and insufficient quality without diagnosing', () => {
  const record=current(), notes=recordInsights(record,before()).join(' ');
  assert.match(notes,/99°가 4초/);
  assert.match(notes,/관찰 범위/); assert.match(notes,/개선·악화 판정은 아니에요/);
  assert.match(recordInsights(session({interrupted:true}),before()).join(' '),/비교에서 제외/);
  assert.match(recordInsights(null).join(' '),/15초 기록/);
});
