import { analyzeFront, frontChange, drawFrontPose, visiblePoint } from './front-pose.js';
import { createFrontPoseContinuity, createFrontGuidance, FRONT_METRICS } from './front-temporal.js';
import { createFrontBaselineCapture, summarizeFrontObservation, FRONT_FRESH_MS, BASELINE_HOLD_MS, FRONT_OBSERVATION_MS } from './front-capture.js';
import { cameraMediaConstraints, cameraErrorMessage } from './rom-controller.js';
import { FRONT_RECORD_KEY as KEY, readFrontRecords } from './front-records.js';
export function mountFrontCamera(root, { storage = localStorage } = {}) {
  const $=s=>root.querySelector(s), button=a=>$(`[data-front-action=${a}]`), video=$('[data-front-video]'), canvas=$('[data-front-canvas]'),ctx=canvas.getContext('2d'),abort=new AbortController();
  let alive=true,starting=false,running=false,stream,worker,animation,generation=0,busy=false,sentAt=0,videoTime=-1,at=0,result=null,baseline=null,calibration=null,record=null,watchdog,permissionTimer,records=[],sampleAt=0,startupReject=null;
  let completed=null, saveError=false, display={poses:[],held:[]}, cues=[];
  const continuity=createFrontPoseContinuity(visiblePoint), guidance=createFrontGuidance();
  const secondsText=value=>Number.isFinite(value)?value.toFixed(1):'—';
  const baselineSeconds=BASELINE_HOLD_MS/1000, observationSeconds=FRONT_OBSERVATION_MS/1000;
  const copy=(selector,value)=>{const node=$(selector);if(node&&node.textContent!==value)node.textContent=value;};
  records=readFrontRecords(storage).records;
  const status=t=>{$('[data-front-runtime]').textContent=t;};
  const fresh=()=>running&&result?.valid&&performance.now()-sampleAt<FRONT_FRESH_MS;
  function history(){const node=$('[data-front-history]');node.replaceChildren();if(!records.length){node.textContent='첫 걸음 관찰을 함께 시작해요.';return;}for(const r of records.slice().reverse()){const row=document.createElement('div');row.className='front-history-row';row.textContent=`${new Date(r.at).toLocaleString('ko-KR')} · ${r.plannedSeconds??20}초 · ${r.eligible?'관찰 완료':'확인된 부분만 기록'} · 직접 인식 ${secondsText(r.validSeconds)}초 / 보간 ${secondsText(r.interpolatedSeconds??0)}초`;node.append(row);}}
  function controls(){button('start').disabled=starting||running||!$('[data-front-consent]').checked;button('stop').disabled=!starting&&!running;button('baseline').disabled=!fresh()||Boolean(calibration||record);button('record').disabled=!fresh()||!baseline||Boolean(calibration||record);button('abort').hidden=!record;button('cancel-baseline').hidden=!calibration;$('[data-front-consent]').disabled=starting||running;$('[data-front-device]').disabled=starting||running;
    copy('[data-front-action=record]',record?'관찰 중…':completed?`${observationSeconds}초 다시 관찰`:`${observationSeconds}초 관찰 시작`);
    const step=record||baseline?3:running?2:1;
    for(const node of root.querySelectorAll('[data-front-step]'))node.classList.toggle('is-current',Number(node.dataset.frontStep)===step&&!completed);
    root.querySelector('.front-feedback').classList.toggle('is-complete',Boolean(completed?.eligible));
  }
  function feedback(){
    copy('[data-front-quality]',result?.reason||'카메라를 켜고 정면을 봐 주세요.');
    const source=display.held.length?'잠깐 끊긴 점 연결 중 · 실측 대기':fresh()?'직접 인식 중':'관절점을 찾고 있어요';
    copy('[data-front-source]',completed?`직접 인식 ${secondsText(completed.validSeconds)}초 · 보간 ${secondsText(completed.interpolatedSeconds??0)}초`:source);
    const selectors={pelvis:'pelvis',trunk:'trunk',ankleLeft:'left',ankleRight:'right'};
    const change=fresh()?frontChange(result,baseline):null;
    for(const key of FRONT_METRICS){
      const part=selectors[key], metric=completed?.metrics?.[key];
      const value=completed?(metric?.available?metric.peak:null):change?.[key];
      copy(`[data-front-${part}]`,Number.isFinite(value)?`${Math.abs(value).toFixed(1)}°`:'—');
      copy(`[data-front-${part}-state]`,completed?metric?.available?'확인한 변화 · 최대':'이 부위는 인식 부족'
        :!baseline?'기준을 맞춰 주세요':!Number.isFinite(baseline[key])?'이 부위 기준 다시 맞추기'
        :!Number.isFinite(value)?'잠시 인식 대기':cues.includes(key)?'기준과 차이 확인':'기준과 비교 중');
      $(`[data-front-metric="${key}"]`)?.classList.toggle('is-changed',!completed&&cues.includes(key));
    }
    if(completed){
      copy('[data-front-result-label]',`이번 ${observationSeconds}초 관찰 결과`);
      const anyPart=Object.values(completed.metrics??{}).some(m=>m.available);
      copy('[data-front-feedback]',completed.eligible?'오늘의 걸음 관찰을 마쳤어요':completed.reason==='interrupted'?'잠시 쉬어 가요':anyPart?'보인 부분은 기록했어요':'다음에 다시 함께 살펴요');
      const missingLegs=[['ankleLeft','왼발'],['ankleRight','오른발']].filter(([k])=>!completed.metrics?.[k]?.available).map(([,label])=>label);
      copy('[data-front-next]',`${completed.eligible?(missingLegs.length?`${missingLegs.join('·')}은 인식이 부족했어요. 확인된 부위의 결과는 아래에서 살펴요.`:`기준과 차이가 이어진 시간 ${completed.changedSeconds}초. 편안했던 걸음을 돌아보세요.`):anyPart?'전체 비교에는 인식이 더 필요해요. 확인된 부위의 결과는 아래에 남겼어요.':'이번에는 비교할 만큼 인식되지 않았어요. 머리부터 양발까지 보이게 다시 준비해요.'}${saveError?' 저장하지 못했어요. 화면을 확인해 주세요.':''}`);
      copy('[data-front-pelvis-label]','골반선 변화 · 최대');copy('[data-front-trunk-label]','몸통 변화 · 최대');
      root.querySelector('.front-feedback').classList.toggle('is-changed',!completed.eligible);
      return;
    }
    copy('[data-front-result-label]','처음 자세와 실시간 비교');
    copy('[data-front-pelvis-label]','골반선 변화');copy('[data-front-trunk-label]','몸통 기울기 변화');
    const sustained=fresh()&&cues.length>0, names={pelvis:'골반선',trunk:'몸통',ankleLeft:'왼쪽 발목 위치',ankleRight:'오른쪽 발목 위치'};
    $('[data-front-feedback]').textContent=!fresh()?(display.held.length?'잠깐 끊겨도 이어서 관찰해요':'몸 위치를 다시 찾고 있어요'):!baseline?'준비됐어요. 기준을 맞춰 볼까요?':sustained?`${names[cues[0]]}가 기준과 달라요`:'편안한 걸음을 함께 살펴요';
    $('[data-front-next]').textContent=sustained?'무리해서 선에 맞추지 마세요. 편한 곳에서 멈춰 자세와 카메라 위치를 확인해요.':!baseline?'편하게 선 자세를 2초 동안 기록해요.':'하늘색은 처음 자세예요. 평소 안내받은 방식으로 편하게 걸어요.';
    root.querySelector('.front-feedback').classList.toggle('is-changed',Boolean(sustained));
  }
  function finish(interrupted=false){
    if(!record)return;
    const r=record;record=null;
    const item={at:Date.now(),...summarizeFrontObservation(r.samples,r.started,performance.now(),interrupted)};
    completed=item;saveError=false;
    records.push(item);records=records.slice(-20);
    try{storage.setItem(KEY,JSON.stringify(records));}catch{saveError=true;}
    history();$('[data-front-record]').textContent=item.eligible?'완료 · 아래에서 함께 확인해요.':'확인된 부위만 저장했어요. 쉬었다가 다시 해도 좋아요.';
    updateProgress(performance.now());feedback();controls();
  }
  function updateBaseline(time){
    if(!calibration)return;
    const capture=calibration.snapshot(time);
    $('[data-front-baseline-progress]').value=capture.heldMs/1000;
    $('[data-front-baseline]').textContent=`${(capture.heldMs/1000).toFixed(1)} / ${baselineSeconds}초 · ${capture.reason}`;
    copy('[data-front-countdown]',`${Math.max(0,(BASELINE_HOLD_MS-capture.heldMs)/1000).toFixed(1)}`);
    if(capture.done){
      baseline=capture.baseline;calibration=null;
      $('[data-front-baseline]').textContent=baseline?['ankleLeft','ankleRight'].every(k=>Number.isFinite(baseline[k]))?'준비 완료 · 이제 관찰을 시작하세요.':'골반 기준 완료 · 양발이 보이게 다시 맞추면 발목도 비교해요.':`기준 자세를 저장하지 못했어요. ${!result?.valid?result?.reason||capture.reason:`안정된 인식 ${baselineSeconds}초를 모으지 못했어요. 어깨와 골반이 보이는지 확인하세요.`}`;
      $('[data-front-record]').textContent=baseline?`준비 완료 · ${observationSeconds}초만 편하게 움직이세요.`:'기준 자세를 먼저 맞춰 주세요.';
      feedback();controls();
    }
  }
  function stop(){continuity.reset();guidance.reset();cues=[];display={poses:[],held:[]};generation++;startupReject?.(Error("카메라 준비를 중단했어요."));startupReject=null;starting=false;running=false;clearTimeout(watchdog);clearTimeout(permissionTimer);if(record)finish(true);calibration=null;baseline=null;cancelAnimationFrame(animation);worker?.terminate();worker=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;result=null;at=0;sampleAt=0;busy=false;$('[data-front-baseline-progress]').value=0;$('[data-front-baseline]').textContent='카메라 위치가 바뀌면 다시 맞춰 주세요.';drawFrontPose(ctx,[],canvas.width,canvas.height);$('[data-front-empty]').hidden=false;feedback();controls();}
  async function listCameras(){try{const current=$('[data-front-device]').value,devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');const select=$('[data-front-device]');select.replaceChildren(new Option('기본 카메라',''));devices.forEach((d,i)=>select.append(new Option(d.label||`카메라 ${i+1}`,d.deviceId)));select.value=current;}catch{ /* default camera remains usable */ }}
  async function start(){if(starting||running||!$('[data-front-consent]').checked)return;if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){status('카메라는 PC의 localhost 또는 HTTPS 주소에서 열어 주세요.');return;}const token=++generation;starting=true;controls();status('MediaPipe 모델 준비 중…');
    try{worker=new Worker(new URL('./pose-worker.js',import.meta.url));await new Promise((resolve,reject)=>{startupReject=reject;watchdog=setTimeout(()=>reject(Error('모델 준비 시간이 초과됐어요.')),25000);worker.onerror=e=>{if(starting)reject(Error(e.message||'모델 실행 실패'));else{stop();status('모델 실행이 중단됐어요. 카메라를 다시 켜 주세요.');}};worker.onmessage=({data})=>{if(!alive||token!==generation)return;if(data.type==='ready'){clearTimeout(watchdog);startupReject=null;resolve();}else if(data.type==='error'){if(starting)reject(Error(data.message));else{stop();status(data.message);}}else if(data.type==='result'&&running){busy=false;at=performance.now();sampleAt=data.timestamp;
          result=analyzeFront(data.poses,video.videoWidth,video.videoHeight);
          const lag=at-sampleAt, stale=!Number.isFinite(sampleAt)||lag<0||lag>=FRONT_FRESH_MS;
          if(stale)result={valid:false,bridgeable:false,reason:'분석이 느려요. 다른 앱을 닫고 다시 확인하세요.'};
          display=continuity.update(stale?[]:data.poses,result,sampleAt);
          if(display.discontinuous){
            if(record)finish(true);
            baseline=null;calibration=null;guidance.reset();cues=[];
            $('[data-front-baseline-progress]').value=0;
            copy('[data-front-baseline]','사람 수나 위치가 크게 바뀌었어요. 기준부터 다시 맞춰 주세요.');
          }
          drawFrontPose(ctx,display.poses,canvas.width,canvas.height,{baseline});
          status(display.held.length?'짧은 끊김을 연결하고 있어요. 확인되면 다시 실측해요.':result.valid?'골반·발목 위치를 함께 관찰해요.':'카메라 연결됨 · 몸 위치를 다시 찾고 있어요.');
          if(calibration){calibration.push({...result,at:sampleAt});updateBaseline(at);}
          const change=fresh()?frontChange(result,baseline):null;
          cues=guidance.update(change,sampleAt);
          feedback();
          if(record&&sampleAt>=record.started){record.samples.push({at:sampleAt,valid:Boolean(change),...change,
            anchor:result.anchor,bridgeable:result.bridgeable!==false,changed:cues.length>0});}
          controls();}};worker.postMessage({type:'init'});});
      if(!alive||token!==generation)return;status('카메라 권한을 허용해 주세요.');const permission=navigator.mediaDevices.getUserMedia(cameraMediaConstraints($('[data-front-device]').value));permission.then(s=>{if(!alive||token!==generation)s.getTracks().forEach(t=>t.stop());},()=>{});const acquired=await Promise.race([permission,new Promise((_,reject)=>{startupReject=reject;permissionTimer=setTimeout(()=>reject(Error('카메라 권한 대기 시간이 초과됐어요.')),30000);})]);clearTimeout(permissionTimer);startupReject=null;if(!alive||token!==generation){acquired.getTracks().forEach(t=>t.stop());return;}stream=acquired;video.srcObject=stream;await video.play();if(!alive||token!==generation)return;canvas.width=video.videoWidth;canvas.height=video.videoHeight;$('[data-front-stage]').style.aspectRatio=`${canvas.width}/${canvas.height}`;$('[data-front-empty]').hidden=true;starting=false;running=true;sentAt=0;videoTime=-1;for(const track of stream.getVideoTracks())track.addEventListener('ended',()=>{if(running){stop();status('카메라 연결이 끊겼어요.');}},{once:true});void listCameras();controls();
      const loop=async time=>{if(!alive||!running||token!==generation)return;animation=requestAnimationFrame(loop);if(busy||time-sentAt<100||video.readyState<2||video.currentTime===videoTime)return;busy=true;sentAt=time;videoTime=video.currentTime;try{const bitmap=await createImageBitmap(video);if(!alive||!running||token!==generation){bitmap.close();return;}worker.postMessage({type:'frame',bitmap,timestamp:time},[bitmap]);}catch(e){stop();status(cameraErrorMessage(e));}};animation=requestAnimationFrame(loop);
    }catch(e){if(alive&&token===generation){stop();status(cameraErrorMessage(e));}}
  }
  function updateProgress(time){
    const overlay=$('[data-front-timer]');overlay.hidden=!record&&!calibration;
    copy('[data-front-timer-label]',calibration?'가만히 서 주세요':'관찰 중 · 남은 시간');
    if(record){
      const elapsed=Math.min(FRONT_OBSERVATION_MS,time-record.started), summary=summarizeFrontObservation(record.samples,record.started,time);
      $('[data-front-progress]').value=elapsed/1000;
      copy('[data-front-countdown]',((FRONT_OBSERVATION_MS-elapsed)/1000).toFixed(1));
      copy('[data-front-record]',`${(elapsed/1000).toFixed(1)} / ${observationSeconds}초 · ${fresh()?'잘 보이고 있어요':'어깨·골반을 화면에 넣어 주세요'}`);
      copy('[data-front-coverage]',`직접 인식 ${secondsText(summary.validSeconds)}초 · 보간 ${secondsText(summary.interpolatedSeconds)}초`);
    }else copy('[data-front-coverage]',completed?`직접 인식 ${secondsText(completed.validSeconds)}초 · 보간 ${secondsText(completed.interpolatedSeconds??0)}초`:`${observationSeconds}초가 지나면 자동으로 끝나요.`);
  }
  const timer=setInterval(()=>{
    if(!alive)return;
    const time=performance.now();
    if(running&&busy&&time-sentAt>8000){stop();status('모델 응답이 멈췄어요. 카메라를 다시 켜 주세요.');}
    if(running&&at&&time-sampleAt>=FRONT_FRESH_MS){result={valid:false,bridgeable:false,reason:'최신 인식 대기 · 관찰을 이어갈 준비 중이에요.'};cues=[];guidance.reset();continuity.reset();display={poses:[],held:[]};drawFrontPose(ctx,[],canvas.width,canvas.height);feedback();controls();}
    else if(running&&display.held.length&&time>=display.expiresAt){display={poses:display.poses.map(p=>p.map(point=>point?.estimated?null:point)),held:[]};drawFrontPose(ctx,display.poses,canvas.width,canvas.height,{baseline});feedback();}
    updateBaseline(time);
    updateProgress(time);
    if(record&&time-record.started>=FRONT_OBSERVATION_MS)finish();
  },200);
  root.addEventListener('change',event=>{if(event.target.matches('[data-front-mirror]'))$('[data-front-stage]').classList.toggle('is-mirrored',event.target.checked);controls();},{signal:abort.signal});
  root.addEventListener('click',event=>{const target=event.target.closest('[data-front-action]');if(!target||target.disabled)return;const action=target.dataset.frontAction;
    if(action==='start'){completed=null;void start();}
    if(action==='stop'){stop();status('카메라를 껐어요.');}
    if(action==='baseline'){completed=null;baseline=null;guidance.reset();cues=[];calibration=createFrontBaselineCapture(performance.now());$('[data-front-baseline-progress]').value=0;$('[data-front-progress]').value=0;updateBaseline(performance.now());updateProgress(performance.now());feedback();controls();}
    if(action==='record'&&fresh()&&baseline){completed=null;guidance.reset();cues=[];record={started:performance.now(),samples:[]};$('[data-front-progress]').value=0;updateProgress(performance.now());feedback();controls();}
    if(action==='cancel-baseline'){calibration=null;baseline=null;$('[data-front-baseline-progress]').value=0;$('[data-front-baseline]').textContent='기준 기록을 취소했어요. 다시 준비해 주세요.';updateProgress(performance.now());controls();}
    if(action==='abort')finish(true);
  },{signal:abort.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||starting)){stop();status('화면을 벗어나 카메라를 껐어요.');}},{signal:abort.signal});window.addEventListener('pagehide',stop,{signal:abort.signal});history();controls();void listCameras();
  return{canLeave:()=>!record||confirm('관찰을 중단하고 이동할까요?'),destroy(){stop();alive=false;abort.abort();clearInterval(timer);}};
}
