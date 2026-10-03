import { escapeHtml as e } from './utils/text.js';
import { RECORD_TABS } from './views/records-view.js';
import { readFrontRecords } from './mediapipe/front-records.js';
import { renderTrendsContent } from './views/trends-view.js';
import { mountTrendWorkspace } from './trends/trend-controller.js';

const stamp = value => Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('ko-KR', {timeZone:'Asia/Seoul'}) : '시각 미확인';
const number = value => typeof value === 'number' && Number.isFinite(value) ? String(value) : '—';
const foot = value => value === 'left' ? '왼발' : value === 'right' ? '오른발' : '발 구분 없음';
const empty = (title, text) => `<div class="records-empty"><b>${title}</b><p>${text}</p></div>`;
const head = (title, description, actions = '') => `<header class="records-panel-heading"><div><h2>${title}</h2><p>${description}</p></div><div class="records-actions">${actions}</div></header>`;
const refresh = '<button type="button" data-record-action="refresh">새로고침</button>';
const exportButton = (disabled = false) => `<button type="button" data-record-action="export" ${disabled?'disabled':''}>JSON 내려받기</button>`;
const table = (headers, rows) => `<div class="records-table-wrap"><table><thead><tr>${headers.map(h=>`<th scope="col">${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>`;

export function renderFrontRecords(records) {
  return head('홈재활 걸음 관찰', '이 브라우저 · 최근 20건 / 최대 30일 · 영상 저장 안 함', `${refresh}${exportButton(!records.length)}<button type="button" data-view="mediapipe">홈재활 시작하기 →</button>`)
    + `<div class="records-explainer">처음 자세와 비교한 <b>골반선·몸통·무릎–발목 선의 변화</b>입니다. 직접 인식과 보간 시간을 나누고, 최대 변화는 직접 인식값만 사용합니다. 이전 기록에 없던 부위는 —로 표시합니다.</div>`
    + (records.length ? table(['관찰 시각','관찰 길이','기록 상태','직접 인식 / 보간','최대 변화 · 실측','변화가 이어진 시간'], [...records].reverse().map(r=>`<tr><td>${stamp(r.at)}</td><td>${number(r.plannedSeconds??20)}초</td><td><span class="records-state ${r.eligible?'':'is-review'}">${r.eligible?'관찰 완료':'부분 기록 / 중단'}</span></td><td>${r.validSeconds!==undefined?`${number(r.validSeconds)}초 / ${number(r.interpolatedSeconds??0)}초`:`${number(r.ratio)}% / —`}</td><td>${[['pelvis','골반'],['ankleLeft','왼발'],['ankleRight','오른발'],['trunk','몸통']].map(([key,label])=>`<small>${label} ${r.metrics?.[key]?.available?`${number(r.metrics[key].peak)}°`:'—'}</small>`).join('')}</td><td>${number(r.changedSeconds)}초</td></tr>`)) : empty('아직 홈재활 기록이 없어요.', '2초 기준 자세를 맞추고 10초간 걸음을 관찰해요. 휴대폰과 PC 브라우저의 기록은 서로 다릅니다.'));
}
export function renderAnkleRecords(data) {
  return head('오늘의 발 움직임', `${e(data.day)} · PC 저장 · 오늘의 이탈 기록만 표시`, `${refresh}${exportButton(!data.events.length)}<button type="button" data-view="ankle">양발 기준 · 실시간 보기 →</button>`)
    + `<div class="records-foot-cards">${['left','right'].map(side=>{const f=data.feet?.[side];return `<article><span>${foot(side)} 기울기 기준</span><strong>${f?.plan?`0–${number(f.plan.max)}°`:'기준 기록 필요'}</strong><small>${f?.plan?`기준 시각 ${stamp(f.plan.at)}`:'발 움직임 화면에서 오늘 기준을 기록하세요.'}</small></article>`;}).join('')}</div>`
    + `<p class="records-explainer">BMI가 기록한 발 기울기입니다. 이탈 당시 센서 X·Y 축을 표시하며, 이 값만으로 실제 발목 자세나 부상 여부를 확정하지 않습니다.</p>`
    + (data.events.length ? table(['이탈 시각','발','최대 기울기','이탈 기준선','센서 축 X / Y'], data.events.map(r=>`<tr><td>${stamp(r.at)}</td><td>${foot(r.side)}</td><td><b>${number(r.peak)}°</b></td><td>${number(r.threshold)}°</td><td>${number(r.sensorX)}° / ${number(r.sensorY)}°</td></tr>`)) : empty('오늘 저장된 이탈 기록이 없어요.', '양발 기준을 기록하고 센서를 연결한 동안 비교합니다. 연결이 끊긴 시간의 이탈 여부는 알 수 없어요.'));
}
export function renderFogRecords(data) {
  const states={complete:'완료',failed:'실패',interrupted:'중단',running:'분석 중',recording:'기록 중',countdown:'준비 중'};
  return head('FOG 분석 자료', 'PC 저장 · 별도로 수집한 BMI 원시 기록과 CSV 분석 결과', `${refresh}<button type="button" data-view="devices" data-open-disclosure="device-baselines">개인 보정 →</button><a href="/data/">CSV 수집·분석 도구 ↗</a>`)
    + '<div class="records-explainer">실시간 FOG 감지는 <b>AI 보행동결</b>에서 확인하세요. 이 목록에는 CSV 도구로 저장한 자료가 나타납니다.<button type="button" data-view="live">실시간 점수 확인 →</button></div>'
    + (data.items.length ? table(['자료','측정 정보','상태','파일'], data.items.map(item=>{
      const recording=item.kind==='recording', complete=item.status==='complete', id=encodeURIComponent(item.id);
      return `<tr><td><b>${recording?(item.purpose==='calibration'?'BMI 보정 기록':'BMI 측정 기록'):'FOG 분석 결과'}</b><small>${e(item.id)}</small></td><td>${e(item.metadata?.participant_id || '측정 코드 미확인')} · ${foot(item.metadata?.side || item.foot)}<small>${e(item.metadata?.session_id || '')}</small></td><td>${e(states[item.status] || '확인 필요')}</td><td>${complete?`<a download href="/api/ai/datasets/${id}/${recording?'recording.csv':'windows.csv'}">${recording?'원시 기록 CSV':'시간별 점수 CSV'} ↓</a>`:'완료 후 다운로드'}</td></tr>`;
    })) : empty('저장한 CSV 자료가 없어요.', 'CSV 수집·분석 도구에서 BMI 보정 기록과 측정 기록을 저장하면 여기에 나타납니다.'));
}

export function mountRecordsWorkspace(root, getState, context = {}) {
  const abort = new AbortController(), panel=root.querySelector('#records-panel');
  let alive=true, generation=0, selected='', trend=null, trendContext=context.trendContext||null, exported=null, archive=null;
  async function request(path) {
    const response=await fetch(path,{cache:'no-store',signal:AbortSignal.timeout(7000)});
    if(!response.ok)throw Error('기록 서버에 연결하지 못했어요. PC 프로그램을 확인한 뒤 다시 시도하세요.');
    return response.json();
  }
  function save(value,name) {
    const url=URL.createObjectURL(new Blob([JSON.stringify(value,null,2)],{type:'application/json'})), link=document.createElement('a');
    link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  async function select(id, focus=false) {
    if(!RECORD_TABS.some(t=>t.id===id))return;
    if(trend && !trend.canLeave())return;
    if(trend){trendContext=trend.getContext();trend.destroy();trend=null;}
    selected=id;const token=++generation;exported=null;
    for(const button of root.querySelectorAll('[data-record-tab]')){const active=button.dataset.recordTab===id;button.setAttribute('aria-selected',String(active));button.tabIndex=active?0:-1;if(active&&focus)button.focus();}
    panel.setAttribute('aria-labelledby',`records-tab-${id}`);
    panel.innerHTML='<p class="records-loading" role="status">기록을 불러오고 있어요.</p>';
    if(id==='sensors') {panel.innerHTML=renderTrendsContent({manage:true,sensorOnly:true});trend=mountTrendWorkspace(panel.querySelector('[data-trends-root]'),getState,trendContext);return;}
    try {
      if(id==='front') {const data=readFrontRecords(window.localStorage);if(data.error)throw Error(data.error);exported={kind:'front-observations',records:data.records};panel.innerHTML=renderFrontRecords(data.records);return;}
      const data=await request(id==='ankle'?'/api/ankle-daily':'/api/ai/datasets');
      if(!alive||token!==generation)return;
      if(id==='ankle') {if(data.version!==1||!Array.isArray(data.events))throw Error('발 움직임 기록 형식을 확인할 수 없어요.');exported={kind:'foot-inclination',day:data.day,feet:data.feet,events:data.events};panel.innerHTML=renderAnkleRecords(data);if(data.storageError)panel.insertAdjacentHTML('afterbegin','<p class="records-error" role="status">일부 기록을 PC에 저장하지 못했어요. 내려받기로 보관하세요.</p>');}
      else {if(!Array.isArray(data.items))throw Error('FOG 자료 목록을 확인할 수 없어요.');panel.innerHTML=renderFogRecords(data);}
    } catch(error) {if(alive&&token===generation)panel.innerHTML=`<div class="records-empty records-error" role="status"><b>기록을 불러오지 못했어요.</b><p>${e(error.message)}</p>${refresh}</div>`;}
  }
  root.addEventListener('click',event=>{const tab=event.target.closest('[data-record-tab]');if(tab){if(tab.dataset.recordTab!==selected)void select(tab.dataset.recordTab);return;}const action=event.target.closest('[data-record-action]')?.dataset.recordAction;if(action==='refresh')void select(selected);if(action==='export'&&exported)save({exportedAt:new Date().toISOString(),...exported},`stepon-${selected}-${Date.now()}.json`);if(action==='archive-export'&&archive)save(archive,`stepon-previous-joints-${Date.now()}.json`);},{signal:abort.signal});
  root.addEventListener('keydown',event=>{const tab=event.target.closest('[data-record-tab]');if(!tab||!['ArrowLeft','ArrowRight','Home','End'].includes(event.key))return;event.preventDefault();const i=RECORD_TABS.findIndex(t=>t.id===tab.dataset.recordTab), n=event.key==='Home'?0:event.key==='End'?RECORD_TABS.length-1:(i+(event.key==='ArrowRight'?1:-1)+RECORD_TABS.length)%RECORD_TABS.length;void select(RECORD_TABS[n].id,true);},{signal:abort.signal});
  root.querySelector('[data-record-archive]').addEventListener('toggle',async event=>{if(!event.target.open||archive)return;const node=root.querySelector('[data-record-archive-content]');node.textContent='이전 자료를 읽고 있어요.';try{const data=await request('/api/rom');if(!alive)return;if(!Array.isArray(data.sessions)||!Array.isArray(data.sets))throw Error('이전 기록 형식 확인 필요');archive=data;node.innerHTML=`<p>관절 기록 <b>${data.sessions.length}개</b> · 촬영 세트 <b>${data.sets.length}개</b></p><button type="button" data-record-action="archive-export" ${!data.sessions.length&&!data.sets.length?'disabled':''}>이전 자료 전체 JSON 내려받기</button>`;}catch{if(alive)node.textContent='이전 자료를 불러오지 못했어요. 닫았다가 다시 열어 주세요.';}},{signal:abort.signal});
  void select(context.selected||'fog');
  return {select,canLeave:()=>trend?trend.canLeave():true,getContext:()=>({selected,trendContext:trend?trend.getContext():trendContext}),destroy(){alive=false;generation++;abort.abort();trend?.destroy();}};
}
