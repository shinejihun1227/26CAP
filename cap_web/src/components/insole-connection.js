import { escapeHtml as esc } from '../utils/text.js';
const label = { left: '왼발', right: '오른발' };
const statusText = { online: '실센서 연결', unregistered: '자동 등록 대기', connecting: '응답 확인 중', stale: '센서 프레임 정지', error: '연결 확인 필요' };
function value(n, digits = 1) { return typeof n === 'number' && Number.isFinite(n) ? n.toFixed(digits) : '--'; }
function vector(v) { return ['x', 'y', 'z'].map((axis) => `${axis.toUpperCase()} ${value(v?.[axis], 2)}`).join(' · '); }

export function renderInsoleConnections(state, { configure = false } = {}) {
  const sta = state.hardware?.transport === 'sta';
  if (!sta && !configure) return '';
  if (!sta) return `<section class="panel insole-hub-panel"><h2>04번 STA 양발 연결</h2><p>노트북 핫스팟에 접속한 왼발·오른발을 실센서 모드에서 확인하세요. 시연값과 섞이지 않습니다.</p><button class="primary-button" data-action="connect-sta">STA 실센서 화면 열기</button></section>`;
  const active = state.rehab?.config?.activeFoot === 'right' ? 'right' : 'left';
  return `<section class="insole-hub-panel" aria-label="STA 양발 연결 상태"><div class="insole-hub-heading"><div><span class="eyebrow">STA ONLY · PC HOTSPOT</span><h2>왼발과 오른발 연결</h2><p>ESP32 → PC 자동 등록 · PC가 발별 /api/state 조회 · 웹은 PC의 최신 값을 표시</p></div><label>분석·출력 대상 <select data-rehab-setting="activeFoot" aria-label="분석 및 출력 대상 발"><option value="left" ${active === 'left' ? 'selected' : ''}>왼발</option><option value="right" ${active === 'right' ? 'selected' : ''}>오른발</option></select></label></div>
    <div class="insole-hub-grid">${['left', 'right'].map((side) => {
      const foot = state.hardware?.feet?.[side] ?? {}, online = foot.connected === true;
      const p = online ? foot.state : null;
      const thermal = p?.shtc3_ready?.filter(Boolean).length ?? 0;
      return `<article class="panel insole-card ${online ? 'is-online' : 'is-offline'}" data-insole-card="${side}"><header><h3>${label[side]} ESP32-C3</h3><span role="status">${statusText[foot.status] ?? '자동 등록 대기'}</span></header><p class="insole-address">${esc(foot.base_url || '아직 IP가 등록되지 않았습니다')}<br><small>${esc(foot.device_id || '장치 ID 대기')}${String(foot.device_id).startsWith('SIMULATED-') ? ' · 가상 검증 데이터 (실센서 아님)' : ''}</small></p>
        <dl><div><dt>IMU 읽기 / 목표</dt><dd>${value(p?.actual_sample_hz)} / 64 Hz</dd></div><div><dt>PC 새 프레임 수신</dt><dd>${value(foot.received_hz ?? 0)} Hz</dd></div><div><dt>마지막 새 프레임</dt><dd>${foot.age_ms == null ? '--' : `${value(foot.age_ms / 1000)}초 전`}</dd></div><div><dt>누락 프레임 / 재부팅</dt><dd>${foot.missed_frames ?? 0} / ${foot.restarts ?? 0}</dd></div></dl>
        <p class="insole-health">압력 ADC ${p?.pressure_ready ? '4채널' : '--'} · SHTC3 ${thermal}/4 · BMI270 ${p?.imu_ready ? '정상' : '대기'}</p>
        <p class="insole-vector">가속도(g) ${vector(p?.imu_ready ? p.accel : null)}<br>각속도(°/s) ${vector(p?.imu_ready ? p.gyro : null)}</p>
        ${foot.last_error ? `<p class="insole-error">${esc(foot.last_error)} · IP·좌우 설정·전원 확인</p>` : ''}
        ${configure ? `<details><summary>IP 직접 등록 / 기기 교체</summary><form data-insole-form="${side}"><label>${label[side]} ESP32 주소<input name="url" type="url" required placeholder="http://192.168.x.x" value="${esc(foot.base_url || '')}" autocomplete="off"></label><button type="submit" class="outline-button">주소 등록</button></form><button type="button" class="text-button" data-action="forget-${side}">이 발의 등록 해제</button><small>보드 교체 시 등록을 해제하세요. 켜진 보드는 약 5초마다 다시 자동 등록합니다.</small></details>` : ''}</article>`;
    }).join('')}</div>
    <p class="insole-hub-note">${state.hardware?.lastError ? `PC 수집 서버: ${esc(state.hardware.lastError)} · run.bat으로 서버를 다시 시작하세요. ` : ''}64Hz는 목표 주기이며 실제 읽기·수신 속도는 위 수치로 확인합니다. 연결이 끊기거나 프레임이 2초 동안 멈추면 해당 발의 값을 숨깁니다. 좌우 시각은 정밀 동기화가 아닌 PC 수신 기준입니다.</p>
    ${configure ? '<p class="insole-hub-note">자동 등록이 안 되면 시리얼의 STA IP를 입력하세요. PC는 run.bat 실행 및 TCP 8000 접근 허용이 필요합니다. Wi-Fi 비밀번호는 웹에서 수집하거나 저장하지 않습니다.</p>' : ''}</section>`;
}
