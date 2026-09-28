import { koreaDay, romGroups, romDays, sensorDays, compareDays, SENSOR_METRICS, buildSensorSample } from './trend-math.js';
import { renderComparison, renderSensorSummary, changeText } from './trend-render.js';
import { escapeHtml as e } from '../utils/text.js';
import { renderRecordCalendar } from './record-calendar.js';
import { syncLiveNode } from '../utils/app-shell.js';

export function mountTrendWorkspace(root, getState, context = null) {
  const $ = (selector) => root.querySelector(selector), action = (id) => $(`[data-trend-action="${id}"]`);
  const managing = root.dataset.trendsMode === "manage";
  const events = new AbortController();
  let alive = true, recording = false, saving = false, loading = false, rows = [], sessions = [], romSets = [], ready = false, romReady = false;
  let lastFrame = null, saved = 0, skipped = 0, errorMessage = '', refreshedAt = null;
  const participant = () => $('[data-trend-participant]').value.trim();
  const notice = (message, error = false) => { if (!alive) return; $('[data-trend-notice]').textContent = message; $('[data-trend-notice]').classList.toggle('is-error', error); };
  const date = () => $('[data-trend-date]').value || koreaDay();
  const mode = () => $('[data-trend-comparison]').value;
  let calendarMonth = context?.calendarMonth || (context?.date || date()).slice(0, 7);
  async function request(url, method = 'GET', body) {
    const response = await fetch(url, { method, cache: 'no-store', signal: AbortSignal.timeout(6000), headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined });
    if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('새 개인 기록 API가 필요합니다. 8000·8001 서버를 재시작해 주세요.');
    const payload = await response.json(); if (!response.ok) throw new Error(payload.error || `기록 서버 오류 ${response.status}`); return payload;
  }
  function buttons() {
    if (!alive) return;
    const s = getState();
    action('start').disabled = !managing || recording || saving || !ready || !$('[data-trend-consent]').checked || !participant() || !$('[data-trend-setup]').value.trim() || s.dataSource !== 'esp32' || !s.connected;
    action('stop').disabled = !recording;
    action('export').disabled = !ready || !romReady || recording || saving;
    $('[data-trend-participant]').disabled = recording || saving;
    $('[data-trend-setup]').disabled = recording || saving;
    $('[data-trend-consent]').disabled = recording || saving;
    $('[data-trend-live-status]').textContent = recording ? `● 기록 중 · 저장 ${saved} · 제외 ${skipped}` : saving ? '마지막 표본 저장 중' : `기록 중 아님${saved ? ` · 이번에 ${saved}표본 저장` : ''}`;
  }
  function options(select, entries) {
    const selected = select.value;
    const html = entries.map((item) => `<option value="${e(item.key)}">${e(item.label)}</option>`).join('') || '<option value="">저장된 기록 없음</option>';
    if (select.dataset.options !== html) { select.innerHTML = html; select.dataset.options = html; }
    if (entries.some((item) => item.key === selected)) select.value = selected;
  }
  function render() {
    if (!alive) return;
    const code = participant(), groups = romGroups(sessions, code), mine = rows.filter((r) => r.participant === code);
    options($('[data-trend-rom]'), groups);
    const sensorGroups = [...new Map(mine.map((r) => [r.conditionKey, { key: r.conditionKey, label: `${r.condition.setup} · ${r.condition.side === 'left' ? '왼발' : '오른발'} · ${r.condition.bilateral ? '양발' : '한쪽'} · ${r.condition.pressureLayout ? '압력 4개' : '이전 배치'} · ${r.conditionKey.slice(0, 6)}` }])).values()];
    options($('[data-trend-sensor]'), sensorGroups);
    const group = groups.find((g) => g.key === $('[data-trend-rom]').value), days = romDays(group);
    const sensorKey = $('[data-trend-sensor]').value, metric = $('[data-trend-metric]').value, spec = SENSOR_METRICS[metric];
    const makeDays = (m) => sensorDays(rows, code, sensorKey, m);
    $('[data-trend-rom-result]').classList.toggle('trends-empty', !group);
    $('[data-trend-rom-result]').innerHTML = !romReady ? '관절 기록을 읽지 못했습니다. 요약을 최신 결과로 표시하지 않습니다.' : group ? `<details class="trends-detail"><summary>분리해서 비교하는 촬영 조건</summary>${e(group.config.modelVersion)} · ${group.config.width}×${group.config.height} · ${e(group.config.protocol)}<br>측정 코드·관절·좌우·자세·환경 코드·신뢰도·모델·화면 비율이 같아야 비교합니다.</details>${renderComparison(days, date(), mode())}` : '이 측정 코드의 관절 기록이 없습니다. MediaPipe에서 측정을 완료한 뒤 기록을 저장하세요.';
    $('[data-trend-sensor-result]').classList.toggle('trends-empty', !sensorKey);
    const source = mine.find((r) => r.conditionKey === sensorKey);
    $('[data-trend-sensor-result]').innerHTML = !ready ? '센서 저장소를 읽지 못했습니다. 이전 결과를 최신 결과로 표시하지 않습니다.' : sensorKey ? `<details class="trends-detail"><summary>센서·알고리즘 비교 조건</summary><pre>${e(JSON.stringify(source.condition, null, 2))}</pre></details>${renderComparison(makeDays(metric), date(), mode(), { sensor: true, unit: spec.unit, label: spec.label, note: spec.note })}${renderSensorSummary(rows, makeDays, date(), mode())}` : '저장된 실제 센서 기록이 없습니다. 데이터 관리에서 깔창 연결과 저장 동의를 확인하고 센서 기록을 시작하세요. 시연 데이터는 저장하지 않습니다.';
    const allDays = new Map();
    for (const s of sessions.filter((s) => s.config.participant === code)) { const key = koreaDay(s.capturedAt); if (!allDays.has(key)) allDays.set(key, { rom: 0, sensor: 0, conditions: 0 }); allDays.get(key).rom++; }
    for (const r of mine) { if (!allDays.has(r.day)) allDays.set(r.day, { rom: 0, sensor: 0, conditions: 0 }); allDays.get(r.day).sensor += r.sampleCount; allDays.get(r.day).conditions++; }
    $('[data-trend-days]').textContent = String(allDays.size);
    const changes = [];
    if (romReady) { const c = compareDays(days, date(), mode()); if (c.delta !== null) changes.push({ label: '선택한 관절 범위', delta: c.delta, unit: '°', attention: c.delta < 0 }); }
    if (ready) for (const [id, s] of Object.entries(SENSOR_METRICS)) { const c = compareDays(makeDays(id), date(), mode()); if (c.delta !== null) changes.push({ label: s.label, delta: c.delta, unit: s.unit === '%' ? '%p' : s.unit, attention: ['fog', 'feedback'].includes(id) && c.delta > 0 }); }
    $('.trends-summary h2').textContent = changes.length ? `${changes.length}개 지표를 이전 기록과 비교했습니다` : '비교할 기록을 쌓고 있습니다';
    const attention = changes.filter((c) => c.attention);
    $('.trends-summary p').textContent = changes.length ? `${(attention.length ? attention : changes).slice(0, 3).map((c) => `${c.label}: ${changeText(c.delta, c.unit)}`).join(' · ')}. ${attention.length ? '다시 확인할 수치 변화입니다. 악화로 확정하지 않습니다.' : '수치 변화는 개선·악화 판정을 의미하지 않습니다.'}` : '선택한 날짜와 비교 날짜에 같은 조건의 유효 기록이 필요합니다. 전날 기록이 없다면 ‘직전 기록일’을 선택하세요.';
    const calendar = $('[data-trend-calendar]'), nextCalendar = calendar.cloneNode(false);
    nextCalendar.innerHTML = renderRecordCalendar(allDays, date(), calendarMonth) + (managing && mine.length ? `<details class="trends-detail"><summary>내보내기 후 날짜별 센서 기록 관리</summary>${mine.map((r) => `<p>${r.day} · ${e(r.condition.setup)} · ${r.conditionKey.slice(0, 6)} <button data-trend-action="delete" data-id="${r.id}" ${recording || saving ? 'disabled' : ''}>이 센서 기록 삭제</button></p>`).join('')}</details>` : '');
    const open = calendar.querySelector('details')?.open;
    if (nextCalendar.querySelector('details')) nextCalendar.querySelector('details').open = Boolean(open);
    syncLiveNode(calendar, nextCalendar);
    const codes = [...new Set([...sessions.map((s) => s.config.participant), ...rows.map((r) => r.participant)])].sort();
    $('#trend-participants').innerHTML = codes.map((c) => `<option value="${e(c)}"></option>`).join('');
    buttons();
  }
  async function refresh() {
    if (loading || !alive) return false;
    loading = true;
    const responses = await Promise.allSettled([request('/api/rom'), request('/api/trends')]);
    if (!alive) { loading = false; return false; }
    romReady = responses[0].status === 'fulfilled' && Array.isArray(responses[0].value.sessions);
    ready = responses[1].status === 'fulfilled' && responses[1].value.schemaVersion === 1 && Array.isArray(responses[1].value.rows);
    sessions = romReady ? responses[0].value.sessions : []; romSets = romReady ? responses[0].value.sets ?? [] : [];
    rows = ready ? responses[1].value.rows : [];
    const failures = responses.filter((r) => r.status === 'rejected').map((r) => r.reason.message);
    refreshedAt = new Date().toLocaleTimeString('ko-KR');
    notice(failures.join(' / ') || errorMessage || `${refreshedAt} 갱신 · 개인 기록만 표시 · 30일 보관 · 5초마다 새 기록 확인`, Boolean(failures.length || errorMessage));
    loading = false; render(); return ready && romReady;
  }
  function stop() { recording = false; buttons(); void refresh(); }
  async function sample() {
    if (!recording || saving || !alive) { buttons(); return; }
    if (document.hidden) { stop(); return; }
    const s = getState(), item = buildSensorSample(s, participant(), $('[data-trend-setup]').value.trim());
    if (!item || item.frame === lastFrame) { skipped++; buttons(); return; }
    saving = true;
    try { const result = await request('/api/trends', 'POST', item); lastFrame = item.frame; if (!result.duplicate) saved++; errorMessage = ''; }
    catch (error) { errorMessage = `저장 중단: ${error.message}`; recording = false; notice(errorMessage, true); }
    finally { saving = false; buttons(); }
  }
  root.addEventListener('change', (event) => { if (event.target.matches('[data-trend-date]')) calendarMonth = date().slice(0, 7); if (event.target.matches('[data-trend-participant]')) { $('[data-trend-rom]').value = ''; $('[data-trend-sensor]').value = ''; } render(); }, { signal: events.signal });
  root.addEventListener('input', buttons, { signal: events.signal });
  root.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-trend-action]'); if (!target || target.disabled) return;
    const id = target.dataset.trendAction;
    if (id === 'refresh') { errorMessage = ''; await refresh(); }
    else if (id === 'start' && managing) { recording = true; lastFrame = null; saved = 0; skipped = 0; errorMessage = ''; notice('실제 센서 관찰값을 저장합니다. 이 탭을 숨기면 기록이 중지됩니다.'); buttons(); void sample(); }
    else if (id === 'stop') stop();
    else if (id === 'day') { $('[data-trend-date]').value = target.dataset.day; calendarMonth = date().slice(0, 7); render(); }
    else if (id === 'calendar-month') { calendarMonth = target.dataset.month; render(); }
    else if (id === 'metric') { $('[data-trend-metric]').value = target.dataset.metric; render(); }
    else if (id === 'delete' && managing) {
      if (recording || saving || !window.confirm('이 날짜·조건의 센서 요약을 영구 삭제할까요? 내보낸 파일 외에는 복구할 수 없습니다. 관절 기록은 남습니다.')) return;
      try { await request('/api/trends', 'DELETE', { id: target.dataset.id, confirm: 'DELETE_SENSOR_DAY' }); await refresh(); } catch (error) { notice(error.message, true); }
    } else if (id === 'export') {
      const code = participant();
      if (!await refresh() || code !== participant() || !alive) { notice('최신 기록을 확인하지 못해 내보내기를 취소했습니다.', true); return; }
      const file = { exportedAt: new Date().toISOString(), timeZone: 'Asia/Seoul', participant: code, note: '관찰 기록이며 개선·악화 또는 진단을 확정하지 않습니다.', rom: sessions.filter((s) => s.config.participant === code), sets: romSets.filter((s) => s.participant === code), sensorDaily: rows.filter((r) => r.participant === code) };
      const url = URL.createObjectURL(new Blob([JSON.stringify(file, null, 2)], { type: 'application/json' })), link = document.createElement('a');
      link.href = url; link.download = `stepon-daily-${koreaDay()}.json`; link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
  }, { signal: events.signal });
  document.addEventListener('visibilitychange', () => { if (document.hidden) stop(); else void refresh(); }, { signal: events.signal });
  window.addEventListener('pagehide', stop, { signal: events.signal });
  window.addEventListener('beforeunload', (event) => { if (saving) { event.preventDefault(); event.returnValue = ''; } }, { signal: events.signal });
  const captureTimer = setInterval(sample, 1000), readTimer = setInterval(() => { if (!document.hidden) void refresh(); }, 5000);
  if (context) for (const key of ['participant', 'setup', 'date', 'comparison', 'metric']) {
    if (context[key] !== undefined) $(`[data-trend-${key}]`).value = context[key];
  }
  void refresh(); buttons();
  return { getContext: () => ({...Object.fromEntries(['participant', 'setup', 'date', 'comparison', 'metric'].map(key => [key, $(`[data-trend-${key}]`).value])), calendarMonth}), canLeave() { if (saving) { notice('마지막 표본 저장이 끝나면 이동해 주세요.'); return false; } if (recording && !window.confirm('센서 기록을 중지하고 다른 화면으로 이동할까요? 저장 완료된 자료는 유지됩니다.')) return false; stop(); return true; }, destroy() { alive = false; recording = false; clearInterval(captureTimer); clearInterval(readTimer); events.abort(); } };
}
