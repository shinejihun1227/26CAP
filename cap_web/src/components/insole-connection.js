import { escapeHtml as esc } from '../utils/text.js';
const label = { left: '왼발', right: '오른발' };
const statusText = { online: '실센서 연결', unregistered: '자동 등록 대기', connecting: '응답 확인 중', stale: '센서 프레임 정지', error: '연결 확인 필요' };
function value(n, digits = 1) { return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '--'; }
function vector(v) { return ['x', 'y', 'z'].map((axis) => `${axis.toUpperCase()} ${value(v?.[axis], 2)}`).join(' · '); }
function connectionError(error, side) {
  if (error === 'foot_side_mismatch') return `보드의 좌우 설정이 다릅니다. ${label[side]} 보드는 STEPON_RIGHT_FOOT=${side === 'right' ? 1 : 0}으로 업로드하세요.`;
  if (error === 'sta_firmware_required') return '웹 연결용 04 또는 4-2 STA 펌웨어를 업로드하세요.';
  return `${error} · IP·좌우 설정·전원 확인`;
}

export function renderInsoleConnections(state, { configure = false } = {}) {
  const sta = state.hardware?.transport === 'sta';
  if (!sta && !configure) return '';
  if (!sta) return `<section class="panel insole-hub-panel"><h2>04 / 4-2 STA 양발 연결</h2><p>노트북과 왼발·오른발을 같은 휴대폰 핫스팟 또는 Wi-Fi에 연결한 뒤 실센서 모드에서 확인하세요.</p><button class="primary-button" data-action="connect-sta">STA 실센서 화면 열기</button></section>`;
  const active = state.rehab?.config?.activeFoot === 'right' ? 'right' : 'left';
  return `<section class="insole-hub-panel" aria-label="STA 양발 연결 상태"><div class="insole-hub-heading"><div><span class="eyebrow">STA · SHARED WI-FI</span><h2>왼발과 오른발 연결</h2><p>같은 Wi-Fi로 연결 · ESP32 → 노트북 자동 등록 · 노트북에서 센서 수집과 AI 처리</p></div><label data-insole-controls>분석·출력 대상 <select data-rehab-setting="activeFoot" aria-label="분석 및 출력 대상 발"><option value="left" ${active === 'left' ? 'selected' : ''}>왼발</option><option value="right" ${active === 'right' ? 'selected' : ''}>오른발</option></select></label></div>
    <div class="insole-hub-grid">${['left', 'right'].map((side) => {
      const foot = state.hardware?.feet?.[side] ?? {}, online = foot.connected === true;
      const p = online ? foot.state : null;
      const thermal = p?.shtc3_ready?.filter(Boolean).length ?? 0;
      return `<article class="panel insole-card ${online ? 'is-online' : 'is-offline'}" data-insole-card="${side}"><div data-insole-readings><header><h3>${label[side]} ESP32</h3><span role="status">${statusText[foot.status] ?? '자동 등록 대기'}</span></header><p class="insole-address">${esc(foot.base_url || '아직 IP가 등록되지 않았습니다')}<br><small>${esc(foot.device_id || '장치 ID 대기')}${String(foot.device_id).startsWith('SIMULATED-') ? ' · 가상 검증 데이터 (실센서 아님)' : ''}</small></p>
        <dl><div><dt>IMU 읽기 / 목표</dt><dd>${value(p?.actual_sample_hz)} / 64 Hz</dd></div><div><dt>PC 새 프레임 수신</dt><dd>${value(foot.received_hz ?? 0)} Hz</dd></div><div><dt>마지막 새 프레임</dt><dd>${foot.age_ms == null ? '--' : `${value(foot.age_ms / 1000)}초 전`}</dd></div><div><dt>누락 프레임 / 재부팅</dt><dd>${foot.missed_frames ?? 0} / ${foot.restarts ?? 0}</dd></div></dl>
        <p class="insole-health">압력 ADC ${p?.pressure_ready ? '4채널' : '--'} · SHTC3 ${thermal}/4 · BMI270 ${p?.imu_ready ? '정상' : '대기'}</p>
        <p class="insole-vector">가속도(g) ${vector(p?.imu_ready ? p.accel : null)}<br>각속도(°/s) ${vector(p?.imu_ready ? p.gyro : null)}</p>
        ${foot.last_error ? `<p class="insole-error">${esc(connectionError(foot.last_error, side))}</p>` : ''}</div>
        ${configure ? `<details data-insole-controls><summary>IP 직접 등록 / 기기 교체</summary><form data-insole-form="${side}"><label>${label[side]} ESP32 주소<input name="url" type="url" required placeholder="http://192.168.x.x" value="${esc(foot.base_url || '')}" autocomplete="off"></label><button type="submit" class="outline-button">주소 등록</button></form><button type="button" class="text-button" data-action="forget-${side}">이 발의 등록 해제</button><small>보드 교체 시 등록을 해제하세요. 켜진 보드는 약 5초마다 다시 자동 등록합니다.</small></details>` : ''}</article>`;
    }).join('')}</div>
    <p class="insole-hub-note" data-insole-live-note>${state.hardware?.lastError ? `PC 수집 서버: ${esc(state.hardware.lastError)} · run.bat으로 서버를 다시 시작하세요. ` : ''}64Hz는 목표 주기이며 실제 읽기·수신 속도는 위 수치로 확인합니다. 연결이 끊기거나 프레임이 2초 동안 멈추면 해당 발의 값을 숨깁니다. 좌우 시각은 정밀 동기화가 아닌 PC 수신 기준입니다.</p>
    ${configure ? '<p class="insole-hub-note">핫스팟에 2대가 접속해도 각 보드를 왼발(0)·오른발(1)로 구분해 업로드해야 합니다. 위의 분석 대상 선택은 보드의 좌우 설정을 바꾸지 않습니다. 자동 등록이 안 되면 각 보드 시리얼의 STA IP를 해당 발에 입력하세요. PC는 run.bat 실행 및 TCP 8000 접근 허용이 필요합니다. Wi-Fi 비밀번호는 웹에서 수집하거나 저장하지 않습니다.</p>' : ''}</section>`;
}

// Refresh live readings without removing the focused select, input or disclosure.
export function updateInsoleReadings(root, state) {
  const panel = root.querySelector('.insole-hub-panel');
  if (!panel || state.hardware?.transport !== 'sta') return;
  const template = root.ownerDocument.createElement('template');
  template.innerHTML = renderInsoleConnections(state);
  for (const card of panel.querySelectorAll('[data-insole-card]')) {
    const next = template.content.querySelector(`[data-insole-card="${card.dataset.insoleCard}"]`);
    if (!next) continue;
    card.className = next.className;
    card.querySelector('[data-insole-readings]')?.replaceWith(next.querySelector('[data-insole-readings]'));
  }
  panel.querySelector('[data-insole-live-note]')?.replaceWith(template.content.querySelector('[data-insole-live-note]'));
}
