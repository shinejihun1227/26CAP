import { summaryFog, summaryAnkle, summaryCop, directionMarker } from '../data/today-summary.js';
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
  const id = `today-sphere-${f.side}`, validPlan = Boolean(f.plan), point = directionMarker(f.tilt, f.plan?.max, f.direction);
  const label = `${name(f.side)} ${f.label}${f.tilt !== null ? `, 현재 ${f.tilt}도, 기록 범위 ${f.plan.max}도` : ''}, ${f.direction?.label||'방향 기준 확인 필요'}`;
  const left=f.side==='left'?'바깥':'안쪽',right=f.side==='left'?'안쪽':'바깥';
  const arrow=point && point.distance>16?{x:140+(point.x-140)*(point.distance-12)/point.distance,y:120+(point.y-120)*(point.distance-12)/point.distance}:null;
  return `<svg class="today-sphere ${validPlan ? '' : 'is-unprepared'}" viewBox="-30 -28 340 296" role="img" aria-label="${e(label)}">
    <defs><radialGradient id="${id}-fill" cx="32%" cy="25%" r="76%"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset=".52" stop-color="#b9e3eb" stop-opacity=".48"/><stop offset="1" stop-color="#8cbdcb" stop-opacity=".64"/></radialGradient><radialGradient id="${id}-shadow"><stop stop-color="#789da8" stop-opacity=".2"/><stop offset="1" stop-color="#789da8" stop-opacity="0"/></radialGradient></defs>
    <ellipse cx="140" cy="216" rx="87" ry="13" fill="url(#${id}-shadow)"/>
    <g class="today-sphere-grid"><circle cx="140" cy="120" r="80" fill="url(#${id}-fill)"/><ellipse cx="140" cy="120" rx="80" ry="27" fill="none" transform="rotate(-20 140 120)"/><ellipse cx="140" cy="120" rx="34" ry="80" fill="none" transform="rotate(-20 140 120)"/><ellipse cx="140" cy="120" rx="64" ry="80" fill="none" transform="rotate(38 140 120)"/><path d="M67 88 Q143 135 213 88 M68 153 Q142 177 212 151" fill="none" stroke-dasharray="3 4"/></g>
    <defs><marker id="${id}-arrow" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0 0L6 3L0 6Z" fill="${point?.outside?'#d83c4c':'#2563df'}"/></marker></defs>
    <path class="today-sphere-axis" d="M40 120H240 M140 20V220"/>
    <g class="today-direction-labels ${f.plan?.directionReady?'':'is-pending'}"><text x="140" y="-8" text-anchor="middle">전방 · 발끝</text><text x="140" y="258" text-anchor="middle">후방 · 뒤꿈치</text><text x="15" y="113" text-anchor="end">${left}</text><text x="15" y="133" text-anchor="end">측면</text><text x="265" y="113">${right}</text><text x="265" y="133">측면</text></g>
    <circle cx="140" cy="120" r="3" fill="#718e9c"/>
    ${point ? `<g class="today-range-marker ${point.outside ? 'is-outside' : 'is-within'}" data-range-state="${point.outside ? 'outside' : 'within'}" data-direction="${e(f.direction.code)}">${arrow?`<path class="today-direction-arrow" d="M140 120 L${arrow.x.toFixed(2)} ${arrow.y.toFixed(2)}" marker-end="url(#${id}-arrow)"/>`:''}<circle class="today-point-halo" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="13"/><circle class="today-point" cx="${point.x.toFixed(2)}" cy="${point.y.toFixed(2)}" r="7"/></g>` : '<text x="140" y="126" text-anchor="middle" class="today-direction-wait">방향 표시 대기</text>'}
  </svg>`;
}

function rangeCard(state, now) {
  return `<section class="today-card today-rom" aria-label="BMI 기반 양발 움직임 범위">
    ${heading('02', 'BMI270 · 3D RANGE', '발목 움직임 범위', button('양발 범위 보정', 'ankle'))}
    <div class="today-rom-legend"><span><i class="dot-blue"></i>기록 범위 안</span><span><i class="dot-red"></i>기록 범위 밖</span><span>점·화살표 = 발에서 올라간 쪽</span></div>
    <div class="today-spheres">${sides.map(side => { const f = summaryAnkle(state, side, now); return `<article class="today-foot-range" data-summary-ankle-side="${side}"><div class="today-foot-head"><h3>${name(side)}</h3><span class="today-status ${f.tilt === null ? 'tone-sky' : f.outside ? 'tone-coral' : 'tone-blue'}">${e(f.label)}</span></div>${sphere(f)}<div class="today-direction-reading ${f.outside?'is-outside':''}"><b>${e(f.direction?.label||(f.plan?.directionReady?'새로운 방향값 대기':'발끝 방향 기록 필요'))}</b><span>${f.direction?'발끝을 들어 맞춘 사용자 방향 기준':'3초 기준 → 10초 방향·범위 기록'}</span></div><div class="today-angle-values"><div><span>현재 기울기</span><strong>${f.tilt === null ? '—' : `${f.tilt.toFixed(1)}<small>°</small>`}</strong></div><div><span>내 기록 범위</span><b>${f.plan ? `0–${f.plan.max}°` : '기록 전'}</b></div></div><p class="today-range-note">${f.tilt === null ? '유효한 값과 방향 기준이 있으면 점이 나타나요.' : f.outside ? `${(f.tilt-f.plan.max).toFixed(1)}° 초과 · ${f.eventConfirmed ? '이탈 기록 중' : '지속 여부 관찰 중'}` : '기록한 최대 기울기 안에 있어요.'}</p>${button(`${name(side)} 기준 기록`, 'ankle', `data-daily-focus="${side}"`)}</article>`; }).join('')}</div>
    <p class="today-scope">BMI가 측정한 <b>발 기울기</b>의 비교 표시예요. 실제 발목 관절 ROM과 달라요.</p>
    ${renderSensorFeedback(state, 'rom')}
    <details class="today-detail" data-ui-disclosure="today-range-info"><summary>구와 방향은 무엇을 뜻하나요?</summary><p>기록 처음 4초에 발끝을 들어 사용자 방향을 맞춥니다. 위쪽 전방은 발끝이 올라간 방향, 아래쪽 후방은 뒤꿈치가 올라간 방향입니다. 측면은 착용자 기준이며 양발의 안쪽·바깥쪽 위치는 반대입니다. 안내와 다른 움직임으로 방향을 맞추면 표시도 달라지므로 다시 기록하세요. 방향 확인이 안 되면 점을 표시하지 않습니다.</p><p>구의 반지름은 오늘 기록한 기울기의 95백분위 값입니다. 모든 방향에 같은 반지름을 적용한 표시이며, 방향별로 검증된 관절 한계나 부상 위험은 아닙니다. 화살표는 발에서 올라간 쪽의 중력 대비 기울기를 나타내며, 실제 3차원 관절 자세나 수평 회전은 측정하지 않습니다. 화면에서 범위 밖이 분명히 보이도록 바깥쪽 표시 간격을 조정합니다.</p><p>정지에 가까운 값만 비교합니다. 걷거나 크게 흔들리면 점을 숨겨요. 빨간 점은 기록 범위 초과, 이탈 기록은 범위 + 5°를 1초 이상 초과했을 때 남습니다. 센서를 다시 착용하면 기준을 다시 맞추세요.</p></details>
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
    <p class="today-scope">압력센서의 <b>앞뒤 상대 중심</b>이에요.</p><details class="today-detail" data-ui-disclosure="today-cop-info"><summary>센서 위치와 표시 기준</summary><p>2센서 배치는 센서 1(GPIO34)을 앞쪽, 센서 2(GPIO35)를 뒤쪽으로 사용합니다. 반대로 부착하면 앞뒤 표시도 바뀝니다. 물리 센서를 한 번씩만 사용하며, 보정 후에는 센서별 보행 최고값 대비 비율로 계산합니다. 4칸 히트맵의 파생값은 계산에 쓰지 않습니다.</p><p>실제 힘으로 보정된 2D CoP나 체중 비율이 아닙니다. 약한 압력·연결 끊김은 점을 숨깁니다. 독립 4센서는 가운데 두 점을 포함한 앞뒤 가중 중심을 표시합니다.</p></details>${button('압력·온습도 보기', 'safety')}
  </section>`;
}

export function renderTodaySummary(state, now = Date.now()) {
  const connection = connectionSummary(state);
  return `<section class="today-dashboard" aria-label="오늘 요약"><header class="today-heading"><div><span class="today-kicker">TODAY · STEPON</span><h1>오늘 요약</h1><p>보행 신호, 발의 움직임, 압력 중심을 한눈에.</p></div><span class="today-connection"><i></i>${e(connection.label)}</span></header>
    <div class="today-grid">${fogCard(state, now)}${rangeCard(state, now)}${copCard(state, now)}</div>
    <div class="today-footer"><p class="today-footer-note">새로 수신한 유효값만 표시합니다. 파란 점은 기록 범위 안이라는 뜻이며, 의학적 안전 판정은 아닙니다.</p>${button('정면 보행 보기', 'mediapipe')}</div></section>`;
}
