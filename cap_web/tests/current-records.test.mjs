import test from 'node:test';
import assert from 'node:assert/strict';
import { readFrontRecords } from '../src/mediapipe/front-records.js';
import { renderAnkleRecords, renderFrontRecords, renderFogRecords } from '../src/records-controller.js';
import { renderRecordCalendar } from '../src/trends/record-calendar.js';
import { renderTrendsContent } from '../src/views/trends-view.js';

test('front records retain measured summaries only, with the same 30-day / 20-record limit', () => {
  const now=1800000000000, record={at:now-1000,eligible:true,ratio:90,changedSeconds:2};
  const records=[...Array.from({length:25},(_,i)=>({...record,at:now-1000-i*1000})), {...record,at:now-31*86400000}, {...record,at:now+1000}, {...record,ratio:102}, null];
  const data=readFrontRecords({getItem:()=>JSON.stringify(records)},now);
  assert.equal(data.error,null);assert.equal(data.records.length,20);assert.equal(data.records.at(-1).at,now-1000);
  assert.deepEqual(readFrontRecords({getItem:()=>'{invalid'},now).records,[]);
  assert.ok(readFrontRecords({getItem:()=>'{invalid'},now).error);
});
test('front records do not invent individual joint angles and preserve interrupted observations', () => {
  const html=renderFrontRecords([{at:1800000000000,eligible:false,ratio:35,changedSeconds:1.2}]);
  assert.match(html,/이 브라우저/);assert.match(html,/부분 기록 \/ 중단/);assert.match(html,/35%/);assert.match(html,/1.2초/);
  assert.match(html,/이전 기록에 없던 부위는 —/);assert.doesNotMatch(html,/3방향|set-create|왼발 0°|오른발 0°/);
});
test('ankle records show actual peak and sensor axes without inventing anatomical direction', () => {
  const html=renderAnkleRecords({day:'2026-10-02',feet:{},events:[{at:1800000000000,side:'right',peak:47,threshold:40.5,sensorX:-36.7,sensorY:-49.7}]});
  assert.match(html,/오른발/);assert.match(html,/47°/);assert.match(html,/-36.7° \/ -49.7°/);assert.doesNotMatch(html,/안쪽으로|염좌|정상 범위/);
});
test('FOG downloads distinguish completed recordings, analyses and unfinished files; escape metadata', () => {
  const html=renderFogRecords({items:[
    {id:'record',kind:'recording',purpose:'measurement',status:'complete',metadata:{participant_id:'<img src=x>',side:'left'}},
    {id:'analysis',kind:'analysis',status:'complete'}, {id:'unfinished',kind:'recording',status:'recording'}]});
  assert.match(html,/record\/recording.csv/);assert.match(html,/analysis\/windows.csv/);assert.doesNotMatch(html,/unfinished\/recording.csv|<img src=x>/);assert.match(html,/&lt;img src=x&gt;/);
});
test('sensor calendar hides unrelated old joint measurements', () => {
  const html=renderRecordCalendar(new Map([['2026-10-02',{rom:0,sensor:12}]]),'2026-10-02','2026-10','2026-10-02',{sensorOnly:true});
  assert.doesNotMatch(html,/관절 기록|관절 측정|관절 0회/);assert.match(html,/12개/);
});
test('the sensor tab offers sensor comparisons without old rehabilitation or FOG rule percentages', () => {
  const html = renderTrendsContent({manage:true,sensorOnly:true});
  assert.match(html,/value="pressure"/);assert.match(html,/value="temperature"/);assert.match(html,/value="humidity"/);
  assert.doesNotMatch(html,/value="feedback"|value="fog"/);
});
