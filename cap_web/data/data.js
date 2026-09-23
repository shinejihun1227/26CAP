import { escapeHtml as esc } from '../src/utils/text.js';
import { PROTOCOL, MOVEMENTS, movementCue, guideProgress } from './collection-guide.js';

const API = '/api/ai/datasets';
const LIMIT = 8 * 1024 * 1024;
const STATES = { normal: '지속 신호 미확인', warning: '주의', confirmed: '신호 감지' };
const STATUSES = { running: '분석 중', countdown: '시작 준비', recording: '기록 중', complete: '완료', failed: '실패', interrupted: '중단됨' };
const REASONS = { below_entry_or_debouncing: '기준 미달 또는 연속 신호 확인 중', sustained_model_and_motion: '연속 모델 신호와 보행 움직임 조건 충족', prolonged_stillness: '장시간 무동작 관찰', low_motion: '모델 신호 감지 · 움직임 추가 확인', yaw_suppressed: '회전 움직임으로 점수 억제', motion_grade: '움직임 조건 추가 확인' };

export function qualityText(result) {
  return ['calibration', 'measurement'].map(key => {
    const q = result[key];
    return `${key === 'calibration' ? '보정' : '측정'}: ${q.rows.toLocaleString()}행 · ${q.duration_s}초 · ${q.received_hz} Hz · 최대 간격 ${q.max_gap_ms}ms · 100ms 초과 누락 ${q.gaps_over_100ms}회 · 빠진 sequence ${q.missing_sequences}개`;
  }).join('\n') + '\n검사 통과. 누락 뒤에는 새 4초 창을 채운 다음 판단합니다.';
}

function score(value) { return typeof value === 'number' && Number.isFinite(value) ? (value * 100).toFixed(1) : '—'; }
function links(id, names) {
  return `<div class="downloads">${names.map(([file, label]) => `<a href="${API}/${encodeURIComponent(id)}/${file}" download>${label} ↓</a>`).join('')}</div>`;
}

export function resultHtml(item) {
  const r = item.result;
  if (!r) return '';
  const card = (title, w) => `<div class="score-card"><span>${title} · ${Number(w.elapsed_s).toFixed(1)}초 시점</span><strong>${score(w.decision_score)}<small>/ 100 · 판정 점수</small></strong><b>${esc(STATES[w.state] ?? w.state)}</b><small>RF ${score(w.rf_score)} · CNN ${score(w.cnn_score)}<br />원래 모델 점수 ${score(w.raw_model_score)}</small><small>${esc(REASONS[w.reason] ?? w.reason)}</small></div>`;
  return `<h3>CSV 기록 분석 완료</h3><p>${esc(r.metadata.participant_id)} · ${esc(r.metadata.session_id)} · ${r.foot === 'left' ? '왼발' : '오른발'} · ${esc(r.metadata.placement)}</p><div class="score-pair">${card('마지막 분석 창', r.latest)}${card('가장 높은 상태의 창', r.highest)}</div><p>${r.window_count}개 창 분석 · 이전 판단 초기화 ${r.resets}회<br />지속 신호 미확인 ${r.state_counts.normal} · 주의 ${r.state_counts.warning} · 신호 감지 ${r.state_counts.confirmed}</p><p class="note">최고 상태는 관찰할 구간을 찾기 위한 값입니다. 마지막 창과 최고 창은 서로 다른 시간일 수 있습니다. 전체 파일의 단일 진단이나 실시간 점수가 아닙니다.</p>${links(item.id, [['windows.csv', '시간별 점수 CSV'], ['result.json', '전체 결과 JSON'], ['measurement.csv', '표준 측정 CSV'], ['calibration.csv', '표준 보정 CSV'], ['calibration.json', '분석용 보정값'], ['manifest.json', '수집·모델 정보']])}<p class="note">모델 식별자: ${esc(r.artifact_id ?? '확인 불가')}<br />보정 식별자: ${esc(r.calibration_id ?? '')}</p>`;
}

export function captureText(c, now = Date.now()) {
  if (c.status === 'countdown') return `${Math.max(0, Math.ceil((c.starts_at_ms - now) / 1000))}초 후 시작 · ${c.purpose === 'calibration' ? '가만히 서 주세요' : '측정 동작을 준비하세요'}`;
  if (c.status === 'recording') return `${Number(c.elapsed_s).toFixed(1)} / ${c.duration_s}초 · ${c.rows}행\n${c.purpose === 'calibration' ? c.elapsed_s < 5 ? '가만히 서 주세요 (첫 5초)' : '평소처럼 걸어 주세요 (20초)' : '원시 IMU 기록 중'}`;
  return `${STATUSES[c.status] ?? c.status} · ${c.rows}행 · ${c.elapsed_s}초${c.error ? `\n${c.error}` : ''}`;
}

export async function readCsvFile(file) {
  if (!file) throw new Error('보정 CSV와 측정 CSV를 각각 선택해 주세요.');
  if (file.size > LIMIT) throw new Error('CSV 파일은 각각 최대 8 MiB입니다. 긴 측정을 나누어 주세요.');
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(await file.arrayBuffer()); }
  catch { throw new Error('CSV를 UTF-8 형식으로 저장해 주세요.'); }
}

if (typeof document !== 'undefined') {
  const $ = id => document.getElementById(id);
  const selected = { calibration: null, measurement: null };
  let items = [], activity = MOVEMENTS[0].id;
  let recordingId = null, jobId = null, busy = false, recording = false, analyzing = false;
  let timer;
  $('context').elements.session_id.value = `${new Intl.DateTimeFormat('sv-SE').format(new Date()).replaceAll('-', '')}_S01`;
  try {
    const saved = JSON.parse(localStorage.getItem('stepon-collection-context') || 'null');
    if (saved) for (const key of ['participant_id', 'session_id', 'side', 'placement']) if (saved[key]) $('context').elements[key].value = saved[key];
  } catch { /* Server records remain available without local storage. */ }
  const rawContext = () => Object.fromEntries(['participant_id', 'session_id', 'side', 'placement'].map(key => [key, $('context').elements[key].value.trim()]));
  $('guide-cards').innerHTML = MOVEMENTS.map(m => `<button type="button" class="movement-card" data-movement="${m.id}" aria-pressed="false"><span class="movement-number">${m.icon}</span><span><b>${m.name}</b><small>${m.seconds}초 · <span data-count="${m.id}">아직 기록 전</span></small></span><span data-mark="${m.id}" aria-hidden="true">○</span></button>`).join('');
  function updateGuide() {
    const progress = guideProgress(items, rawContext());
    const done = progress.filter(m => m.records.length).length;
    $('guide-progress').textContent = `${done} / 5 저장${done === 5 ? ' · 모두 모았어요!' : ''}`;
    for (const m of progress) {
      const button = document.querySelector(`[data-movement="${m.id}"]`);
      button.setAttribute('aria-pressed', String(m.id === activity));
      button.disabled = recording || busy || analyzing;
      document.querySelector(`[data-count="${m.id}"]`).textContent = m.records.length ? `${m.records.length}회 저장` : '아직 기록 전';
      document.querySelector(`[data-mark="${m.id}"]`).textContent = m.records.length ? '✓' : '○';
    }
    const m = MOVEMENTS.find(m => m.id === activity);
    $('movement-title').textContent = m.name;
    $('movement-time').textContent = `선택한 동작 · ${m.seconds}초`;
    $('movement-instruction').textContent = m.instruction;
    $('movement-why').textContent = m.why;
    const ready = selected.calibration?.item?.calibration_valid;
    $('guide-calibration').textContent = ready ? '✓ 보정 완료 · 이 발의 다섯 동작을 기록할 준비가 됐어요.' : '먼저 위의 보정 25초 기록을 끝내 주세요.';
    $('record-help').textContent = ready ? '시간이 끝나면 자동 저장돼요. 완료한 뒤 잠깐 쉬어도 괜찮아요.' : '보정을 완료하면 이 버튼이 켜져요. 외부 CSV는 오른쪽 분석 영역에서 사용할 수 있어요.';
    $('record-measurement').textContent = `${m.name} · ${m.seconds}초 기록`;
    $('record-measurement').disabled = busy || recording || analyzing || !ready;
  }

  async function api(path = '', body) {
    const response = await fetch(`${API}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(35000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error === 'ai_bridge_unavailable' ? 'AI 프로그램과 연결되지 않았어요. run.bat을 실행한 뒤 다시 시도해 주세요.' : result.error || 'AI 프로그램 연결을 확인하세요.');
    return result;
  }
  function controls() {
    for (const id of ['record-calibration', 'record-measurement']) $(id).disabled = busy || recording || analyzing;
    for (const id of ['validate', 'analyze']) $(id).disabled = busy || recording || analyzing;
    for (const input of $('context').elements) input.disabled = recording || analyzing;
    for (const id of ['calibration-file', 'measurement-file']) $(id).disabled = busy || recording || analyzing;
    $('record-stop').hidden = !recording;
    $('record-stop').disabled = busy;
    updateGuide();
  }
  async function action(fn) {
    if (busy) return;
    busy = true; $('error').textContent = ''; controls();
    try { await fn(); }
    catch (error) { $('error').textContent = error.message; }
    finally { busy = false; controls(); }
  }
  function context() {
    // Read disabled inputs as well while an existing capture is stopping.
    const form = $('context');
    if (!form.reportValidity()) throw new Error('참가자 코드와 측정 회차를 입력하세요.');
    return Object.fromEntries(['participant_id', 'session_id', 'side', 'placement'].map(key => [key, form.elements[key].value]));
  }
  async function payload() {
    return { ...context(), calibration_csv: selected.calibration?.text ?? await readCsvFile($('calibration-file').files[0]),
      measurement_csv: selected.measurement?.text ?? await readCsvFile($('measurement-file').files[0]) };
  }
  for (const kind of ['calibration', 'measurement']) {
    $(`${kind}-file`).addEventListener('change', () => {
      selected[kind] = null;
      $(`${kind}-name`).textContent = $(`${kind}-file`).files[0]?.name ?? '선택된 파일이 없습니다.';
      $('validation').textContent = '파일이 바뀌었습니다. 다시 검사하거나 분석을 시작하세요.';
      controls();
    });
  }
  $('validate').addEventListener('click', () => action(async () => {
    $('validation').textContent = '형식·보정 동작을 검사하는 중…';
    try { $('validation').textContent = qualityText(await api('/validate', await payload())); }
    catch (e) { $('validation').textContent = '검사를 통과하지 못했습니다.'; throw e; }
  }));
  $('analysis-form').addEventListener('submit', event => {
    event.preventDefault();
    void action(async () => {
      $('result').innerHTML = ''; $('job-status').textContent = '파일 검사와 분석 작업 준비 중…';
      try {
        const job = await api('/analyze', await payload());
        jobId = job.id; analyzing = true;
        renderJob(job); await history(); schedule();
      } catch (e) { $('job-status').textContent = '분석을 시작하지 못했습니다.'; throw e; }
    });
  });
  function renderJob(job) {
    analyzing = job.status === 'running';
    $('job-status').textContent = `CSV ${STATUSES[job.status] ?? job.status} · ${job.progress ?? 0}%${job.error ? `\n${job.error}` : ''}`;
    $('result').innerHTML = resultHtml(job);
    controls();
  }
  function renderCapture(c) {
    recording = ['countdown', 'recording'].includes(c.status);
    if (recording) for (const key of ['participant_id', 'session_id', 'side', 'placement']) $('context').elements[key].value = c.metadata[key];
    // Countdown from the server avoids different clocks on PC and phone.
    const clock = c.countdown_s === undefined ? Date.now() : c.starts_at_ms - c.countdown_s * 1000;
    $('capture-status').textContent = captureText(c, clock);
    if (c.activity && MOVEMENTS.some(m => m.id === c.activity)) activity = c.activity;
    $('capture-cue').textContent = c.status === 'countdown' ? '곧 시작해요. 자세를 준비해 주세요.' : c.status === 'recording' ? c.purpose === 'calibration' ? c.elapsed_s < 5 ? '가만히 서 주세요' : '이제 평소처럼 걸어 주세요' : movementCue(c.activity, c.elapsed_s) : c.status === 'complete' ? '잘 마쳤어요. 기록을 저장했어요.' : '이 기록은 완료 횟수에 포함하지 않았어요. 연결을 확인하고 다시 해 주세요.';
    $('capture-progress').value = Math.min(100, 100 * c.elapsed_s / c.duration_s);
    $('capture-downloads').innerHTML = recording ? '' : links(c.id, [['recording.csv', '기록 CSV'], ['manifest.json', '기록 정보']]) + (c.status === 'complete' ? `<button type="button" class="secondary" data-use-record="${c.id}">${c.purpose === 'calibration' ? '보정' : '측정'} 파일로 연결</button>` : '');
    controls();
  }
  for (const purpose of ['calibration', 'measurement']) {
    $(`record-${purpose}`).addEventListener('click', () => action(async () => {
      const c = await api('/record/start', { ...context(), purpose, protocol: PROTOCOL, activity,
        calibration_id: selected.calibration?.id, duration_s: MOVEMENTS.find(m => m.id === activity).seconds });
      if (purpose === 'calibration') {
        selected.calibration = null; selected.measurement = null;
        for (const kind of ['calibration', 'measurement']) { $(`${kind}-file`).value = ''; $(`${kind}-name`).textContent = '새 보정에 맞는 기록을 기다리고 있어요.'; }
      }
      recordingId = c.id; renderCapture(c); await history(); schedule();
    }));
  }
  $('record-stop').addEventListener('click', () => action(async () => {
    const c = await api('/record/stop', { id: recordingId });
    renderCapture(c); if (c.status === 'complete') await useRecord(c.id); await history();
  }));
  async function useRecord(id) {
    if (recording || analyzing) throw new Error('진행 중인 작업을 마친 뒤 다른 기록을 연결하세요.');
    const c = await api(`/${id}`);
    if (c.kind !== 'recording' || c.status !== 'complete') throw new Error('완료된 기록만 분석에 연결할 수 있습니다.');
    const response = await fetch(`${API}/${id}/recording.csv`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('CSV 기록을 불러오지 못했습니다.');
    selected[c.purpose] = { text: await readCsvFile(await response.blob()), id, item: c };
    $(`${c.purpose}-file`).value = '';
    $(`${c.purpose}-name`).textContent = `웹 기록 연결: ${c.metadata.session_id} · ${c.rows}행 · ${id.slice(0, 8)}`;
    for (const key of ['participant_id', 'session_id', 'side', 'placement']) $('context').elements[key].value = c.metadata[key];
    if (c.purpose === 'measurement' && c.calibration_id && selected.calibration?.id !== c.calibration_id) await useRecord(c.calibration_id);
    try { localStorage.setItem('stepon-collection-context', JSON.stringify(rawContext())); } catch { }
    $('validation').textContent = '웹 기록을 연결했습니다. 나머지 파일을 선택하고 검사하세요.';
    if (selected.calibration && selected.measurement) $('validation').textContent = '보정과 측정 기록이 연결됐어요. 모델 분석 시작을 눌러 주세요.';
    controls();
  }
  document.addEventListener('click', event => {
    const movement = event.target.closest('[data-movement]');
    if (movement && !recording && !busy && !analyzing) { activity = movement.dataset.movement; updateGuide(); }
    const record = event.target.closest('[data-use-record]');
    const view = event.target.closest('[data-view-job]');
    if (record) void action(() => useRecord(record.dataset.useRecord));
    if (view) void action(async () => {
      if ((recording && view.dataset.viewJob !== recordingId) || (analyzing && view.dataset.viewJob !== jobId)) throw new Error('진행 중인 작업을 마친 뒤 다른 작업을 확인하세요.');
      const item = await api(`/${view.dataset.viewJob}`);
      if (item.kind === 'analysis') { jobId = item.id; renderJob(item); }
      else { recordingId = item.id; renderCapture(item); }
      schedule();
    });
  });
  async function history() {
    const ctx = rawContext();
    const scoped = ctx.participant_id && ctx.session_id;
    const data = await api(scoped ? `?${new URLSearchParams(ctx)}` : '');
    if (JSON.stringify(ctx) !== JSON.stringify(rawContext())) return;
    items = data.items;
    if (data.active_recording) { recordingId = data.active_recording; recording = true; }
    if (data.active_job) { jobId = data.active_job; analyzing = true; }
    $('history-scope').textContent = scoped ? `${ctx.participant_id} · ${ctx.session_id} · ${ctx.side === 'left' ? '왼발' : '오른발'}의 저장 기록이에요. 동작 안내는 실제 정답과 별도로 보관돼요.` : '최근 20개 기록이에요. 참가자와 회차를 입력하면 해당 기록을 모두 모아 볼 수 있어요.';
    $('history').innerHTML = data.items.length ? data.items.map(item => `<div class="history-item"><div><b>${item.kind === 'analysis' ? 'CSV 모델 분석' : item.purpose === 'calibration' ? '보정 기록' : MOVEMENTS.find(m => m.id === item.activity)?.name ?? '측정 기록'} · ${esc(STATUSES[item.status] ?? item.status)}</b><p>${esc(item.metadata.participant_id)} · ${esc(item.metadata.session_id)} · ${item.metadata.side === 'left' ? '왼발' : '오른발'} · ${esc(item.metadata.placement)}${item.repetition ? ` · ${item.repetition}회차 시도` : ''}<br />${esc(new Date(item.created_at_ms).toLocaleString())}${item.error ? `<br />${esc(item.error)}` : ''}</p></div><div class="history-actions">${item.kind === 'recording' && item.status === 'complete' ? `<button class="secondary" type="button" data-use-record="${item.id}">분석에 연결</button>` : ''}<button class="secondary" type="button" data-view-job="${item.id}">보기</button></div></div>`).join('') : '<p>아직 저장된 기록이 없어요. 보정부터 시작해 볼까요?</p>';
    if (scoped && !recording && !analyzing && !selected.calibration) {
      const calibration = items.find(i => i.purpose === 'calibration' && i.protocol === PROTOCOL);
      if (calibration?.status === 'complete' && calibration.calibration_valid) await useRecord(calibration.id);
    }
    controls();
  }
  $('refresh-history').addEventListener('click', () => action(async () => { await history(); schedule(); }));
  $('context').addEventListener('change', () => {
    for (const kind of ['calibration', 'measurement']) {
      selected[kind] = null; $(`${kind}-file`).value = ''; $(`${kind}-name`).textContent = '이번 측정에 사용할 기록을 연결해 주세요.';
    }
    items = []; $('result').innerHTML = ''; $('job-status').textContent = '';
    try { localStorage.setItem('stepon-collection-context', JSON.stringify(rawContext())); } catch { }
    controls();
    void history().then(schedule).catch(error => { $('error').textContent = error.message; });
  });
  function schedule() { clearTimeout(timer); timer = setTimeout(poll, 600); }
  async function poll() {
    try {
      let finished = false;
      if (recordingId && recording) { const c = await api(`/${recordingId}`); renderCapture(c); finished ||= !recording;
        if (c.status === 'complete') await useRecord(c.id); }
      if (jobId && analyzing) { const job = await api(`/${jobId}`); renderJob(job); finished ||= !analyzing; }
      if (finished) await history();
    } catch (error) { $('error').textContent = `상태 확인 실패: ${error.message} 연결되면 다시 확인합니다.`; }
    finally { if (recording || analyzing) schedule(); }
  }
  void action(async () => {
    try { await history(); $('connection').textContent = 'AI 프로그램 연결됨 · 기록 데이터 분석'; schedule(); }
    catch (error) { $('connection').textContent = 'AI 프로그램 연결 필요 · run.bat 실행'; throw error; }
  });
}
