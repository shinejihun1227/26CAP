import { icon } from "../components/icons.js";
import { renderMetricCard } from "../components/metric-card.js";
import { renderTopbar } from "../components/topbar.js";
import { renderAiStatusCard } from "../components/ai-status-card.js";
import { renderAlgorithmSummary, renderSystemPipeline } from "../components/algorithm-summary.js";
import { observationGoals, riskLabel } from "../data/dashboard-data.js";
import { escapeHtml } from "../utils/text.js";

function renderEvent(event) {
  return `<li class="clarity-event-row"><span class="clarity-event-time">${event.time}</span><span class="clarity-event-icon event-${event.tone}">${icon(event.icon)}</span><span class="clarity-event-copy"><b>${event.title}</b><small>${event.detail}</small></span></li>`;
}

function display(value, digits = 1) {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed) ? parsed.toFixed(digits) : "--";
}

export function renderOverview(state) {
  const risk = Number.isFinite(Number(state.metrics.risk)) ? Math.round(Number(state.metrics.risk)) : 0;
  const status = riskLabel(risk);
  const name = escapeHtml(state.profile.name);
  const focus = escapeHtml((state.profile.goals ?? []).map((id) => observationGoals.find((goal) => goal.id === id)?.label).filter(Boolean).join(" · ") || "일상 보행 기록");
  const isEsp32 = state.dataSource === "esp32";
  const connectionTitle = isEsp32 ? (state.connected ? "ESP32 연결됨" : "ESP32 연결 확인 필요") : "로컬 시연 데이터";
  const connectionTone = isEsp32 && !state.connected ? "is-disconnected" : "";
  const balanceAvailable = state.metrics.balance !== null && state.metrics.balance !== undefined && Number.isFinite(Number(state.metrics.balance));
  const balance = balanceAvailable ? display(state.metrics.balance, 0) : "--";
  const nextTitle = status.tone === "mint" ? "현재 흐름을 유지하세요" : "실시간 신호를 먼저 확인하세요";
  const nextDescription = status.tone === "mint"
    ? "보행 리듬과 좌우 하중을 계속 관찰하고 있어요."
    : "변화가 감지되면 실시간 화면에서 원인을 확인할 수 있어요.";
  const events = (state.events ?? []).slice(0, 3);

  return `
    <div class="page-shell clarity-page">
      ${renderTopbar(state)}
      <main class="content-area clarity-content">
        <section class="clarity-page-intro">
          <div><span class="eyebrow">TODAY AT A GLANCE</span><h1>${name}님의 오늘 상태</h1><p>지금 꼭 필요한 정보만 간단히 보여드려요. <span class="clarity-focus">맞춤 관찰 · ${focus}</span></p></div>
          <div class="clarity-connection ${connectionTone}"><span class="status-dot"></span><div><b>${connectionTitle}</b><small>${isEsp32 ? "실제 센서 데이터" : "StepOn 시연 화면"} · ${state.device.lastSync}</small></div></div>
        </section>

        <section class="clarity-overview-hero">
          <article class="clarity-status-card">
            <div class="clarity-card-kicker">오늘의 보행 상태</div>
            <div class="clarity-status-main"><div><h2>${status.label}</h2><p>${status.tone === "mint" ? "현재까지 큰 변화 없이 안정적인 흐름을 보이고 있어요." : "보행 리듬이나 체중 이동의 변화를 조금 더 살펴볼게요."}</p><button class="clarity-primary-button" data-view="live">실시간 측정 보기 ${icon("arrow")}</button></div><div class="clarity-risk-score"><strong>${risk}</strong><span>주의 점수</span></div></div>
            <div class="clarity-status-meta"><span><i></i>${isEsp32 ? "실제 센서" : "시연 데이터"}</span><span>IMU 64Hz</span><span>${state.device.lastSync}</span></div>
          </article>
          <article class="clarity-next-card">
            <span class="clarity-card-kicker">지금 할 일</span>
            <div class="clarity-next-icon">${icon(status.tone === "mint" ? "check" : "cue")}</div>
            <h2>${nextTitle}</h2><p>${nextDescription}</p>
            <button class="clarity-link-button" data-view="safety">판단 근거 보기 ${icon("arrow")}</button>
          </article>
        </section>

        ${renderAiStatusCard(state)}
        ${renderAlgorithmSummary(state)}
        ${renderSystemPipeline(state, { compact: true })}

        <section class="clarity-section-heading"><div><span class="eyebrow">KEY NUMBERS</span><h2>오늘의 핵심 수치</h2></div><span>상세 신호는 실시간 측정에서 확인할 수 있어요.</span></section>
        <section class="metrics-grid clarity-metrics" aria-label="오늘의 핵심 수치">
          ${renderMetricCard({ label: "오늘 걸음 수", value: state.metrics.steps.toLocaleString("ko-KR"), unit: "steps", delta: "+12%", description: "어제보다 활발해요", tone: "coral", iconName: "activity" })}
          ${renderMetricCard({ label: "좌우 균형", value: balance, unit: balanceAvailable ? "%" : "", delta: balanceAvailable ? "측정됨" : "비교 대기", description: balanceAvailable ? "양발 하중 분배" : "오른발 센서 필요", tone: "mint", iconName: "shoe" })}
          ${renderMetricCard({ label: "발바닥 온도", value: display(state.metrics.temperature), unit: "°C", delta: "실시간", description: "SHTC3 평균값", tone: "lavender", iconName: "sun" })}
          ${renderMetricCard({ label: "보행 리듬", value: state.metrics.cadence, unit: "spm", delta: "관찰 중", description: "분당 걸음 수", tone: "sky", iconName: "activity" })}
        </section>

        <section class="clarity-lower-grid">
          <article class="panel clarity-events-card"><div class="panel-heading"><div><span class="panel-kicker">RECENT SIGNALS</span><h2>최근 알림</h2></div><button class="text-button" data-view="reports">전체 보기 ${icon("arrow")}</button></div><ul class="clarity-event-list">${events.map(renderEvent).join("")}</ul></article>
          <article class="panel clarity-how-card"><div class="panel-heading"><div><span class="panel-kicker">HOW TO READ</span><h2>이 화면 읽는 법</h2></div></div><div class="clarity-how-list"><div><span>01</span><p><b>오늘 상태</b><small>여러 센서 지표를 요약한 현재 관찰 상태입니다.</small></p></div><div><span>02</span><p><b>AI 보행동결</b><small>4초 신호 창을 분석한 연구용 보조 결과입니다.</small></p></div><div><span>03</span><p><b>핵심 수치</b><small>상세 센서값과 판단 과정은 각 메뉴에서 확인합니다.</small></p></div></div></article>
        </section>

        <p class="medical-disclaimer">StepOn은 보행 상태 관찰을 돕는 생활 보조 도구입니다. 표시되는 지표는 의료적 진단을 대신하지 않습니다.</p>
      </main>
    </div>
  `;
}
