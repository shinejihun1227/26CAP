import { METRICS, comparisonKey, compareSessions, round } from './rom-math.js';
import { escapeHtml as e } from '../utils/text.js';
import { icon } from '../components/icons.js';

const number = (value, suffix = '°') => Number.isFinite(value) ? `${round(value)}${suffix}` : '—';
export function comparableRecords(record, sessions) {
  if (!record?.summary?.eligible) return [];
  return sessions.filter(s => s.id !== record.id && s.summary?.eligible
    && comparisonKey(s) === comparisonKey(record)
    && Date.parse(s.capturedAt) < Date.parse(record.capturedAt))
    .sort((a,b) => Date.parse(b.capturedAt) - Date.parse(a.capturedAt));
}

export function motionCards({ record, baseline, analysis, fresh = false, recording = false, metric }) {
  const stats = record?.summary?.byMetric?.[record.config.metric];
  const label = METRICS[record?.config.metric || metric]?.label || '선택 관절';
  const compared = !recording && compareSessions(record, baseline);
  const quality = record?.summary;
  return [
    { label: record && !recording ? '기록 중앙 각도' : '현재 관절 각도', value: record && !recording ? number(stats?.median) : number(fresh && analysis?.valid ? analysis.primary : null), note: label, tone: 'sky', symbol: 'activity' },
    { label: '움직인 범위', value: number(stats?.observedRange), note: stats ? `대부분의 각도 ${number(stats.p05)} ~ ${number(stats.p95)}` : '15초 기록 후 확인', tone: 'mint', symbol: 'arrow' },
    { label: '기록 품질', value: quality ? number(quality.validRatio * 100, '%') : '—', note: quality ? `유효 ${quality.validCount}/${quality.totalCount}개 · ${recording ? '수집 중' : quality.eligible ? '비교 가능' : '비교 제외'}` : '유효한 관절 표본의 비율', tone: 'lavender', symbol: 'camera' },
    { label: '이전 기록과 차이', value: compared ? `${compared.delta > 0 ? '+' : ''}${number(compared.delta)}` : '—', note: compared ? '움직인 범위 차이' : '같은 조건의 저장 기록 필요', tone: 'sand', symbol: 'balance' },
  ];
}
export function renderMotionCards(options) {
  return motionCards(options).map(c => `<article class="motion-stat motion-${c.tone}"><div><span class="motion-stat-icon">${icon(c.symbol)}</span><h3>${e(c.label)}</h3></div><strong>${e(c.value)}</strong><p>${e(c.note)}</p></article>`).join('');
}

export function recordInsights(record, baseline, goal = null, goalProgress = null) {
  if (!record) return [
    { label: '현재 상태', text: '15초 기록을 마치면 카메라가 추정한 각도와 유효하게 관찰된 범위를 보여드려요.' },
    { label: '변화', text: '같은 촬영 조건으로 저장한 이전 기록이 있으면 나란히 비교해요.' },
    { label: '목표', text: goal?.mode === 'observe' ? `첫 측정 ${number(goal.start)}를 개인 기준으로 삼아 같은 조건의 기록을 모아요.` : goal ? `설정한 관찰 목표 ${number(goal.target)}를 저장 기록과 비교할 수 있어요.` : '유효한 첫 기록을 저장하면 개인 기준으로 삼을 관찰 계획을 제안해요.' },
    { label: '다음 행동', text: '카메라를 켜고 같은 자세와 촬영 방향에서 기록을 저장하세요.' },
  ];
  const metric = record.config.metric, stats = record.summary.byMetric[metric];
  const valid = record.samples.filter(s => s.valid && Number.isFinite(s.values?.[metric]));
  const peak = valid.reduce((a,b) => !a || b.values[metric] > a.values[metric] ? b : a, null);
  const notes = [{ label: '현재 상태', text: stats ? `${METRICS[metric].label} 중앙 각도 ${number(stats.median)}, 관찰 범위 ${number(stats.observedRange)}예요. 유효 표본 ${record.summary.validCount}/${record.summary.totalCount}개.` : '유효한 각도 표본이 부족해 수치를 요약할 수 없어요.' }];
  const compared = compareSessions(record, baseline);
  if (!record.summary.eligible) notes.push({ label: '변화', text: '기록 품질 기준을 충족하지 않아 비교에 포함하지 않았어요. 촬영 위치를 확인하고 다시 측정해 주세요.' });
  else if (compared) notes.push({ label: '변화', text: `같은 조건의 이전 기록보다 관찰 범위가 ${compared.delta === 0 ? '같아요' : `${number(Math.abs(compared.delta))} ${compared.delta > 0 ? '커졌어요' : '작아졌어요'}`}. 수치 차이를 뜻하며 개선·악화 판정은 아니에요.` });
  else notes.push({ label: '변화', text: '비교할 이전 기록이 없어요. 같은 관절·방향·자세·환경으로 저장하면 변화를 볼 수 있어요.' });
  if (goal && goal.config?.metric === metric && goal.mode === 'observe') notes.push({ label: '목표', text: goalProgress ? `첫 기준 ${number(goal.start)} · 최근 ${number(goalProgress.value)}. 같은 조건으로 ${goalProgress.count}/${goalProgress.targetCount}회 기록했어요. 횟수는 관찰 계획이며 회복률이 아닙니다.` : `첫 측정 ${number(goal.start)}를 개인 기준으로 삼았어요. 같은 조건의 유효한 기록을 더 모으면 변화를 볼 수 있어요.` });
  else if (goal && goal.config?.metric === metric) notes.push({ label: '목표', text: goalProgress ? `설정한 ${number(goal.start)} → ${number(goal.target)} 관찰 목표 중 최근 기록은 ${number(goalProgress.value)}예요. 진행도 ${goalProgress.percent}% (${goalProgress.count}개 유효 기록). 회복률이 아닙니다.` : `관찰 목표 ${number(goal.target)}가 있어요. 같은 조건의 품질 통과 기록이 쌓이면 진행도를 표시해요.` });
  else notes.push({ label: '목표', text: '유효한 첫 기록을 저장하면 개인 기준으로 삼는 관찰 계획을 시작할 수 있어요. 치료 목표 각도는 담당 전문가와 정하세요.' });
  const next = !record.summary.eligible ? '몸과 선택 관절이 잘 보이도록 조정한 뒤 15초를 다시 기록하세요.' : !compared ? '다음에도 같은 촬영 방향·자세·환경 코드로 기록을 저장하세요.' : '예정한 측정 횟수에 맞춰 같은 조건으로 기록을 이어가세요.';
  notes.push({ label: '다음 행동', text: peak && valid.length ? `${next} 가장 큰 관찰 각도는 ${number(peak.values[metric])} (${round(peak.t / 1000)}초)였어요.` : next });
  return notes;
}
export function renderMotionInsights(record, baseline, goal = null, goalProgress = null, localFeedback = null) {
  const metric = record?.config?.metric;
  const ankle = metric === 'left_ankle' || metric === 'right_ankle';
  const eligible = Boolean(record?.summary?.eligible && ankle);
  const feedback = localFeedback?.key === record?.capturedAt ? localFeedback : null;
  const feedbackText = feedback?.text ? e(feedback.text) : feedback?.error ? e(feedback.error) : eligible ? '숫자 측정 요약만 이 PC의 로컬 모델로 보냅니다. 웹캠 영상·개인 코드·원시 기록은 전송하지 않습니다.' : ankle ? '품질 기준을 통과한 발목 기록을 선택하면 사용할 수 있어요.' : '발목 관절 기록을 선택하면 사용할 수 있어요.';
  return `<ol>${recordInsights(record, baseline, goal, goalProgress).map((item, i) => `<li><span>${i + 1}</span><div><b>${e(item.label)}</b><p>${e(item.text)}</p></div></li>`).join('')}</ol><section class="motion-local-ai" aria-label="로컬 발목 관찰 피드백"><div><b>로컬 AI 관찰 요약</b><small>ChatGPT 앱이 아닌, 이 PC에서 실행하는 Ollama 모델을 사용해요.</small></div><button type="button" class="rom-primary" data-motion-ai-feedback ${eligible && feedback?.loading !== true ? '' : 'disabled'}>${feedback?.loading ? '요약 중…' : '발목 기록 해석 받기'}</button><p data-motion-ai-output role="status">${feedbackText}</p><details><summary>로컬 AI 준비 방법</summary><p>Ollama를 설치한 뒤 터미널에서 <code>ollama run qwen2.5:3b</code>를 한 번 실행하세요. 모델이 준비되면 이 웹의 버튼으로 요약할 수 있어요.</p><p>이 기능은 ChatGPT 앱에 연결하지 않습니다. 별도 API 키 없이 이 PC의 모델만 사용합니다.</p></details><small>진단·치료 목표·운동 처방은 제공하지 않습니다. 의료 판단은 담당 전문가에게 확인하세요.</small></section>`;
}

// Invalid samples break the line. Every x coordinate is an actual sample time.
export function angleSeries(samples, metric) {
  return samples.map(s => ({ t: s.t / 1000, value: s.valid && Number.isFinite(s.values?.[metric]) ? s.values[metric] : null }));
}
export function renderAngleChart(samples, metric, baseline = null, durationSeconds = 15) {
  const series = angleSeries(samples, metric), previous = baseline ? angleSeries(baseline.samples, baseline.config.metric) : [];
  const maxTime = Math.max(1, durationSeconds, ...series.map(p => p.t), ...previous.map(p => p.t));
  const width = 800, height = 290, left = 64, right = 18, top = 20, bottom = 60;
  const x = t => round(left + t / maxTime * (width - left - right), 2);
  const y = v => round(height - bottom - v / 180 * (height - top - bottom), 2);
  const path = points => {
    let connected = false;
    return points.map(p => { if (p.value === null) { connected = false; return ''; } const command = `${connected ? 'L' : 'M'}${x(p.t)},${y(p.value)}`; connected = true; return command; }).join(' ');
  };
  const ticks = [0, 45, 90, 135, 180].map(a => `<line x1="${left}" y1="${y(a)}" x2="${width-right}" y2="${y(a)}"/><text x="${left-10}" y="${y(a)+4}" text-anchor="end">${a}</text>`).join('');
  const times = Array.from({length:6}, (_,i) => { const t = maxTime * i / 5; return `<text x="${x(t)}" y="${height-12}" text-anchor="${i === 5 ? 'end' : 'middle'}">${round(t)}초</text>`; }).join('');
  const good = series.filter(p => p.value !== null);
  const peak = good.reduce((a,b) => !a || b.value > a.value ? b : a, null);
  return `<svg class="motion-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(METRICS[metric]?.label || '선택 관절')} 각도 변화. 시간은 초, 각도는 도 단위입니다."><g class="motion-chart-grid">${ticks}${times}</g>${previous.length ? `<path class="motion-chart-previous" d="${path(previous)}"/>` : ''}<path class="motion-chart-current" d="${path(series)}"/>${peak ? `<circle class="motion-chart-peak" cx="${x(peak.t)}" cy="${y(peak.value)}" r="5"><title>${round(peak.t)}초 · ${number(peak.value)}</title></circle>` : '<text class="motion-chart-empty" x="410" y="140" text-anchor="middle">관절이 인식되면 그래프가 나타나요</text>'}</svg>`;
}

export function dailyAnglePoints(sessions, config) {
  const key = JSON.stringify([config?.participant, config?.view, config?.metric, config?.posture, config?.setup, config?.confidence, config?.protocol, config?.modelVersion, round(config?.width / config?.height, 2)]);
  const days = new Map();
  for (const session of sessions || []) {
    if (!session?.summary?.eligible || comparisonKey(session) !== key) continue;
    const value = session.summary.byMetric?.[config.metric]?.median;
    const date = new Date(session.capturedAt);
    if (!Number.isFinite(value) || Number.isNaN(date.getTime())) continue;
    const day = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    if (!days.has(day)) days.set(day, []);
    days.get(day).push(value);
  }
  return [...days].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, value: round(values.reduce((sum, n) => sum + n, 0) / values.length), count: values.length }));
}

export function renderDailyAngleChart(points, metric, target = null, targetLabel = '목표') {
  const width = 800, height = 290, left = 64, right = 18, top = 20, bottom = 60;
  const x = i => round(left + (points.length <= 1 ? .5 : i / (points.length - 1)) * (width - left - right), 2);
  const y = v => round(height - bottom - v / 180 * (height - top - bottom), 2);
  const ticks = [0, 45, 90, 135, 180].map(a => `<line x1="${left}" y1="${y(a)}" x2="${width-right}" y2="${y(a)}"/><text x="${left-10}" y="${y(a)+4}" text-anchor="end">${a}</text>`).join('');
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i)},${y(p.value)}`).join(' ');
  const labels = points.map((p, i) => `<text x="${x(i)}" y="${height-12}" text-anchor="middle">${e(p.date.slice(5).replace('-', '.'))}</text>`).join('');
  const dots = points.map((p, i) => `<circle class="motion-chart-peak" cx="${x(i)}" cy="${y(p.value)}" r="5"><title>${e(p.date)} · ${number(p.value)} · ${p.count}개 기록 평균</title></circle>`).join('');
  const targetLine = Number.isFinite(target) ? `<line class="motion-chart-target" x1="${left}" y1="${y(target)}" x2="${width-right}" y2="${y(target)}"/><text class="motion-chart-target-label" x="${width-right-4}" y="${y(target)-7}" text-anchor="end">${e(targetLabel)} ${number(target)}</text>` : '';
  const empty = '<text class="motion-chart-empty" x="410" y="140" text-anchor="middle">조건이 같은 유효한 저장 기록이 쌓이면 날짜별 변화가 나타나요</text>';
  return `<svg class="motion-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${e(METRICS[metric]?.label || '선택 관절')} 날짜별 각도 변화. 각도는 도 단위입니다."><g class="motion-chart-grid">${ticks}${labels}</g>${targetLine}${points.length ? `<path class="motion-chart-current" d="${path}"/>${dots}` : empty}</svg>`;
}

export function renderRecordComparison(record, baseline) {
  const compared = compareSessions(record, baseline);
  if (!compared) return '<p class="motion-empty">같은 조건의 품질 통과 기록 두 개가 있어야 비교할 수 있어요.</p>';
  const a = record.summary.byMetric[record.config.metric], b = baseline.summary.byMetric[baseline.config.metric];
  const rows = [['움직인 범위', a.observedRange, b.observedRange, 180, '°'], ['중앙 각도', a.median, b.median, 180, '°'], ['유효 표본 비율', record.summary.validRatio * 100, baseline.summary.validRatio * 100, 100, '%']];
  return `<div class="motion-comparison-grid">${rows.map(([label, now, before, max, unit]) => `<article><h3>${label}</h3>${[['선택 기록', now, 'current'], ['이전 기록', before, 'previous']].map(([name, value, tone]) => `<div class="motion-comparison-bar"><span>${name}</span><div><i class="${tone}" style="width:${Math.max(0, Math.min(100, value / max * 100))}%"></i></div><b>${number(value, unit)}</b></div>`).join('')}</article>`).join('')}</div>`;
}

export function renderMotionDashboard() {
  return `<section class="motion-analysis" data-motion-analysis aria-label="관절 움직임 관찰 분석"><div class="motion-section-heading"><div><h2>내 움직임 기록</h2><p data-motion-context>카메라로 관절 움직임을 기록하고, 같은 조건의 내 기록과 비교해요.</p></div><span class="motion-state" data-motion-state>측정 대기</span></div><div class="motion-stats" data-motion-cards></div><section class="motion-panel motion-goal" data-motion-goal-panel><div class="motion-section-heading"><div><span class="rom-eyebrow">PERSONAL OBSERVATION PLAN</span><h2>내 관찰 계획</h2><p>첫 유효 기록을 개인 기준으로 삼아 같은 조건의 변화를 살펴봅니다. 치료 목표나 회복 판정이 아닙니다.</p></div><button type="button" data-motion-goal-toggle aria-expanded="false">전문가 목표 직접 입력 (선택)</button></div><form data-motion-goal-form hidden><div class="motion-goal-fields"><label>관절·동작<input data-goal-joint readonly></label><label>시작 각도 (°)<input data-goal-start type="number" min="0" max="180" step="1"></label><label>목표 각도 (°)<input data-goal-target type="number" min="0" max="180" step="1" placeholder="예: 전문가 안내값" required></label><label>시작일<input data-goal-start-date type="date" required></label><label>목표일<input data-goal-end-date type="date" required></label><label>주당 측정<select data-goal-frequency><option value="1">주 1회</option><option value="2">주 2회</option><option value="3" selected>주 3회</option><option value="5">주 5회</option><option value="7">매일</option></select></label><label>목표 출처<select data-goal-source><option value="clinician">전문가 안내값</option><option value="personal">내가 정한 관찰 목표</option></select></label><label class="motion-goal-note">참고 메모<input data-goal-note maxlength="160" placeholder="예: 담당 전문가가 안내한 목표"></label></div><div class="motion-goal-actions"><button class="rom-primary" type="submit">전문가 목표 저장</button><button type="button" data-motion-goal-cancel>취소</button></div></form><div data-motion-goal-progress class="motion-goal-progress"></div><p class="motion-footnote">카메라 기반 2D 각도는 임상 각도계 검사와 같지 않습니다. 전문가는 측정법에 따른 차이를 보고했으므로, 고정된 의학 목표값 대신 본인 첫 유효값을 기준으로 추적합니다. <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC8696933/" target="_blank" rel="noopener noreferrer">발목 ROM 스마트폰 측정 연구</a>는 이 앱의 정확도를 검증한 연구가 아닙니다.</p></section><div class="motion-analysis-grid"><section class="motion-panel"><div class="motion-section-heading"><h2>관절 각도 변화</h2><div class="motion-chart-controls" role="group" aria-label="그래프 보기"><button type="button" data-motion-chart-mode="live" aria-pressed="true">실시간</button><button type="button" data-motion-chart-mode="daily" aria-pressed="false">날짜별 변화</button></div></div><p class="motion-chart-caption" data-motion-chart-caption>각도(°) · 카메라가 관절을 인식하지 못한 구간은 비워 둡니다.</p><div data-rom-chart></div><details class="motion-more"><summary>함께 인식한 관절 보기</summary><div class="rom-live-metrics" data-rom-metrics></div></details></section><aside class="motion-panel motion-insights"><h2>이번 기록 요약</h2><p class="motion-insight-lead">현재 측정 → 내 이전 기록 → 관찰 계획 → 다음 기록</p><div data-motion-insights></div></aside></div><section class="motion-panel motion-comparison" id="rom-record-comparison"><div class="motion-section-heading"><h2>내 저장 기록 비교</h2><span>같은 조건의 기록만 비교해요</span></div><div class="motion-review-controls"><label>불러올 기록<select data-motion-review><option value="">저장된 기록 없음</option></select></label><button type="button" data-rom-action="review" disabled>기록 불러오기</button><label>비교할 이전 기록<select data-motion-baseline disabled><option value="">비교할 기록 없음</option></select></label></div><div data-motion-comparison></div><p class="motion-footnote">관절·촬영 방향·자세·환경·신뢰도·모델·화면 비율이 같은 기록만 비교합니다. 수치 차이는 측정값의 차이이며 개선이나 악화를 판정하지 않습니다.</p></section></section>`;
}
