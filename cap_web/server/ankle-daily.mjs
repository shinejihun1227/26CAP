import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { inclination, localDay, neutralFromSamples } from '../src/mediapipe/ankle-monitor.js';
const SIDES = ['left', 'right'];
const round = n => Math.round(n * 10) / 10;
const arr = v => ['x', 'y', 'z'].every(k => typeof v?.[k] === 'number' && Number.isFinite(v[k])) ? [v.x,v.y,v.z] : null;
const blank = () => ({ phase:'idle', message:'기준 자세부터 기록해 주세요.', neutral:null, plan:null, samples:[], lastAt:0, comparedMs:0, startedAt:null, outside:null, activeEvent:null });
export function createAnkleDaily({ directory = null, now = Date.now } = {}) {
  let feet = {left:blank(),right:blank()}, events=[], storageError=null;
  const file = directory && path.join(directory,'events.json');
  const prune = () => { events = events.filter(e => e && ['at','endedAt','peak','sensorX','sensorY','threshold','baselineAt'].every(k=>Number.isFinite(e[k])) && e.at > now()-30*86400000 && e.at<=now() && SIDES.includes(e.side)).slice(-6000); };
  if(file) { try { events=JSON.parse(fs.readFileSync(file,'utf8')); if(!Array.isArray(events))events=[]; prune(); } catch(e) { if(e.code!=='ENOENT') storageError='이전 기록을 읽지 못했습니다.'; } }
  let dirty=false, lastPersist=0;
  function persist() {
    if(!file || !dirty) return;
    try { fs.mkdirSync(directory,{recursive:true}); const temp=file+'.tmp'; fs.writeFileSync(temp,JSON.stringify(events)); fs.renameSync(temp,file); dirty=false; storageError=null; lastPersist=now(); }
    catch { storageError='기록을 파일에 저장하지 못했습니다. PC 저장 공간을 확인하세요.'; }
  }
  function closeEvent(f) { if(f.activeEvent) { f.activeEvent.endedAt=f.lastAt; dirty=true; } f.activeEvent=null; f.outside=null; }
  function tick() {
    const t=now();
    for(const f of Object.values(feet)) {
      if(f.plan && f.plan.day!==localDay(t)) { closeEvent(f); f.plan=null; f.neutral=null; f.current=null; f.startedAt=null; f.comparedMs=0; f.phase='idle'; f.message='날짜가 바뀌었어요. 기준을 다시 기록하세요.'; }
      if(f.lastAt && t-f.lastAt>1000) { closeEvent(f); f.current=null; f.state='offline'; if(f.phase==='neutral')f.samples=[]; }
      if(['neutral','range'].includes(f.phase) && t-f.captureAt >= (f.phase==='neutral'?3000:15000)) {
        if(f.phase==='neutral') {
          f.neutral=neutralFromSamples(f.samples);
          f.phase=f.neutral?'neutral-ready':'failed'; f.message=f.neutral?'기준 완료 · 이제 15초 움직임을 기록하세요.':'3초간 가만히 두고 다시 시도하세요.';
        } else {
          const good=f.samples.filter(s=>s.ok && s.deviceId===f.neutral?.deviceId && s.bootId===f.neutral?.bootId);
          const angles=good.map(s=>inclination(f.neutral.vector,s.accel)).sort((a,b)=>a-b);
          const peak=angles[Math.floor((angles.length-1)*.95)];
          if(good.length>=30 && good.at(-1).at-good[0].at>=6000 && peak>=5 && peak-angles[0]>=3) {
            f.plan={id:randomUUID(),day:localDay(t),at:t,neutral:f.neutral.vector,deviceId:f.neutral.deviceId,bootId:f.neutral.bootId,max:round(peak),margin:5};
            f.phase='ready'; f.message='오늘 기준 저장 완료'; f.startedAt=t; f.comparedMs=0;
          } else { f.phase='failed'; f.message='유효 움직임이 부족해요. 천천히 움직이고 양끝에서 잠깐 멈춰 다시 기록하세요.'; }
        }
        f.samples=[];
      }
    }
    prune(); if(dirty && t-lastPersist>=1000) persist();
  }
  function observe(side, raw) {
    if(!SIDES.includes(side)) return;
    tick(); const t=now(), f=feet[side], key=`${raw.boot_id}:${raw.frame}`;
    if(f.lastKey===key) return;
    const dt=f.lastAt && t-f.lastAt<=500 && ['within','checking','outside'].includes(f.state) ? t-f.lastAt : 0;
    f.lastAt=t; f.lastKey=key;
    const a=arr(raw.accel), g=arr(raw.gyro);
    const ok=Boolean(raw.imu_ready && a && g && Math.abs(Math.hypot(...a)-1)<=.12 && Math.hypot(...g)<=12);
    const s={ok,at:t,accel:a,deviceId:raw.device_id,bootId:raw.boot_id,key};
    const reference=f.plan||f.neutral;
    if(reference && (reference.deviceId!==s.deviceId || reference.bootId!==s.bootId)) { closeEvent(f); f.plan=null; f.neutral=null; f.samples=[]; f.startedAt=null; f.comparedMs=0; f.phase='failed'; f.message='기기 또는 전원이 바뀌었어요. 기준을 다시 맞추세요.'; }
    f.state=ok?'quiet':raw.imu_ready?'moving':'unavailable'; f.current=null;
    if(['neutral','range'].includes(f.phase)) {
      if(f.phase==='neutral' && !ok) f.samples=[];
      if(ok && f.samples.length<1200) f.samples.push(s);
      return;
    }
    if(!ok || !f.plan) { closeEvent(f); return; }
    const tilt=inclination(f.plan.neutral,a);
    const delta=(i)=>{const rawAngle=(Math.atan2(a[i],a[2])-Math.atan2(f.plan.neutral[i],f.plan.neutral[2]))*180/Math.PI;return round((rawAngle+540)%360-180);};
    f.current={tilt:round(tilt),x:delta(0),y:delta(1)}; f.comparedMs+=dt;
    if(tilt<=f.plan.max+f.plan.margin) { closeEvent(f); f.state='within'; return; }
    if(!f.outside || !dt) f.outside={at:t,count:0};
    f.outside.count++; f.state='checking';
    if(t-f.outside.at<1000 || f.outside.count<3) return;
    f.state='outside';
    if(!f.activeEvent) {
      if(events.filter(e=>localDay(e.at)===localDay(t)).length>=200) { f.message='오늘 표시 가능한 이벤트 200개에 도달했습니다.'; return; }
      f.activeEvent={id:randomUUID(),side,at:f.outside.at,endedAt:t,peak:round(tilt),sensorX:f.current.x,sensorY:f.current.y,threshold:f.plan.max+5,planId:f.plan.id,baselineAt:f.plan.at};
      events.push(f.activeEvent);
    }
    f.activeEvent.endedAt=t;
    if(tilt>f.activeEvent.peak) Object.assign(f.activeEvent,{peak:round(tilt),sensorX:f.current.x,sensorY:f.current.y});
    dirty=true;
  }
  function command(side, action, hub) {
    if(!SIDES.includes(side)) throw Error('왼발 또는 오른발을 선택하세요.');
    tick(); const f=feet[side], foot=hub.feet?.[side];
    if(action==='cancel') { closeEvent(f); feet[side]=blank(); persist(); return; }
    if(!foot?.connected || foot.age_ms>1000 || !foot.state?.imu_ready) throw Error('선택한 발의 BMI270 연결을 먼저 확인하세요.');
    if(['neutral','range'].includes(f.phase)) throw Error('진행 중인 기록을 먼저 마치거나 취소하세요.');
    if(action==='neutral') { closeEvent(f); feet[side]=Object.assign(blank(),{phase:'neutral',captureAt:now(),message:'발을 편히 놓고 3초 가만히 있어요.'}); }
    else if(action==='range') {
      if(!f.neutral || now()-f.neutral.at>600000 || f.neutral.deviceId!==foot.state.device_id || f.neutral.bootId!==foot.state.boot_id) throw Error('3초 기준 자세를 먼저 맞추세요.');
      Object.assign(f,{phase:'range',captureAt:now(),samples:[],plan:null,message:'15초간 발끝을 천천히 위아래로 움직이고 양끝에서 잠깐 멈추세요.'});
    } else throw Error('지원하지 않는 동작입니다.');
  }
  function snapshot() {
    tick(); const t=now();
    return {version:1,day:localDay(t),storageError,scope:'foot-inclination-quiet-only',feet:Object.fromEntries(SIDES.map(side=>{
      const f=feet[side]; return [side,{phase:f.phase,state:f.lastAt && t-f.lastAt<1000?f.state:'offline',message:f.message,elapsed:['neutral','range'].includes(f.phase)?Math.min(f.phase==='neutral'?3:15,(t-f.captureAt)/1000):0,plan:f.plan?{max:f.plan.max,margin:5,at:f.plan.at}:null,current:f.current,comparedSeconds:Math.floor(f.comparedMs/1000),monitoringSeconds:f.startedAt?Math.floor((t-f.startedAt)/1000):0}];})), events:events.filter(e=>localDay(e.at)===localDay(t)).slice().reverse()};
  }
  return {observe,tick,command,snapshot,flush:persist};
}
export function createAnkleDailyHandler(monitor,hub) {
  return async(req,res)=>{
    const reply=(status,body)=>{res.writeHead(status,{'content-type':'application/json; charset=utf-8','cache-control':'no-store'});res.end(JSON.stringify(body));};
    try {
      if(req.headers['sec-fetch-site']==='cross-site' || (req.headers.origin && new URL(req.headers.origin).host!==req.headers.host)) return reply(403,{error:'cross_origin_denied'});
      if(req.method==='GET') return reply(200,monitor.snapshot());
      if(req.method!=='POST') return reply(405,{error:'method_not_allowed'});
      if(!String(req.headers['content-type']).startsWith('application/json')) return reply(415,{error:'json_required'});
      let text='';for await(const part of req){text+=part;if(text.length>2048)return reply(413,{error:'body_too_large'});}
      const body=JSON.parse(text||'{}');monitor.command(body.side,body.action,hub.snapshot());reply(200,monitor.snapshot());
    } catch(e){reply(400,{error:e.message});}
  };
}
