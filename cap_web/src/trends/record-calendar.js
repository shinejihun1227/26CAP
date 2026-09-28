import { escapeHtml as e } from '../utils/text.js';
import { koreaDay } from './trend-math.js';

export function shiftMonth(month, offset) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('invalid_calendar_month');
  const [year, number] = month.split('-').map(Number);
  const date = new Date(Date.UTC(year, number - 1 + offset, 1));
  return date.toISOString().slice(0, 7);
}

// Dots describe stored record types, never an inferred health/risk category.
export function renderRecordCalendar(days, selectedDay, month = selectedDay.slice(0, 7), today = koreaDay()) {
  const next = shiftMonth(month, 1), previous = shiftMonth(month, -1);
  const [year, number] = month.split('-').map(Number);
  const first = new Date(Date.UTC(year, number - 1, 1)).getUTCDay();
  const length = new Date(Date.UTC(year, number, 0)).getUTCDate();
  const recent = [...days].filter(([day]) => /^\d{4}-\d{2}-\d{2}$/.test(day)).sort(([a], [b]) => b.localeCompare(a)).slice(0, 5);
  const inMonth = [...days.keys()].filter(day => day.startsWith(`${month}-`)).length;
  const cells = Array.from({length: first}, () => '<span class="calendar-spacer" aria-hidden="true"></span>');
  for (let day = 1; day <= length; day++) {
    const key = `${month}-${String(day).padStart(2, '0')}`, record = days.get(key);
    const detail = record ? `관절 ${record.rom}회, 센서 ${record.sensor}표본` : '저장된 기록 없음';
    cells.push(`<button type="button" class="calendar-day ${key === selectedDay ? 'is-selected' : ''} ${key === today ? 'is-today' : ''} ${record ? 'has-record' : ''}" data-trend-action="day" data-day="${key}" aria-label="${key}, ${e(detail)}" aria-pressed="${key === selectedDay}" ${key > today ? 'disabled' : ''}><span>${day}</span><span class="calendar-dots" aria-hidden="true">${record?.rom ? '<i class="dot-joint"></i>' : ''}${record?.sensor ? '<i class="dot-sensor"></i>' : ''}</span></button>`);
  }
  return `<div class="record-coverage"><section class="calendar-pane" aria-label="기록 달력"><div class="calendar-toolbar"><button type="button" data-trend-action="calendar-month" data-month="${previous}" aria-label="이전 달">‹</button><h3>${year}년 ${number}월</h3><button type="button" data-trend-action="calendar-month" data-month="${next}" aria-label="다음 달" ${next > today.slice(0, 7) ? 'disabled' : ''}>›</button></div><div class="calendar-weekdays" aria-hidden="true">${['일','월','화','수','목','금','토'].map(d=>`<span>${d}</span>`).join('')}</div><div class="calendar-grid">${cells.join('')}</div><div class="calendar-legend"><span><i class="dot-joint"></i>관절 기록</span><span><i class="dot-sensor"></i>보행 기록</span><span>점 없음 · 기록 없음</span></div><p class="calendar-caption">${number}월에 기록한 날 <b>${inMonth}일</b> · 날짜를 누르면 위 비교에 반영돼요.</p></section><section class="recent-records" aria-label="최근 저장 기록"><div class="recent-records-heading"><h3>최근 기록</h3><span>${e(selectedDay)} 선택</span></div>${recent.length ? `<div class="trends-table-wrap"><table><thead><tr><th>기록 날짜</th><th>관절 측정</th><th>보행 표본</th></tr></thead><tbody>${recent.map(([day,r])=>`<tr class="${day===selectedDay?'is-selected':''}"><td><button type="button" class="trends-day-button" data-trend-action="day" data-day="${day}">${day.replaceAll('-','.')}</button></td><td>${r.rom ? `<span class="record-count joint-count">${r.rom}회</span>` : '—'}</td><td>${r.sensor ? `<span class="record-count sensor-count">${r.sensor.toLocaleString('ko-KR')}개</span>` : '—'}</td></tr>`).join('')}</tbody></table></div>` : '<div class="calendar-empty"><span aria-hidden="true">＋</span><b>첫 기록을 기다리고 있어요</b><p>움직임을 측정하고 저장하면<br>달력에 나의 기록이 쌓여요.</p><button type="button" data-view="records">기록 저장 방법 보기 →</button></div>'}<p class="calendar-caption">내 측정 코드로 저장한 기록만 표시합니다.<br>색상은 기록 종류를 뜻합니다.</p></section></div>`;
}
