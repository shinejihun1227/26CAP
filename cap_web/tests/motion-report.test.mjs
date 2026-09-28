import test from 'node:test';
import assert from 'node:assert/strict';
import { session } from './rom-fixtures.mjs';
import { comparableRecords, observationPlanFromRecord, motionCards, recordInsights, angleSeries, renderAngleChart, renderDailyAngleChart, dailyAnglePoints, renderRecordComparison, renderMotionDashboard } from '../src/mediapipe/motion-report.js';
import { METRICS } from '../src/mediapipe/rom-math.js';

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
test('dashboard frames MediaPipe as personal observation and same-condition trend tracking', () => {
  const html = renderMotionDashboard();
  assert.match(html, /내 움직임 기록/);
  assert.match(html, /같은 조건의 내 기록과 비교/);
  assert.match(html, /내 관찰 계획/);
  assert.match(html, /수치 차이는 측정값의 차이이며 개선이나 악화를 판정하지 않습니다/);
  assert.doesNotMatch(html, /정상 범위/);
});
test('first eligible record creates a personal observation plan for every supported joint', () => {
  for (const [metric, definition] of Object.entries(METRICS)) {
    const record = session({ capturedAt: '2026-09-28T08:00:00.000Z', config: { metric, view: definition.views[0] } });
    const plan = observationPlanFromRecord(record);
    assert.ok(plan, `${metric} should be eligible for an observation plan`);
    assert.equal(plan.mode, 'observe');
    assert.equal(plan.config.metric, metric);
    assert.equal(plan.start, record.summary.byMetric[metric].median);
    assert.equal(plan.target, plan.start);
    assert.equal(plan.startDate, '2026-09-28');
    assert.equal(Date.parse(`${plan.endDate}T12:00:00`) - Date.parse(`${plan.startDate}T12:00:00`), 28 * 86400000);
  }
  assert.equal(observationPlanFromRecord(session({ interrupted: true })), null);
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
  const record=current(), notes=recordInsights(record,before()).map(item => item.text).join(' ');
  assert.match(notes,/99° \(4초\)/);
  assert.match(notes,/관찰 범위/); assert.match(notes,/개선·악화 판정은 아니에요/);
  assert.deepEqual(recordInsights(record,before()).map(item => item.label), ['현재 상태','변화','목표','다음 행동']);
  assert.match(recordInsights(session({interrupted:true}),before()).map(item => item.text).join(' '),/비교에 포함하지 않았어요/);
  assert.match(recordInsights(null).map(item => item.text).join(' '),/15초 기록/);
});

test('daily chart groups only eligible records with identical measurement conditions and can mark a goal', () => {
  const a = session({id:'a',capturedAt:'2026-09-20T08:00:00.000Z'}),
    b = session({id:'b',capturedAt:'2026-09-20T12:00:00.000Z'}),
    c = session({id:'c',capturedAt:'2026-09-21T08:00:00.000Z',config:{setup:'다른 위치'}}),
    bad = session({id:'bad',capturedAt:'2026-09-22T08:00:00.000Z',interrupted:true});
  const points = dailyAnglePoints([a,b,c,bad],a.config);
  assert.deepEqual(points.map(p=>p.date),['2026-09-20']);
  assert.equal(points[0].count,2);
  const html=renderDailyAngleChart(points,'left_ankle',100);
  assert.match(html,/목표 100°/); assert.match(html,/2026-09-20/);
  assert.match(renderDailyAngleChart([],'left_ankle'),/조건이 같은 유효한 저장 기록/);
  assert.doesNotMatch(html,/NaN|Infinity/);
});
