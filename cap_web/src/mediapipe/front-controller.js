import { analyzeFront, frontChange, drawFrontPose } from './front-pose.js';
import { createFrontBaselineCapture, summarizeFrontObservation, FRONT_FRESH_MS, BASELINE_HOLD_MS, FRONT_OBSERVATION_MS } from './front-capture.js';
import { cameraMediaConstraints, cameraErrorMessage } from './rom-controller.js';
import { FRONT_RECORD_KEY as KEY, readFrontRecords } from './front-records.js';
export function mountFrontCamera(root, { storage = localStorage } = {}) {
  const $=s=>root.querySelector(s), button=a=>$(`[data-front-action=${a}]`), video=$('[data-front-video]'), canvas=$('[data-front-canvas]'),ctx=canvas.getContext('2d'),abort=new AbortController();
  let alive=true,starting=false,running=false,stream,worker,animation,generation=0,busy=false,sentAt=0,videoTime=-1,at=0,result=null,baseline=null,calibration=null,record=null,changedAt=null,watchdog,permissionTimer,records=[],sampleAt=0,startupReject=null;
  let completed=null, saveError=false;
  const baselineSeconds=BASELINE_HOLD_MS/1000, observationSeconds=FRONT_OBSERVATION_MS/1000;
  const copy=(selector,value)=>{const node=$(selector);if(node&&node.textContent!==value)node.textContent=value;};
  records=readFrontRecords(storage).records;
  const status=t=>{$('[data-front-runtime]').textContent=t;};
  const fresh=()=>running&&result?.valid&&performance.now()-sampleAt<FRONT_FRESH_MS;
  function history(){const node=$('[data-front-history]');node.replaceChildren();if(!records.length){node.textContent='아직 관찰 기록이 없어요.';return;}for(const r of records.slice().reverse()){const row=document.createElement('div');row.className='front-history-row';row.textContent=`${new Date(r.at).toLocaleString('ko-KR')} · ${r.plannedSeconds??20}초 관찰 · ${r.eligible?'완료':'자료 부족 / 중단'} · 인식 ${r.ratio}% · 기준 변화 ${r.changedSeconds}초`;node.append(row);}}
  function controls(){button('start').disabled=starting||running||!$('[data-front-consent]').checked;button('stop').disabled=!starting&&!running;button('baseline').disabled=!fresh()||Boolean(calibration||record);button('record').disabled=!fresh()||!baseline||Boolean(calibration||record);button('abort').hidden=!record;button('cancel-baseline').hidden=!calibration;$('[data-front-consent]').disabled=starting||running;$('[data-front-device]').disabled=starting||running;
    copy('[data-front-action=record]',record?'관찰 중…':completed?`${observationSeconds}초 다시 관찰`:`${observationSeconds}초 관찰 시작`);
    const step=record||baseline?3:running?2:1;
    for(const node of root.querySelectorAll('[data-front-step]'))node.classList.toggle('is-current',Number(node.dataset.frontStep)===step&&!completed);
    root.querySelector('.front-feedback').classList.toggle('is-complete',Boolean(completed?.eligible));
  }
  function feedback(){
    copy('[data-front-quality]',result?.reason||'카메라를 켜고 정면을 봐 주세요.');
    if(completed){
      copy('[data-front-result-label]',`이번 ${observationSeconds}초 관찰 결과`);
      copy('[data-front-feedback]',completed.eligible?'관찰을 마쳤어요':completed.reason==='interrupted'?'관찰을 중단했어요':'인식이 더 필요해요');
      copy('[data-front-next]',completed.eligible?`인식 ${completed.validSeconds}초 · 기준 변화 ${completed.changedSeconds}초.${saveError?' 브라우저 저장에 실패했어요.':' 이 브라우저에 저장했어요.'}`:completed.reason==='interrupted'?'준비되면 다시 관찰하세요.':`어깨·골반이 보인 시간 ${completed.validSeconds}초 / 필요한 시간 7초. 위치를 맞춘 뒤 다시 관찰하세요.`);
      copy('[data-front-pelvis]',completed.eligible&&completed.pelvisPeak!==null?`${completed.pelvisPeak.toFixed(1)}°`:'—');
      copy('[data-front-trunk]',completed.eligible&&completed.trunkPeak!==null?`${completed.trunkPeak.toFixed(1)}°`:'—');
      copy('[data-front-pelvis-label]','골반선 변화 · 최대');copy('[data-front-trunk-label]','몸통 변화 · 최대');
      root.querySelector('.front-feedback').classList.toggle('is-changed',!completed.eligible);
      return;
    }
    copy('[data-front-result-label]','처음 자세와 실시간 비교');
    copy('[data-front-pelvis-label]','골반선 변화');copy('[data-front-trunk-label]','몸통 기울기 변화');
    const change=fresh()?frontChange(result,baseline):null;const t=performance.now();if(change?.changed){if(changedAt===null)changedAt=t;}else changedAt=null;const sustained=change?.changed&&t-changedAt>=1000;
    $('[data-front-pelvis]').textContent=change?`${Math.abs(change.pelvis).toFixed(1)}°`:'—';$('[data-front-trunk]').textContent=change?`${Math.abs(change.trunk).toFixed(1)}°`:'—';
    $('[data-front-feedback]').textContent=!fresh()?'인식 확인 필요':!baseline?'관절점 인식됨':sustained?'처음 자세와 차이가 보여요':change.changed?'변화를 확인 중이에요':'처음 자세와 비교 중이에요';
    $('[data-front-next]').textContent=sustained?'잠시 멈춰 카메라 수평과 몸 위치를 확인해 주세요.':!baseline?'2번에서 기준 자세를 맞춰 주세요.':'골반 높이·몸통의 화면상 변화를 관찰합니다.';
    root.querySelector('.front-feedback').classList.toggle('is-changed',Boolean(sustained));
  }
  function finish(interrupted=false){
    if(!record)return;
    const r=record;record=null;
    const item={at:Date.now(),...summarizeFrontObservation(r.samples,r.started,performance.now(),interrupted)};
    completed=item;saveError=false;
    records.push(item);records=records.slice(-20);
    try{storage.setItem(KEY,JSON.stringify(records));}catch{saveError=true;}
    history();$('[data-front-record]').textContent=item.eligible?'완료 · 아래에서 이번 결과를 확인하세요.':item.reason==='interrupted'?'중단했어요. 준비되면 다시 시작하세요.':`인식 ${item.validSeconds}초 · 어깨와 골반을 다시 확인하세요.`;
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
      $('[data-front-baseline]').textContent=baseline?'준비 완료 · 이제 관찰을 시작하세요.':`기준 자세를 저장하지 못했어요. ${!result?.valid?result?.reason||capture.reason:`안정된 인식 ${baselineSeconds}초를 모으지 못했어요. 어깨와 골반이 보이는지 확인하세요.`}`;
      $('[data-front-record]').textContent=baseline?`준비 완료 · ${observationSeconds}초만 편하게 움직이세요.`:'기준 자세를 먼저 맞춰 주세요.';
      feedback();controls();
    }
  }
  function stop(){generation++;startupReject?.(Error("카메라 준비를 중단했어요."));startupReject=null;starting=false;running=false;clearTimeout(watchdog);clearTimeout(permissionTimer);if(record)finish(true);calibration=null;baseline=null;cancelAnimationFrame(animation);worker?.terminate();worker=null;stream?.getTracks().forEach(t=>t.stop());stream=null;video.pause();video.srcObject=null;result=null;at=0;sampleAt=0;busy=false;$('[data-front-baseline-progress]').value=0;$('[data-front-baseline]').textContent='카메라 위치가 바뀌면 다시 맞춰 주세요.';drawFrontPose(ctx,[],canvas.width,canvas.height);$('[data-front-empty]').hidden=false;feedback();controls();}
  async function listCameras(){try{const current=$('[data-front-device]').value,devices=(await navigator.mediaDevices.enumerateDevices()).filter(d=>d.kind==='videoinput');const select=$('[data-front-device]');select.replaceChildren(new Option('기본 카메라',''));devices.forEach((d,i)=>select.append(new Option(d.label||`카메라 ${i+1}`,d.deviceId)));select.value=current;}catch{ /* default camera remains usable */ }}
  async function start(){if(starting||running||!$('[data-front-consent]').checked)return;if(!isSecureContext||!navigator.mediaDevices?.getUserMedia){status('카메라는 PC의 localhost 또는 HTTPS 주소에서 열어 주세요.');return;}const token=++generation;starting=true;controls();status('MediaPipe 모델 준비 중…');
    try{worker=new Worker(new URL('./pose-worker.js',import.meta.url));await new Promise((resolve,reject)=>{startupReject=reject;watchdog=setTimeout(()=>reject(Error('모델 준비 시간이 초과됐어요.')),25000);worker.onerror=e=>{if(starting)reject(Error(e.message||'모델 실행 실패'));else{stop();status('모델 실행이 중단됐어요. 카메라를 다시 켜 주세요.');}};worker.onmessage=({data})=>{if(!alive||token!==generation)return;if(data.type==='ready'){clearTimeout(watchdog);startupReject=null;resolve();}else if(data.type==='error'){if(starting)reject(Error(data.message));else{stop();status(data.message);}}else if(data.type==='result'&&running){busy=false;at=performance.now();sampleAt=data.timestamp;
          result=analyzeFront(data.poses,video.videoWidth,video.videoHeight);
          const lag=at-sampleAt, stale=!Number.isFinite(sampleAt)||lag<0||lag>=FRONT_FRESH_MS;
          if(stale)result={valid:false,reason:'분석이 느려요. 다른 앱을 닫고 다시 확인하세요.'};
          drawFrontPose(ctx,stale?[]:data.poses,canvas.width,canvas.height,result);
          status(result.valid?'카메라 연결됨 · 어깨·골반 인식 중':'카메라 연결됨 · 몸 위치를 확인하세요.');
          if(calibration){calibration.push({...result,at:sampleAt});updateBaseline(at);}
          feedback();
          if(record&&sampleAt>=record.started){const change=fresh()?frontChange(result,baseline):null;record.samples.push({at:sampleAt,valid:Boolean(change),pelvis:change?.pelvis,trunk:change?.trunk,changed:Boolean(change?.changed&&changedAt!==null&&at-changedAt>=1000)});}
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
      copy('[data-front-coverage]',`인식된 시간 ${summary.validSeconds}초`);
    }else copy('[data-front-coverage]',completed?`이번 인식률 ${completed.ratio}%`:`${observationSeconds}초가 지나면 자동으로 끝나요.`);
  }
  const timer=setInterval(()=>{
    if(!alive)return;
    const time=performance.now();
    if(running&&busy&&time-sentAt>8000){stop();status('모델 응답이 멈췄어요. 카메라를 다시 켜 주세요.');}
    if(running&&at&&time-sampleAt>=FRONT_FRESH_MS){result={valid:false,reason:'최신 인식 대기 · 점과 선을 잠시 지웠어요.'};changedAt=null;drawFrontPose(ctx,[],canvas.width,canvas.height);feedback();controls();}
    updateBaseline(time);
    updateProgress(time);
    if(record&&time-record.started>=FRONT_OBSERVATION_MS)finish();
  },200);
  root.addEventListener('change',event=>{if(event.target.matches('[data-front-mirror]'))$('[data-front-stage]').classList.toggle('is-mirrored',event.target.checked);controls();},{signal:abort.signal});
  root.addEventListener('click',event=>{const target=event.target.closest('[data-front-action]');if(!target||target.disabled)return;const action=target.dataset.frontAction;
    if(action==='start'){completed=null;void start();}
    if(action==='stop'){stop();status('카메라를 껐어요.');}
    if(action==='baseline'){completed=null;baseline=null;changedAt=null;calibration=createFrontBaselineCapture(performance.now());$('[data-front-baseline-progress]').value=0;$('[data-front-progress]').value=0;updateBaseline(performance.now());updateProgress(performance.now());feedback();controls();}
    if(action==='record'&&fresh()&&baseline){completed=null;changedAt=null;record={started:performance.now(),samples:[]};$('[data-front-progress]').value=0;updateProgress(performance.now());feedback();controls();}
    if(action==='cancel-baseline'){calibration=null;baseline=null;$('[data-front-baseline-progress]').value=0;$('[data-front-baseline]').textContent='기준 기록을 취소했어요. 다시 준비해 주세요.';updateProgress(performance.now());controls();}
    if(action==='abort')finish(true);
  },{signal:abort.signal});
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&(running||starting)){stop();status('화면을 벗어나 카메라를 껐어요.');}},{signal:abort.signal});window.addEventListener('pagehide',stop,{signal:abort.signal});history();controls();void listCameras();
  return{canLeave:()=>!record||confirm('관찰을 중단하고 이동할까요?'),destroy(){stop();alive=false;abort.abort();clearInterval(timer);}};
}
