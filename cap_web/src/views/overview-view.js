import { icon } from '../components/icons.js';
import { renderMetricCard } from '../components/metric-card.js';
import { renderTopbar } from '../components/topbar.js';
import { renderAiStatusCard } from '../components/ai-status-card.js';
import { renderSystemPipeline } from '../components/algorithm-summary.js';
import { connectionSummary } from '../components/connection-summary.js';
import { analyzeThermalDifference } from '../data/gait-algorithms.js';
import { riskLabel } from '../data/dashboard-data.js';
import { escapeHtml as esc } from '../utils/text.js';

const finite = (value) => typeof value === 'number' && Number.isFinite(value);
const display = (value, digits = 1) => finite(value) ? value.toFixed(digits) : '—';

export function overviewPresentation(state) {
  const connection = connectionSummary(state);
  const usable = !state.paused && connection.activeConnected;
  const risk = usable && finite(state.metrics?.risk) ? Math.round(state.metrics.risk) : null;
  const observation = riskLabel(risk);
  let title = observation.label;
  let description = '';
  let action = '실시간 측정 보기', view = 'live';
  if (state.paused) {
    title = '화면 갱신이 멈춰 있어요';
    description = '다시 시작하면 최신 센서값을 확인할 수 있어요.';
    action = '화면 갱신 재개';
  } else if (!connection.real) {
    title = '시연 화면을 둘러보세요';
    description = '아래 수치는 사용법을 살펴보기 위한 예시이며, 실제 측정값이 아닙니다.';
  } else if (!connection.count) {
    title = '깔창 연결을 기다리고 있어요';
    description = '깔창의 전원과 Wi-Fi 연결을 확인해 주세요. 데이터가 들어오면 수치가 표시됩니다.';
    action = '기기 연결 확인'; view = 'devices';
  } else if (!connection.activeConnected) {
    title = `${connection.activeLabel} 연결을 기다리고 있어요`;
    description = '반대쪽 깔창은 연결됐어요. 기기 관리에서 연결 상태와 분석할 발을 확인해 주세요.';
    action = '연결된 발 확인'; view = 'devices';
  } else if (risk === null) {
    title = '센서 측정을 준비하고 있어요';
    description = '깔창은 연결됐지만 보행 상태를 판단할 센서값이 아직 부족해요.';
  } else {
    description = observation.tone === 'mint'
      ? '현재 센서 규칙에서 큰 변화가 감지되지 않았어요.'
      : '보행 신호에 변화가 있어요. 실시간 화면에서 압력과 움직임을 확인해 주세요.';
  }
  return { connection, usable, risk, title, description, action, view };
}

function renderEvent(event) {
  const tone = ['mint', 'coral', 'lavender', 'orange', 'sky'].includes(event.tone) ? event.tone : 'sky';
  return `<li class="clarity-event-row"><time class="clarity-event-time">${esc(event.time ?? '')}</time><span class="clarity-event-icon event-${tone}">${icon(event.icon)}</span><span class="clarity-event-copy"><b>${esc(event.title ?? '')}</b><small>${esc(event.detail ?? '')}</small></span></li>`;
}

function renderFootStatus(state, connection) {
  if (!connection.sta) return `<span>${connection.real ? '깔창 센서' : '실제 측정 아님'}</span>`;
  return ['left', 'right'].map((side) => {
    const online = state.hardware.feet?.[side]?.connected === true;
    return `<span class="overview-foot ${online ? 'is-online' : 'is-waiting'}"><i aria-hidden="true"></i><span data-live-copy>${side === 'left' ? '왼발' : '오른발'} · ${state.paused ? '갱신 정지' : online ? '연결됨' : '대기'}</span></span>`;
  }).join('');
}

function renderObservations(state, presentation) {
  const { connection, usable } = presentation;
  const rehab = state.rehab ?? {};
  const calibrated = rehab.calibration?.status === 'ready';
  const ruleReady = usable && calibrated && (!connection.real || (state.hardware?.sensors?.pressure?.ready && state.hardware?.sensors?.imu?.ready));
  const alerts = ruleReady ? rehab.alerts?.length ?? 0 : 0;
  const ruleLabel = state.paused ? '일시정지' : !usable ? '측정 대기' : !calibrated ? '개인 기준 필요' : !ruleReady ? '센서값 대기' : alerts ? `변화 ${alerts}건` : '새 알림 없음';
  const thermal = analyzeThermalDifference(state.paused || (connection.real && !state.connected) ? {} : state.thermal);
  const thermalReady = finite(thermal.meanTemperatureDelta);
  const thermalValue = state.paused ? '화면 갱신 정지' : thermalReady ? `${display(thermal.meanTemperatureDelta)}°C 차이` : '양발 센서 필요';
  return `<section class="overview-insights" aria-label="분석별 상태">
    <article class="overview-insight" data-insight="gait"><div class="overview-insight-heading"><h3>보행 규칙 관찰</h3><span class="overview-badge ${alerts ? 'tone-orange' : 'tone-sky'}">센서 기반</span></div><div class="overview-insight-value" data-live-copy>${ruleLabel}</div><p>${ruleReady ? '압력 이동과 발의 움직임을 개인 기준과 비교해요.' : '개인 기준을 저장하면 하중·착지·발 들림의 변화를 살펴볼 수 있어요.'}</p><button class="text-button" data-view="live">측정과 기준 설정 <span aria-hidden="true">→</span></button></article>
    <article class="overview-insight" data-insight="thermal"><div class="overview-insight-heading"><h3>양발 온도 비교</h3><span class="overview-badge tone-${thermalReady ? thermal.stageTone : 'sky'}" data-live-copy>${state.paused ? '일시정지' : thermalReady ? thermal.stageLabel : '비교 대기'}</span></div><div class="overview-insight-value" data-live-copy>${thermalValue}</div><p>${state.paused ? '갱신을 재개하면 최신 온도 차이를 확인할 수 있어요.' : thermalReady ? '같은 부위의 평균 온도 차이예요. 습도 차이도 함께 확인할 수 있어요.' : '양발의 같은 부위에서 값이 들어와야 비교할 수 있어요.'}</p><button class="text-button" data-view="safety">부위별 차이 보기 <span aria-hidden="true">→</span></button></article>
  </section>`;
}

export function renderOverview(state, { embedded = false } = {}) {
  const presentation = overviewPresentation(state);
  const { connection, usable, risk, title, description, action, view } = presentation;
  const metrics = state.metrics ?? {};
  const anyData = !state.paused && (!connection.real || state.connected);
  const steps = usable && finite(metrics.steps) ? Math.max(0, Math.round(metrics.steps)).toLocaleString('ko-KR') : '—';
  const balance = anyData && finite(metrics.balance) ? metrics.balance : null;
  const temperature = anyData ? metrics.temperature : null;
  const humidity = anyData ? metrics.humidity : null;
  const events = (state.events ?? []).slice(0, 3);
  const greeting = state.profile?.configured ? `${esc(state.profile.name)}님의 보행과 발 상태를 살펴보세요.` : '연결 상태와 주요 측정값을 한눈에 확인하세요.';

  return `${embedded ? "" : `<div class="page-shell clarity-page overview-page">
    ${renderTopbar(state)}
    <main id="overview-content" class="content-area clarity-content overview-content">`}
      <section class="clarity-page-intro overview-intro"><div><h1>오늘 요약</h1><p>${greeting}</p></div><span class="overview-source ${connection.real ? '' : 'is-demo'}">${connection.real ? '실제 센서 모드' : '시연 모드 · 예시 수치'}</span></section>
      <section class="clarity-overview-hero" aria-label="현재 상태와 시작 안내">
        <article class="clarity-status-card">
          <span class="clarity-card-kicker">지금의 보행 상태</span>
          <div class="clarity-status-main"><div><h2 data-live-copy>${title}</h2><p data-live-copy>${description}</p><button class="clarity-primary-button" ${state.paused ? 'data-action="toggle-pause"' : `data-view="${view}"`}><span data-live-copy>${action}</span>${icon('arrow')}</button></div><div class="simple-status-symbol" aria-hidden="true">${icon(connection.count ? "shoe" : "device")}</div></div>
          <div class="clarity-status-meta">${renderFootStatus(state, connection)}<span>${connection.real ? `${connection.activeLabel} 기준 · 센서 규칙` : '시연용 점수'}</span></div>
        </article>
        <aside class="overview-ai-summary">${renderAiStatusCard(state, { compact: true })}<button class="simple-secondary" data-view="mediapipe">카메라로 관절 측정 →</button></aside>
      </section>
      <section class="clarity-section-heading overview-section-heading"><h2>핵심 측정값</h2><span>${connection.real ? '현재 수신 중인 세션 기준' : '시연 데이터'} · 미수신은 — 표시</span></section>
      <section class="metrics-grid clarity-metrics" aria-label="핵심 측정값">
        ${renderMetricCard({ label: connection.real ? '이번 측정 걸음 수' : '시연 걸음 수', value: steps, unit: '걸음', delta: state.paused ? '일시정지' : usable ? '관찰값' : '측정 대기', description: '화면 수신 기반 참고값', tone: 'coral', iconName: 'activity' })}
        ${renderMetricCard({ label: '좌우 하중 균형', value: display(balance, 0), unit: '점', delta: finite(balance) ? '100점 기준' : '양발 비교 대기', description: '좌우가 비슷할수록 높아요', tone: 'mint', iconName: 'shoe' })}
        ${renderMetricCard({ label: '깔창 평균 온도', value: display(temperature), unit: '°C', delta: finite(temperature) ? '수신 부위 평균' : '센서값 대기', description: '연결된 온도센서 기준', tone: 'lavender', iconName: 'sun' })}
        ${renderMetricCard({ label: '깔창 평균 습도', value: display(humidity, 0), unit: '%', delta: finite(humidity) ? '상대습도' : '센서값 대기', description: '신발 안의 습한 정도', tone: 'sky', iconName: 'sun' })}
      </section>
      <details class="simple-details overview-more" data-ui-disclosure="overview-observations"><summary>AI 분석 · 발 상태 · 최근 알림 자세히 보기</summary><section class="clarity-section-heading overview-section-heading"><h2>분석 상태</h2><button class="text-button" data-view="safety">전체 분석 보기 ${icon('arrow')}</button></section>
      ${renderObservations(state, presentation)}
      <section class="overview-bottom-grid">
        <article class="panel clarity-events-card"><div class="panel-heading"><h2>최근 기록</h2><button class="text-button" data-view="trends">지난 기록 보기 ${icon('arrow')}</button></div>${events.length ? `<ul class="clarity-event-list">${events.map(renderEvent).join('')}</ul>` : '<div class="overview-empty"><b>아직 기록된 변화가 없어요</b><p>측정 중 상태 변화가 기록되면 여기에 표시됩니다.</p></div>'}</article>
        <article class="panel overview-camera-link"><span class="overview-small-icon">${icon('camera')}</span><div><h2>관절 움직임도 기록해 보세요</h2><p>노트북 카메라로 정면·측면의 움직임을 측정하고, 이전 기록과 비교할 수 있어요.</p><button class="text-button" data-view="mediapipe">관절 측정 열기 ${icon('arrow')}</button><small>카메라는 직접 시작할 때만 켜집니다.</small></div></article>
      </section>
      </details>
      <details class="overview-details" data-ui-disclosure="overview-guide"><summary><span><b>점수와 용어가 궁금한가요?</b><small>판단 기준 · 데이터 처리 과정</small></span>${icon('chevron')}</summary><div class="overview-details-content">
        <p>센서 규칙 관찰 점수: ${risk ?? "—"} / 100 · AI 모델 점수와 별개입니다.</p><dl class="overview-glossary"><div><dt>관찰 점수와 AI 점수</dt><dd>관찰 점수는 센서 규칙의 참고값, AI 점수는 별도 모델의 출력입니다. 질환 확률이나 의료 진단이 아닙니다.</dd></div><div><dt>좌우 하중 균형</dt><dd>양발의 상대 압력을 비교합니다. 100점에 가까울수록 좌우가 비슷하며, 실제 체중 비율을 뜻하지는 않습니다.</dd></div><div><dt>보행동결(FoG)과 개인 기준</dt><dd>보행동결은 걸으려 해도 발을 떼기 어려운 현상입니다. 개인 기준은 본인의 측정값으로 만든 비교 기준이며 카메라 관절 측정과는 별도로 관리됩니다.</dd></div></dl>
        ${renderSystemPipeline(state, { compact: true })}
      </div></details>
      <p class="medical-disclaimer">StepOn의 측정값과 분석은 관찰용 참고 정보이며, 의료적 진단이나 치료 효과를 보장하지 않습니다.</p>
    ${embedded ? "" : `</main>
  </div>`}`;
}
