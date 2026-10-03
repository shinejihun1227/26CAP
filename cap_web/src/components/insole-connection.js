import { escapeHtml as esc } from '../utils/text.js';
const label = { left: '왼발', right: '오른발' };
const statusText = { online: '실센서 연결', unregistered: '자동 등록 대기', connecting: '응답 확인 중', stale: '센서 프레임 정지', error: '연결 확인 필요' };
function value(n, digits = 1) { return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '--'; }
function vector(v) { return ['x', 'y', 'z'].map((axis) => `${axis.toUpperCase()} ${value(v?.[axis], 2)}`).join(' · '); }
function connectionError(error, side) {
  if (error === 'foot_side_mismatch') return `보드의 좌우 설정이 다릅니다. ${label[side]} 보드는 STEPON_RIGHT_FOOT=${side === 'right' ? 1 : 0}으로 업로드하세요.`;
  if (error === 'sta_firmware_required') return '펌웨어 정보를 확인하지 못했습니다. 지원 버전은 04 / 4-2 / 4-3 STA입니다. 4-3을 올렸다면 최신 웹 서버인지 먼저 확인하세요.';
  if (error === 'device_timeout') return '기기 응답이 없습니다. 보드의 전원·Wi-Fi와 시리얼 모니터의 현재 IP를 확인하세요.';
  if (error === 'device_id_mismatch') return '등록된 보드와 다른 기기입니다. 새 보드로 교체했다면 현재 IP를 다시 등록하세요.';
  if (error === 'direct_pressure_pins_mismatch') return '4-3 압력 입력 설정이 맞지 않습니다. ADC1 직접 입력과 서로 다른 GPIO 4개 설정을 확인하세요.';
  return `${error} · IP·좌우 설정·전원 확인`;
}

export function renderInsoleConnections(state, { configure = false } = {}) {
  const sta = state.hardware?.transport === 'sta';
  if (!sta && !configure) return '';
  if (!sta) return `<section class="panel insole-hub-panel"><h2>04 / 4-2 / 4-3 STA 양발 연결</h2><p>노트북과 왼발·오른발을 같은 휴대폰 핫스팟 또는 Wi-Fi에 연결한 뒤 실센서 모드에서 확인하세요.</p><button class="primary-button" data-action="connect-sta">STA 실센서 화면 열기</button></section>`;
  const active = state.rehab?.config?.activeFoot === 'right' ? 'right' : 'left';
  return `<section class="insole-hub-panel" aria-label="STA 양발 연결 상태"><div class="insole-hub-heading"><div><span class="eyebrow">STA · SHARED WI-FI</span><h2>왼발과 오른발 연결</h2><p>같은 Wi-Fi로 연결 · ESP32 → 노트북 자동 등록 · 노트북에서 센서 수집과 AI 처리</p></div><label data-insole-controls>분석·출력 대상 <select data-rehab-setting="activeFoot" aria-label="분석 및 출력 대상 발"><option value="left" ${active === 'left' ? 'selected' : ''}>왼발</option><option value="right" ${active === 'right' ? 'selected' : ''}>오른발</option></select></label></div>
    <div class="insole-hub-grid">${['left', 'right'].map((side) => {
      const foot = state.hardware?.feet?.[side] ?? {}, online = foot.connected === true;
      const p = online ? foot.state : null;
      const thermalTotal = foot.state?.thermal_physical_count === 2 ? 2 : 4;
      const thermal = new Set((p?.shtc3_ready ?? []).flatMap((ready, index) => ready ? [p.thermal_sensor_map?.[index] ?? index] : [])).size;
      return `<article class="panel insole-card ${online ? 'is-online' : 'is-offline'}" data-insole-card="${side}"><div data-insole-readings><header><h3>${label[side]} ESP32</h3><span role="status">${statusText[foot.status] ?? '자동 등록 대기'}</span></header><p class="insole-address">${esc(foot.base_url || '아직 IP가 등록되지 않았습니다')}<br><small>${esc(foot.device_id || '장치 ID 대기')}${String(foot.device_id).startsWith('SIMULATED-') ? ' · 가상 검증 데이터 (실센서 아님)' : ''}</small></p>
        <dl><div><dt>ESP32 IMU 읽기 / 목표</dt><dd>${value(p?.actual_sample_hz)} / 64 Hz</dd></div><div><dt>PC 실제 수신</dt><dd>${value(foot.received_hz ?? 0)} Hz</dd></div><div><dt>마지막 새 프레임</dt><dd>${foot.age_ms == null ? '--' : `${value(foot.age_ms / 1000)}초 전`}</dd></div><div><dt>누락 프레임 / 재부팅</dt><dd>${foot.missed_frames ?? 0} / ${foot.restarts ?? 0}</dd></div></dl>
        <p class="insole-health">압력 ADC ${p?.pressure_ready ? '4채널' : '--'} · SHTC3 실측 ${thermal}/${thermalTotal} · BMI270 ${p?.imu_ready ? '정상' : '대기'}</p>
        <p class="insole-vector">가속도(g) ${vector(p?.imu_ready ? p.accel : null)}<br>각속도(°/s) ${vector(p?.imu_ready ? p.gyro : null)}</p>
        ${foot.last_error ? `<p class="insole-error">${esc(connectionError(foot.last_error, side))}</p>` : ''}</div>
        ${configure ? `<details data-insole-controls><summary>IP 직접 등록 / 기기 교체</summary><form data-insole-form="${side}"><label>${label[side]} ESP32 주소<input name="url" type="url" required placeholder="http://192.168.x.x" value="${esc(foot.base_url || '')}" autocomplete="off"></label><button type="submit" class="outline-button">주소 등록</button></form><button type="button" class="text-button" data-action="forget-${side}">이 발의 등록 해제</button><small>보드 교체 시 등록을 해제하세요. 켜진 보드는 약 5초마다 다시 자동 등록합니다.</small></details>` : ''}</article>`;
    }).join('')}</div>
    <p class="insole-hub-note" data-insole-live-note>${state.hardware?.lastError ? `PC 수집 서버: ${esc(state.hardware.lastError)} · run.bat으로 서버를 다시 시작하세요. ` : ''}64Hz는 ESP32 IMU 읽기의 펌웨어 목표입니다. PC 수신 속도는 Wi-Fi 상태에 따라 낮아질 수 있습니다. AI 브리지는 유효한 센서값을 20Hz 입력으로 맞춰 모델에 전달하므로 PC 수신이 64Hz일 필요는 없습니다. 연결이 끊기거나 프레임이 2초 동안 멈추면 해당 발의 값을 숨깁니다.</p>
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
