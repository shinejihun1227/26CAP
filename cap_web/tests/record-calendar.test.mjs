import test from 'node:test';
import assert from 'node:assert/strict';
import { renderRecordCalendar, shiftMonth } from '../src/trends/record-calendar.js';

test('calendar handles year boundaries, leap days and actual month lengths', () => {
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.throws(() => shiftMonth('2026-13', 1));
  const leap = renderRecordCalendar(new Map(), '2024-02-29', '2024-02', '2026-09-23');
  assert.equal((leap.match(/class="calendar-day /g) || []).length, 29);
  assert.equal((renderRecordCalendar(new Map(), '2025-02-01', '2025-02', '2026-09-23').match(/class="calendar-day /g) || []).length, 28);
});

test('empty months do not fabricate observations or health categories', () => {
  const html = renderRecordCalendar(new Map(), '2026-09-23', '2026-09', '2026-09-23');
  assert.match(html, /첫 기록을 기다리고 있어요/);
  assert.match(html, /기록한 날 <b>0일/);
  assert.doesNotMatch(html, /has-record|joint-count|sensor-count|정상|위험|최장/);
  assert.match(html, /data-day="2026-09-23"[^>]*aria-pressed="true"/);
  assert.match(html, /data-day="2026-09-24"[^>]*disabled/);
  assert.match(html, /aria-label="다음 달" disabled/);
});

test('record markers and recent rows reflect only supplied saved observations', () => {
  const days = new Map([
    ['2026-09-01', {rom:2, sensor:0}],
    ['2026-09-22', {rom:1, sensor:1200}],
    ['2026-08-31', {rom:0, sensor:90}],
  ]);
  const html = renderRecordCalendar(days, '2026-09-22', '2026-09', '2026-09-23');
  assert.match(html, /기록한 날 <b>2일/);
  assert.match(html, /2026-09-22, 관절 1회, 센서 1200표본/);
  assert.match(html, /sensor-count">1,200개/);
  assert.ok(html.indexOf('2026.09.22') < html.indexOf('2026.09.01'));
  assert.ok(html.indexOf('2026.09.01') < html.indexOf('2026.08.31'));
  assert.match(html, /색상은 기록 종류를 뜻합니다/);
});

test('browsing another month preserves selected date and limits recent rows to five', () => {
  const days = new Map(Array.from({length:8}, (_,i) => [`2026-09-${String(i+1).padStart(2,'0')}`, {rom:1,sensor:0}]));
  const html = renderRecordCalendar(days, '2026-09-08', '2026-08', '2026-09-23');
  assert.match(html, /2026년 8월/);
  assert.match(html, /2026-09-08 선택/);
  assert.equal((html.match(/class="trends-day-button"/g) || []).length, 5);
  assert.doesNotMatch(html, /2026\.09\.03/);
  assert.match(html, /data-month="2026-09" aria-label="다음 달" >/);
});
