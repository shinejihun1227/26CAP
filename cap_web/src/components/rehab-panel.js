import { icon } from "./icons.js";
import { escapeHtml } from "../utils/text.js";

function display(value, digits = 0, suffix = "") {
  const parsed = Number(value);
  return value !== null && value !== undefined && Number.isFinite(parsed)
    ? `${parsed.toFixed(digits)}${suffix}`
    : `--${suffix}`;
}

function metric(label, value, detail = "") {
  return `<div class="rehab-metric"><span>${label}</span><strong>${value}</strong>${detail ? `<small>${detail}</small>` : ""}</div>`;
}

function sideLabel(side) {
  return side === "left" ? "왼발" : "오른발";
}

function renderFeedback(feedback) {
  if (!feedback) {
    return `<div class="rehab-feedback"><span class="rehab-feedback-icon">${icon("check")}</span><div><b>현재 확정된 교정 알림이 없습니다.</b><small>최근 5회 관찰에서 같은 이상이 3회 이상 반복될 때 진동과 안내를 시작합니다.</small></div></div>`;
  }
  return `<div class="rehab-feedback is-alert"><span class="rehab-feedback-icon">${icon("alert")}</span><div><b>${escapeHtml(feedback.title)}</b><p>${escapeHtml(feedback.message)}</p><small>${escapeHtml(feedback.correction)}</small></div><span class="rehab-cue-count">진동 ${feedback.vibrationCount ?? 1}회</span></div>`;
}

function renderCop(cop) {
  const x = Number(cop?.x);
  const y = Number(cop?.y);
  const available = Number.isFinite(x) && Number.isFinite(y);
  const left = available ? Math.max(4, Math.min(96, (x + 1) * 50)) : 50;
  const top = available ? Math.max(4, Math.min(96, (1 - y) * 50)) : 50;
  return `<div class="rehab-cop-surface"><span class="rehab-cop-axis-x"></span><span class="rehab-cop-axis-y"></span><span class="rehab-cop-target"></span><span class="rehab-cop-point ${available ? "is-live" : ""}" style="left:${left}%;top:${top}%"></span><span class="rehab-cop-empty">${available ? "" : "CoP 대기"}</span></div>`;
}

export function renderRehabPanel(state, { compact = false } = {}) {
  const rehab = state.rehab ?? {};
  const config = rehab.config ?? {};
  const metrics = rehab.metrics ?? {};
  const activeFoot = config.activeFoot === "left" ? "left" : "right";
  const activeLabel = sideLabel(activeFoot);
  const isReal = state.dataSource === "esp32";
  const bilateral = Boolean(metrics.bilateralAvailable);
  const statusLabel = rehab.status === "ready" ? "기준선 준비됨" : "기준선 생성 필요";
  const statusTone = rehab.status === "ready" ? "is-ready" : "is-warn";
  const sourceLabel = isReal ? (state.connected ? "ESP32 실센서" : "ESP32 연결 대기") : "로컬 시연 데이터";
  const alerts = rehab.alerts ?? [];
  const leftLoad = display(metrics.leftLoadPct, 0, "%");
  const rightLoad = display(metrics.rightLoadPct, 0, "%");
  const supportLeft = display(metrics.supportTimeLeftMs, 0, "ms");
  const supportRight = display(metrics.supportTimeRightMs, 0, "ms");
  const activeCop = metrics.cop?.active;

  return `<article class="panel rehab-panel ${compact ? "is-compact" : ""}">
    <div class="panel-heading rehab-panel-heading"><div><span class="panel-kicker">REHABILITATION MODE</span><h2>보행 교정 알고리즘</h2><p class="rehab-source">${sourceLabel} · ${bilateral ? "양발 비교 가능" : "양발 데이터 필요"} · ${metrics.loadScaleReady ? "체중 환산 기준선 있음" : "체중 환산은 기준선 필요"}</p></div><span class="rehab-status-pill ${statusTone}">${statusLabel}</span></div>
    <div class="rehab-settings">
      <label class="rehab-setting"><span>재활할 발</span><select data-rehab-setting="activeFoot"><option value="left" ${activeFoot === "left" ? "selected" : ""}>왼발</option><option value="right" ${activeFoot === "right" ? "selected" : ""}>오른발</option></select></label>
      <label class="rehab-setting"><span>허용 하중 (% 체중)</span><input data-rehab-setting="allowedLoadPct" type="number" min="1" max="100" value="${config.allowedLoadPct ?? 50}" /></label>
      <label class="rehab-setting"><span>사용자 체중 (kg)</span><input data-rehab-setting="weightKg" type="number" min="1" max="250" value="${config.weightKg ?? 68}" /></label>
      <label class="rehab-setting"><span>좌우 허용 차이 (%)</span><input data-rehab-setting="asymmetryTolerancePct" type="number" min="1" max="50" value="${config.asymmetryTolerancePct ?? 15}" /></label>
      <label class="rehab-setting"><span>진동 세기 (%)</span><input data-rehab-setting="vibrationStrength" type="number" min="0" max="100" value="${config.vibrationStrength ?? 60}" /></label>
    </div>
    ${renderFeedback(rehab.feedback)}
    <div class="rehab-metrics-grid">
      ${metric("왼발 하중", leftLoad, bilateral ? "현재 비율" : "비교 대기")}
      ${metric("오른발 하중", rightLoad, bilateral ? "현재 비율" : "비교 대기")}
      ${metric("지지시간", `${supportLeft} / ${supportRight}`, "왼발 / 오른발")}
      ${metric("하중 차이", display(metrics.loadDifferencePct, 0, "%"), `허용 ${config.asymmetryTolerancePct ?? 15}%`)}
      ${metric("뒤꿈치 착지", display(metrics.heelLanding?.active, 0, "%"), `${activeLabel} 기준`)}
      ${metric("앞꿈치 추진", display(metrics.propulsion?.active, 0, "%"), `${activeLabel} 기준`)}
      ${metric("발 들림 지표", display(metrics.footLift?.active, 0, "%"), `${activeLabel} IMU`)}
      ${metric("외측 하중", display(metrics.lateralLoad?.active, 0, "%"), "P4·P5·P7")}
      ${metric("활성 발 압력", display(metrics.activeTotal, 1), `${activeLabel} · raw 합산`)}
      ${metric("활성 발 체중 환산", display(metrics.activeLoadPct, 0, "%"), metrics.loadScaleReady ? "양발 기준선 환산" : "양발 기준선 필요")}
      ${metric("CoP 위치", activeCop ? `${display(activeCop.x, 2)} / ${display(activeCop.y, 2)}` : "--", "좌우 / 앞뒤")}
      ${metric("반복 경고", `${alerts.length}건`, `관찰 ${metrics.observationCount ?? 0}회`)}
      ${metric("피로 지표", `${metrics.fatigueScore ?? 0}/4`, metrics.fatigue?.active ? "휴식 권장" : "관찰 중")}
    </div>
    <div class="rehab-cop-card"><div class="rehab-cop-copy"><span class="panel-kicker">CENTER OF PRESSURE</span><h3>압력중심(CoP)</h3><p>목표점에 가까워질수록 발바닥 전체를 안정적으로 사용하고 있는 상태입니다.</p><small>${activeCop ? `${activeLabel} 현재 ${display(activeCop.x, 2)} / ${display(activeCop.y, 2)}` : `${activeLabel} 센서값 대기`}</small></div>${renderCop(activeCop)}</div>
    <div class="rehab-panel-footer"><div><b>피드백 규칙</b><small>최근 ${config.windowSize ?? 5}회 중 ${config.repeatRequired ?? 3}회 반복 · 동일 알림 ${Math.round((config.cooldownMs ?? 5000) / 1000)}초 쿨다운</small></div><div class="rehab-actions"><button class="outline-button" data-action="rehab-calibrate">현재값으로 기준선 생성</button><button class="text-button" data-action="rehab-reset">기준선 초기화</button></div></div>
    <p class="medical-disclaimer rehab-disclaimer">시제품 휴리스틱입니다. 실제 허용 하중과 임계값은 의료진 설정 및 사용자 데이터로 조정해야 합니다.</p>
  </article>`;
}
