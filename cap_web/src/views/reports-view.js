import { icon } from "../components/icons.js";
import { renderProgress } from "../components/charts.js";
import { renderTopbar } from "../components/topbar.js";
import { formatDateLabel } from "../utils/text.js";

export function renderReportsView(state) {
  const balanceAvailable = state.metrics.balance !== null && state.metrics.balance !== undefined && Number.isFinite(Number(state.metrics.balance));
  const balance = balanceAvailable ? Number(state.metrics.balance) : "--";
  const quality = state.dataSource === "esp32"
    ? (state.connected ? "실시간 연결됨" : "연결 끊김")
    : "시연 데이터";
  const today = new Date();
  const dateKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  const rehabLog = state.rehabLog?.[dateKey] ?? {};
  const rehabCount = (key) => rehabLog[key] ?? 0;
  return `<div class="page-shell">${renderTopbar(state)}<main class="content-area">
    <section class="subpage-heading"><div><span class="eyebrow">PERSONAL REPORT</span><h1>보행 리포트</h1><p>쌓인 데이터를 천천히 돌아보고 다음 걸음을 준비해요.</p></div><button class="control-button" data-action="download">${icon("report")} 리포트 저장</button></section>
    <section class="report-summary"><div class="report-summary-main"><span class="panel-kicker">${formatDateLabel()} · DAILY SUMMARY</span><h2>오늘은 <em>안정적인 걸음</em>이<br />가장 많았어요.</h2><p>총 ${state.metrics.steps.toLocaleString("ko-KR")}걸음 중 82%가 안정 구간으로 기록되었어요.</p></div><div class="report-score"><strong>82</strong><span>GAIT QUALITY</span><i>+6.8% vs yesterday</i></div></section>
    <section class="report-grid"><article class="panel report-card"><div class="panel-heading"><div><span class="panel-kicker">KEY INDICATORS</span><h2>주요 지표</h2></div></div><div class="report-progresses">${renderProgress("좌우 균형", balance, "mint", balanceAvailable ? "지난 기록보다 좋아졌어요" : "오른발 센서 연결 대기")}${renderProgress("안정 보행 구간", 82, "coral", "총 활동 시간 기준")}${renderProgress("센서 데이터 품질", state.dataSource === "esp32" && !state.connected ? 0 : 96, "sky", quality)}</div></article><article class="panel report-card"><div class="panel-heading"><div><span class="panel-kicker">WEEKLY NOTE</span><h2>이번 주 메모</h2></div>${icon("report")}</div><div class="note-list"><div><span>월</span><b>보폭이 평소보다 짧았어요</b><small>42cm · 관찰</small></div><div><span>화</span><b>좌우 균형이 좋아졌어요</b><small>82% · 안정</small></div><div><span>오늘</span><b>${balanceAvailable ? "현재 좋은 흐름을 유지 중이에요" : "오른발 센서를 연결해 주세요"}</b><small>${balanceAvailable ? `${balance}% · 안정` : "좌우 비교 대기"}</small></div></div></article></section>
    <section class="panel rehab-report-card"><div class="panel-heading"><div><span class="panel-kicker">REHABILITATION LOG · ${dateKey}</span><h2>오늘의 재활 기록</h2></div><span class="rehab-status-pill is-ready">${rehabCount("feedbackCount")}회 피드백</span></div><div class="rehab-report-grid"><div><strong>${rehabCount("steps")}</strong><span>걸음</span></div><div><strong>${rehabCount("loadLimitExceeded")}</strong><span>허용 하중 초과</span></div><div><strong>${rehabCount("asymmetry")}</strong><span>좌우 불균형</span></div><div><strong>${rehabCount("footDrag")}</strong><span>발 끌림 의심</span></div><div><strong>${rehabCount("heelLanding")}</strong><span>뒤꿈치 착지 부족</span></div><div><strong>${rehabCount("propulsion")}</strong><span>앞꿈치 추진 부족</span></div><div><strong>${rehabCount("lateralBias")}</strong><span>외측 쏠림</span></div><div><strong>${rehabCount("fatigue")}</strong><span>피로 알림</span></div></div><p class="rehab-report-last">${rehabLog.lastFeedback ? `최근 피드백 · ${rehabLog.lastFeedback}` : "오늘 기록된 확정 피드백이 없습니다."}</p></section>
    <p class="medical-disclaimer">리포트는 센서 데이터의 변화 추이를 보여주는 참고 자료입니다.</p>
  </main></div>`;
}
