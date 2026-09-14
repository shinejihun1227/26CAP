import { escapeHtml as esc } from '../src/utils/text.js';

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
  let recordingId = null, jobId = null, busy = false, recording = false, analyzing = false;
  let timer;
  $('context').elements.session_id.value = `${new Intl.DateTimeFormat('sv-SE').format(new Date()).replaceAll('-', '')}_S01`;

  async function api(path = '', body) {
    const response = await fetch(`${API}${path}`, { method: body === undefined ? 'GET' : 'POST',
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(35000) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'AI 프로그램 연결을 확인하세요.');
    return result;
  }
  function controls() {
    for (const id of ['record-calibration', 'record-measurement']) $(id).disabled = busy || recording || analyzing;
    for (const id of ['validate', 'analyze']) $(id).disabled = busy || recording || analyzing;
    for (const input of $('context').elements) input.disabled = recording;
    $('record-stop').hidden = !recording;
    $('record-stop').disabled = busy;
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
    // Countdown from the server avoids different clocks on PC and phone.
    const clock = c.countdown_s === undefined ? Date.now() : c.starts_at_ms - c.countdown_s * 1000;
    $('capture-status').textContent = captureText(c, clock);
    $('capture-downloads').innerHTML = recording ? '' : links(c.id, [['recording.csv', '기록 CSV'], ['manifest.json', '기록 정보']]) + (c.status === 'complete' ? `<button type="button" class="secondary" data-use-record="${c.id}">${c.purpose === 'calibration' ? '보정' : '측정'} 파일로 연결</button>` : '');
    controls();
  }
  for (const purpose of ['calibration', 'measurement']) {
    $(`record-${purpose}`).addEventListener('click', () => action(async () => {
      const c = await api('/record/start', { ...context(), purpose, duration_s: Number($('duration').value) });
      recordingId = c.id; renderCapture(c); await history(); schedule();
    }));
  }
  $('record-stop').addEventListener('click', () => action(async () => {
    renderCapture(await api('/record/stop', { id: recordingId })); await history();
  }));
  async function useRecord(id) {
    if (recording || analyzing) throw new Error('진행 중인 작업을 마친 뒤 다른 기록을 연결하세요.');
    const c = await api(`/${id}`);
    if (c.kind !== 'recording' || c.status !== 'complete') throw new Error('완료된 기록만 분석에 연결할 수 있습니다.');
    const response = await fetch(`${API}/${id}/recording.csv`, { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error('CSV 기록을 불러오지 못했습니다.');
    selected[c.purpose] = { text: await readCsvFile(await response.blob()), id };
    $(`${c.purpose}-file`).value = '';
    $(`${c.purpose}-name`).textContent = `웹 기록 연결: ${c.metadata.session_id} · ${c.rows}행 · ${id.slice(0, 8)}`;
    for (const key of ['participant_id', 'session_id', 'side', 'placement']) $('context').elements[key].value = c.metadata[key];
    $('validation').textContent = '웹 기록을 연결했습니다. 나머지 파일을 선택하고 검사하세요.';
  }
  document.addEventListener('click', event => {
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
    const data = await api();
    if (data.active_recording) { recordingId = data.active_recording; recording = true; }
    if (data.active_job) { jobId = data.active_job; analyzing = true; }
    $('history').innerHTML = data.items.length ? data.items.map(item => `<div class="history-item"><div><b>${item.kind === 'analysis' ? 'CSV 모델 분석' : item.purpose === 'calibration' ? '보정 기록' : '측정 기록'} · ${esc(STATUSES[item.status] ?? item.status)}</b><p>${esc(item.metadata.participant_id)} · ${esc(item.metadata.session_id)} · ${item.metadata.side === 'left' ? '왼발' : '오른발'} · ${esc(item.metadata.placement)}<br />${esc(new Date(item.created_at_ms).toLocaleString())}</p></div><button class="secondary" type="button" data-view-job="${item.id}">보기</button></div>`).join('') : '<p>아직 저장된 작업이 없습니다.</p>';
    controls();
  }
  $('refresh-history').addEventListener('click', () => action(async () => { await history(); schedule(); }));
  function schedule() { clearTimeout(timer); timer = setTimeout(poll, 600); }
  async function poll() {
    try {
      let finished = false;
      if (recordingId && recording) { const c = await api(`/${recordingId}`); renderCapture(c); finished ||= !recording; }
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
