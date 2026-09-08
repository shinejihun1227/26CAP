import { escapeHtml } from "../utils/text.js";

const STATUS_META = {
  normal: { label: "정상", tone: "mint", detail: "현재 보행동결 신호가 높지 않아요." },
  warning: { label: "주의", tone: "orange", detail: "보행동결 가능성을 관찰하고 있어요." },
  confirmed: { label: "FOG 감지", tone: "coral", detail: "연속 윈도우에서 보행동결 신호가 확인됐어요." },
  warming_up: { label: "AI 준비 중", tone: "sky", detail: "첫 4초 분석 창을 채우고 있어요." },
  device_offline: { label: "센서 연결 끊김", tone: "coral", detail: "ESP32와 AI 브리지 연결을 확인하세요." },
  unavailable: { label: "AI 연결 대기", tone: "lavender", detail: "AI 브리지 또는 캘리브레이션 파일이 필요해요." },
};

export function getAiStatusMeta(status) {
  return STATUS_META[status] ?? STATUS_META.unavailable;
}

function displayScore(score) {
  return score !== null && score !== undefined && Number.isFinite(Number(score))
    ? `${Math.round(Number(score) * 100)}`
    : "--";
}

export function renderAiStatusCard(state) {
  const ai = state.ai ?? {};
  const meta = getAiStatusMeta(ai.status);
  const hasScore = ai.score !== null && ai.score !== undefined && Number.isFinite(Number(ai.score));
  const score = hasScore ? Math.max(0, Math.min(1, Number(ai.score))) : null;
  const model = escapeHtml(ai.model ?? "ensemble");
  const detail = ai.lastError && meta.tone === "lavender" ? "AI 브리지 실행 후 이 화면을 새로고침하세요." : meta.detail;
  const connection = ai.available ? (ai.ready ? "실시간 추론 연결됨" : "브리지 연결됨 · 준비 필요") : "브리지 연결 안 됨";

  return `<article class="panel ai-status-panel">
    <div class="panel-heading"><div><span class="panel-kicker">AI FOG DETECTOR · ${model.toUpperCase()}</span><h2>AI 보행동결 탐지</h2></div><span class="algorithm-pill pill-${meta.tone}"><i></i>${meta.label}</span></div>
    <div class="ai-status-body">
      <div class="ai-score-block"><strong>${displayScore(score)}</strong><span>/ 100 FOG SCORE</span></div>
      <div class="ai-status-copy"><b>${detail}</b><p>${connection} · ${ai.windowSec ?? 4}초 창 · ${ai.hopSec ?? 0.5}초 간격</p><div class="ai-score-track"><i style="width:${score === null ? 0 : Math.round(score * 100)}%"></i></div></div>
    </div>
    <small class="algorithm-disclaimer">연구용 모델 결과이며 의료적 진단이 아닙니다. 센서 연결 전에는 기존 시연 데이터와 별도로 표시됩니다.</small>
  </article>`;
}
