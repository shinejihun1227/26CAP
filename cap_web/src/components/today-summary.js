import { summaryFog, summaryAnkle, summaryCop, directionMarker, inclinationMarker } from '../data/today-summary.js';
import { escapeHtml as e } from '../utils/text.js';
import { connectionSummary } from './connection-summary.js';
import { renderSensorFeedback } from './sensor-feedback.js';

const sides = ['left', 'right'];
const name = side => side === 'left' ? '왼발' : '오른발';
const number = value => value === null ? '—' : value;
const button = (text, view, extra = '') => `<button type="button" class="today-link" data-view="${view}" ${extra}>${text}<span aria-hidden="true">↗</span></button>`;
const heading = (index, label, title, action = '') => `<header class="today-card-head"><div class="today-card-title"><span class="today-index">${index}</span><div><span class="today-kicker">${label}</span><h2>${title}</h2></div></div>${action}</header>`;

function fogCard(state, now) {
  const data = summaryFog(state, now);
  return `<section class="today-card today-fog" aria-label="AI 모델 기반 FoG 점수표">
    ${heading('01', 'AI MODEL', '보행동결 FoG 점수', button('AI 개인 보정', 'devices', 'data-open-disclosure="device-baselines"'))}
    <div class="today-fog-body"><div class="today-fog-score tone-${data.tone}"><span>현재 종합 판정</span><div><strong>${number(data.value)}</strong><span>/ 100점</span></div><b>${e(data.label)}</b><small>${data.pressureOnly ? '압력 보조 판단 · AI 점수 없음' : data.selected ? `${name(data.selected)} 판정 기준` : '연결·보정 후 표시'}</small></div>
    <div class="today-score-table"><table><caption class="visually-hidden">양발의 AI FoG 점수와 현재 판정</caption><thead><tr><th scope="col">측정 발</th><th scope="col">FoG 점수</th><th scope="col">현재 판정</th></tr></thead><tbody>${data.feet.map(f => `<tr data-summary-fog-side="${f.side}"><th scope="row">${name(f.side)}</th><td><strong>${number(f.value)}</strong><span class="today-score-unit"> / 100</span><div class="today-score-track" aria-hidden="true"><i style="width:${f.value ?? 0}%"></i></div></td><td><span class="today-status tone-${f.tone}">${e(f.label)}</span></td></tr>`).join('')}</tbody></table>
    <div class="today-card-bottom"><p>${data.reason ? e(data.reason) : '양발을 각각 분석해 더 높은 판정 상태를 보여요.'}</p>${button('상세 점수', 'live')}</div></div></div>
    ${!state.easyMode ? `<details class="today-detail" data-ui-disclosure="today-model-scores"><summary>RF · CNN 모델 점수 보기</summary><p>${data.feet.map(f => `${name(f.side)}: RF ${number(f.rf)}점 · CNN ${number(f.cnn)}점`).join('　 /　 ')}. FoG 점수는 AI의 판정 점수이며 질환 확률이 아닙니다.</p></details>` : ''}
  </section>`;
}

function sphere(f) {
  const id = `today-sphere-${f.side}`, validPlan = Boolean(f.plan);
  const directional = directionMarker(f.tilt, f.plan?.max, f.direction);
  const point = directional || inclinationMarker(f.tilt, f.plan?.max);
  const label = `${name(f.side)} ${f.label}${point ? `, 현재 ${f.tilt}도, 기록 범위 ${f.plan.max}도` : ''}, ${directional ? f.direction.label : '구 중심에서 점까지의 거리는 기울기 크기이며 앞뒤·좌우 방향은 미표시'}`;
  const left=f.side==='left'?'바깥':'안쪽',right=f.side==='left'?'안쪽':'바깥';
  const arrow=directional && point.distance>16?{x:140+(point.x-140)*(point.distance-12)/point.distance,y:120+(point.y-120)*(point.distance-12)/point.distance}:null;
  return `<svg class="today-sphere ${validPlan ? '' : 'is-unprepared'}" viewBox="-30 -28 340 296" role="img" aria-label="${e(label)}">
    <defs><radialGradient id="${id}-fill" cx="32%" cy="25%" r="76%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".52" stop-color="#b9e3eb" stop-opacity=".48"/><stop offset="1" stop-color="#8cbdcb" stop-opacity=".64"/></radialGradient><radialGradient id="${id}-shadow"><stop stop-color="#789da8" stop-opacity=".2"/><stop offset="1" stop-color="#789da8" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="140" cy="216" rx="87" ry="13" fill="url(#${id}-shadow)"/>
    <g class="today-sphere-grid"><circle cx="140" cy="120" r="80" fill="url(#${id}-fill)"/><ellipse cx="140" cy="120" rx="80" ry="27" fill="none" transform="rotate(-20 140 120)"/><ellipse cx="140" cy="120" rx="34" ry="80" fill="none" transform="rotate(-20 140 120)"/><ellipse cx="140" cy="120" rx="64" ry="80" fill="none" transform="rotate(38 140 120)"/><path d="M67 88 Q143 135 213 88 M68 153 Q142 177 212 151" fill="none" stroke-dasharray="3 4"/></g>
    <defs><marker id="${id}-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="${point?.outside?'#d83c4c':'#2563df'}"/></marker></defs>
    <path class="today-sphere-axis" d="M40 120H240 M140 20V220"/>
    ${directional ? `<g class="today-direction-labels"><text x="140" y="-8" text-anchor="middle">전방 · 발끝</text><text x="140" y="258" text-anchor="middle">후방 · 뒤꿈치</text><text x="15" y="113" text-anchor="end">${left}</text><text x="15" y="133" text-anchor="end">측면</text><text x="265" y="113">${right}</text><text x="265" y="133">측면</text></g>` : `<g class="today-direction-labels"><text x="140" y="-8" text-anchor="middle">${validPlan ? '내 기록 범위' : '범위 기록 전'}</text></g><text x="140" y="258" text-anchor="middle" class="today-direction-wait">${point ? '방향 미표시 · 기울기 크기만 비교' : '새로운 측정값을 기다려요'}</text>`}
    <circle cx="140" cy="120" r="3" fill="#718e9c"/>
    ${point ? `<g class="today-range-marker ${point.outside ? 'is-outside' : 'is-within'}" data-range-state="${point.outside ? 'outside' : 'within'}" data-range-mode="${directional ? 'direction' : 'magnitude'}"${directional ? ` data-direction="${e(f.direction.code)}"` : ''}>${arrow?`<path class="today-direction-arrow" d="M140 120 L${arrow.x.toFixed(2)} ${arrow.y.toFixed(2)}" marker-end="url(#${id}-arrow)"/>`:!directional ? `<path d="M140 120 L${point.x.toFixed(2)} ${point.y.toFixed(2)}"/>` : ''}<circle class="today-point-halo" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="13"/><circle class="today-point" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="8"/></g>` : ''}
  </svg>`;
}

function rangeFoot(f) {
  const directional = Boolean(directionMarker(f.tilt, f.plan?.max, f.direction));
  const title = f.tilt === null ? f.label : directional ? f.direction.label : f.outside ? '기록 범위 밖이에요' : '기록 범위 안이에요';
  const note = f.tilt === null ? '' : f.outside ? `${(f.tilt-f.plan.max).toFixed(1)}° 초과 · ${f.eventConfirmed ? '이탈 기록 중' : '지속 여부 관찰 중'}` : '현재 기울기가 기록 기준선 안에 있어요.';
  const action = f.plan && !f.plan.directionReady ? `${name(f.side)} 방향 다시 기록` : `${name(f.side)} 기준 기록`;
  return `<article class="today-foot-range" data-summary-ankle-side="${f.side}"><div class="today-foot-head"><h3>${name(f.side)}</h3><span class="today-status ${f.tilt === null ? 'tone-sky' : f.outside ? 'tone-coral' : 'tone-blue'}">${e(f.label)}</span></div>
    ${sphere(f)}<div class="today-direction-reading ${f.outside?'is-outside':''}"><b>${e(title)}</b><span>${e(f.hint)}</span></div>
    <div class="today-angle-values"><div><span>기준 대비 기울기</span><strong>${f.tilt === null ? '—' : `${f.tilt.toFixed(1)}<small>°</small>`}</strong><small>처음 자세 = 0°</small></div><div><span>기록 기준선</span><b>${f.plan ? `${f.plan.max}°` : '기록 전'}</b><small>기록값의 95백분위</small></div></div>
    ${note?`<p class="today-range-note">${e(note)}</p>`:''}
    ${f.plan&&!f.plan.directionReady?'<p class="today-range-note">구의 방향을 보려면 다시 기록할 때 처음 4초간 발끝을 살짝 들고 유지하세요.</p>':''}
    ${button(action, 'ankle', `data-daily-focus="${f.side}"`)}</article>`;
}

function rangeCard(state, now) {
  return `<section class="today-card today-rom" aria-label="BMI 기반 양발 움직임 범위">
    ${heading('02', 'BMI270 · FOOT TILT', '발 기울기 범위', button('양발 범위 보정', 'ankle'))}
    <div class="today-rom-legend"><span><i class="dot-blue"></i>구 안 · 기록 범위 안</span><span><i class="dot-red"></i>구 밖 · 기록 범위 밖</span><span>점은 현재 발 기울기예요.</span></div>
    <div class="today-spheres">${sides.map(side => rangeFoot(summaryAnkle(state, side, now))).join('')}</div>
    <p class="today-scope">BMI가 측정한 <b>발 기울기</b>의 비교 표시예요. 실제 발목 관절 ROM과 달라요.</p>
    ${renderSensorFeedback(state, 'rom')}
    <details class="today-detail" data-ui-disclosure="today-range-info"><summary>기울기·기록 기준선·방향은 무엇인가요?</summary><p><b>기준 대비 기울기:</b> 처음 3초간 저장한 자세를 0°로 보고, 지금 발 센서의 중력 방향이 얼마나 달라졌는지 계산해요. 위아래·좌우 기울기가 합쳐진 크기이며 다리 전체를 들거나 센서가 움직여도 값이 변할 수 있어요. 정강이에 대한 발목 각도나 수평 회전은 알 수 없어요.</p><p><b>기록 기준선:</b> 10초 기록 중 유효한 기울기를 작은 순서대로 놓았을 때 95% 위치의 값이에요. 예를 들어 75.6°는 그때 기록한 비교 기준이며 정상 범위·안전 한계가 아니에요. 방향별 최소·최대값을 따로 측정한 것도 아닙니다.</p><p><b>점의 위치:</b> 발끝 방향이 확인되면 구 위에 앞뒤·좌우 방향을 표시해요. 위쪽은 발끝 들림, 아래쪽은 뒤꿈치 들림이며 측면은 착용자 기준입니다. 방향 확인이 안 되어도 같은 구체에 파란 점·빨간 점으로 범위 안팎을 보여요. 이때 구 중심에서 점까지의 거리만 기울기 크기를 뜻하며, 점이 놓인 쪽은 실제 발의 방향이 아닙니다.</p><p>방향을 보려면 3초 기준 자세 후 10초 기록을 시작하고, 처음 4초간 발끝을 몸쪽으로 살짝 들고 유지하세요. 이후에는 편안한 범위로 움직이고 양끝에서 잠깐 멈춰요. 무리해서 기준값을 높이지 마세요.</p><p>구의 모든 방향에는 같은 기록 기준선을 사용합니다. 정지에 가까운 값만 비교하며, 걷거나 크게 흔들리면 점을 숨겨요. 빨간 점은 기록 기준 초과, 이탈 기록은 기준 + 5°를 1초 이상 초과했을 때 남습니다. 센서를 다시 착용하면 기준을 다시 맞추세요.</p></details>
  </section>`;
}

function copFoot(data) {
  const id = `today-cop-${data.side}`, active = data.position !== null;
  const y = active ? 180 - data.position * 140 : 110;
  return `<article class="today-cop-foot"><h3>${name(data.side)}</h3><svg viewBox="0 0 150 230" role="img" aria-label="${name(data.side)} ${e(data.label)}${active ? `, 앞 ${data.front}퍼센트, 뒤 ${data.rear}퍼센트` : ''}"><defs><linearGradient id="${id}" x1="0" y1="0" x2="0" y2="1"><stop stop-color="#d6f0ed"/><stop offset="1" stop-color="#eff5f7"/></linearGradient></defs><path d="M76 17 C104 17 116 46 112 78 C109 107 89 117 94 146 C100 173 98 205 77 211 C51 221 39 193 43 163 C50 130 35 117 32 88 C28 47 47 18 76 17Z" fill="url(#${id})" stroke="#9cbdbd" stroke-width="1.5" ${data.side === 'right' ? 'transform="translate(150 0) scale(-1 1)"' : ''}/><path d="M75 40V180" stroke="#adc7c9" stroke-width="2" stroke-dasharray="4 5"/><path d="M62 40H88 M62 110H88 M62 180H88" stroke="#adc7c9"/><text x="126" y="44" text-anchor="middle">앞</text><text x="126" y="184" text-anchor="middle">뒤</text>${active ? `<path d="M75 110V${y.toFixed(1)}" stroke="#087e75" stroke-width="4"/><circle cx="75" cy="${y.toFixed(1)}" r="15" fill="#127f75" opacity=".15"/><circle data-cop-position="${data.position.toFixed(3)}" cx="75" cy="${y.toFixed(1)}" r="8" fill="#087e75" stroke="white" stroke-width="3"/>` : '<text x="75" y="118" text-anchor="middle" class="today-cop-empty">—</text>'}</svg><b class="today-cop-label">${e(data.label)}</b><div class="today-cop-values"><span>앞 <b>${active ? `${data.front}%` : '—'}</b></span><span>뒤 <b>${active ? `${data.rear}%` : '—'}</b></span></div></article>`;
}

function copCard(state, now) {
  return `<section class="today-card today-cop" aria-label="압력센서 앞뒤 중심">
    ${heading('03', 'PRESSURE · CoP', '앞뒤 압력 중심')}
    <p class="today-card-intro">초록 점이 향하는 쪽에 압력이 더 실려요.</p><div class="today-cop-feet">${sides.map(side => copFoot(summaryCop(state, side, now))).join('')}</div>
    ${renderSensorFeedback(state, 'cop')}
    <p class="today-scope">압력센서의 <b>앞뒤 상대 중심</b>이에요.</p><details class="today-detail" data-ui-disclosure="today-cop-info"><summary>센서 위치와 표시 기준</summary><p>2센서 배치는 센서 1(GPIO34)을 앞쪽, 센서 2(GPIO35)를 뒤쪽으로 사용합니다. 반대로 부착하면 앞뒤 표시도 바뀝니다. 물리 센서를 한 번씩만 사용하며, 새 보정 후에는 센서별 서 있는 기준값(50점) 대비 비율로 계산합니다. 4칸 히트맵의 파생값은 계산에 쓰지 않습니다.</p><p>실제 힘으로 보정된 2D CoP나 체중 비율이 아닙니다. 약한 압력·연결 끊김은 점을 숨깁니다. 독립 4센서는 가운데 두 점을 포함한 앞뒤 가중 중심을 표시합니다.</p></details>${button('압력·온습도 보기', 'safety')}
  </section>`;
}

export function renderTodaySummary(state, now = Date.now()) {
  const connection = connectionSummary(state);
  return `<section class="today-dashboard" aria-label="오늘 요약"><header class="today-heading"><div><span class="today-kicker">TODAY · STEPON</span><h1>오늘 요약</h1><p>보행 신호, 발의 움직임, 압력 중심을 한눈에.</p></div><span class="today-connection"><i></i>${e(connection.label)}</span></header>
    <div class="today-grid">${fogCard(state, now)}${rangeCard(state, now)}${copCard(state, now)}</div>
    <div class="today-footer"><p class="today-footer-note">새로 수신한 유효값만 표시합니다. 파란 점은 기록 범위 안이라는 뜻이며, 의학적 안전 판정은 아닙니다.</p>${button('홈재활 파트너', 'mediapipe')}</div></section>`;
}
