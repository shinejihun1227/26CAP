import { escapeHtml } from "../utils/text.js";
import { VIEWS, METRICS } from "./rom-math.js";
import { buildSetReport } from "./rom-sets.js";

export function renderSetWorkspace() {
  return `<section class="rom-set-panel" aria-label="3방향 측정 세트">
    <div class="rom-panel-head"><div><span class="rom-eyebrow">ONE PERSON · THREE VIEWS</span><h2>3방향 측정 세트</h2></div><span data-rom-set-owner>현재 측정 코드: P01</span></div>
    <div class="rom-set-toolbar"><label>현재 세트<select data-rom-set-select><option value="">개별 기록 모드</option></select></label><label>새 세트 이름<input data-rom-set-label maxlength="60" placeholder="예: 9월 9일 오전 관절 관찰"></label><button type="button" class="rom-primary" data-rom-action="set-create" disabled>새 세트 만들기</button></div>
    <p class="rom-help" data-rom-set-notice>아래 측정 코드를 확인한 뒤 세트를 만드세요. 이후 저장하는 각도 기록을 하나의 자료로 묶습니다.</p>
    <div class="rom-set-views" data-rom-set-views>${Object.entries(VIEWS).map(([view, label]) => `<div class="rom-set-view"><strong>${escapeHtml(label)}</strong><span>세트 선택 후 기록</span><button type="button" data-rom-action="set-capture" data-rom-view="${view}" disabled>${escapeHtml(label)} 촬영</button></div>`).join("")}</div>
  </section>`;
}

export function renderSetReportPanel() {
  return `<section class="rom-set-report" aria-label="통합 관절 자료"><div class="rom-panel-head"><div><span class="rom-eyebrow">MULTI-VIEW RECORD</span><h2>통합 관절 자료</h2></div><div class="rom-buttons"><button type="button" data-rom-action="set-json" disabled>통합 JSON</button><button type="button" data-rom-action="set-csv" disabled>통합 CSV</button><button type="button" class="rom-danger" data-rom-action="set-delete" disabled>세트만 삭제</button></div></div><div data-rom-set-report>세트를 선택하면 정면·좌측면·우측면 기록을 함께 확인할 수 있습니다.</div><p class="rom-help">서로 다른 시점의 2D 각도 기록을 묶는 기능입니다. 3D 복원·동시 촬영·치료 효과 판정이 아니며, 영상은 저장하지 않습니다.</p></section>`;
}

export function renderSetViews(set, sessions) {
  const report = set ? buildSetReport(set, sessions) : null;
  return Object.entries(VIEWS).map(([view, label]) => {
    const summary = report?.views[view];
    return `<div class="rom-set-view ${summary?.eligibleCount ? "is-recorded" : ""}"><strong>${label}</strong><span>${summary ? `저장 ${summary.count}개 · 품질 통과 ${summary.eligibleCount}개` : "세트 선택 후 기록"}</span><button type="button" data-rom-action="set-capture" data-rom-view="${view}" ${set ? "" : "disabled"}>${label} 촬영</button></div>`;
  }).join("");
}

export function renderIntegratedReport(set, sessions) {
  if (!set) return "세트를 선택하면 정면·좌측면·우측면 기록을 함께 확인할 수 있습니다. 기존 기록은 아래 방향별 기록에서 세트에 추가하세요.";
  const report = buildSetReport(set, sessions);
  const status = report.complete ? "3방향 품질 통과 기록 포함" : `${report.coveredViews.length}/3방향 품질 통과 기록 포함 · 미완성`;
  return `<p class="rom-set-status"><b>${escapeHtml(set.label)}</b> · ${escapeHtml(set.participant)}<br>${status} · ${report.rows.length}개 원본 기록</p>
    ${report.missingIds.length ? `<p class="rom-set-warning">원본이 삭제·만료된 연결 ${report.missingIds.length}개가 있습니다. 완료 상태에서 제외됩니다. <button type="button" data-rom-action="set-prune">누락 연결 정리</button></p>` : ""}
    ${report.conditionCount > 1 ? '<p class="rom-set-warning">촬영 환경·자세 또는 분석 설정이 다른 기록이 포함돼 있습니다. 조건을 확인하고 각 결과를 따로 해석하세요.</p>' : ""}
    ${report.spanMinutes > 120 ? `<p class="rom-set-warning">첫 기록과 마지막 기록 사이가 ${report.spanMinutes}분입니다. 같은 시점의 측정으로 해석하지 마세요.</p>` : ""}
    <div class="rom-history">${report.rows.length ? `<table><thead><tr><th>방향 / 관절</th><th>관찰 각도 P05–P95</th><th>관찰 범위</th><th>품질</th><th>촬영 시각 / 조건</th><th>세트 연결</th></tr></thead><tbody>${report.rows.map((r) => `<tr><td>${VIEWS[r.view]}<br>${escapeHtml(METRICS[r.metric].label)}</td><td>${r.stats ? `${r.stats.p05}~${r.stats.p95}°` : "—"}</td><td>${r.stats ? `${r.stats.observedRange}°` : "—"}</td><td>${r.eligible ? "기준 비교 가능" : "품질 부족 · 비교 제외"}<br>유효 ${Math.round(r.validRatio * 100)}%</td><td>${escapeHtml(new Date(r.capturedAt).toLocaleString("ko-KR"))}<br>${r.posture === "seated" ? "앉아서" : "서서"} · ${escapeHtml(r.setup)}</td><td><button type="button" data-rom-action="set-remove" data-rom-id="${escapeHtml(r.sessionId)}">세트에서 빼기</button></td></tr>`).join("")}</tbody></table>` : "아직 연결된 각도 기록이 없습니다. 위 방향 버튼으로 촬영하거나 기존 기록을 추가하세요."}</div>`;
}
