import { createFrontBaselineCapture } from './front-capture.js';
export const FRONT_CONNECTIONS=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
export function visiblePoint(p, threshold=.7) {return p && [p.x,p.y,p.visibility].every(Number.isFinite) && p.visibility>=threshold && (!Number.isFinite(p.presence)||p.presence>=threshold) && p.x>.015 && p.x<.985 && p.y>.015 && p.y<.985;}
export function analyzeFront(poses,width,height) {
  const fail=(reason,missing=[],bridgeable=false)=>({valid:false,reason,missing,bridgeable});
  if(!width||!height)return fail('카메라 영상을 기다려요.');
  if(poses?.length!==1)return fail(poses?.length>1?'한 사람만 화면에 들어오세요.':'사람 인식 대기 · 머리부터 발끝까지 보여 주세요.',[],poses?.length===0);
  // These four landmarks determine pelvis/trunk angles. Leg points are framing
  // guidance, not dependencies of the angle calculation.
  const p=poses[0], ids=[11,12,23,24];
  const names={11:'왼쪽 어깨',12:'오른쪽 어깨',23:'왼쪽 골반',24:'오른쪽 골반',25:'왼쪽 무릎',26:'오른쪽 무릎',27:'왼쪽 발목',28:'오른쪽 발목'};
  const missing=ids.filter(i=>!visiblePoint(p[i]));
  if(missing.length){
    const parts=missing.map(i=>names[i]);
    return fail(`${parts.slice(0,3).join('·')}${parts.length>3?' 등':''} 다시 찾는 중 · 잠깐 끊겨도 관찰은 계속돼요.`,parts,true);
  }
  const xy=i=>({x:p[i].x*width,y:p[i].y*height}), mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const sh=mid(xy(11),xy(12)), hip=mid(xy(23),xy(24)), length=Math.hypot(sh.x-hip.x,sh.y-hip.y);
  if(length<height*.15 || hip.y<=sh.y)return fail('카메라를 세우고 정면으로 서 주세요. 몸이 너무 작게 보이면 가까이 이동하세요.');
  const span=(Math.hypot(xy(11).x-xy(12).x,xy(11).y-xy(12).y)+Math.hypot(xy(23).x-xy(24).x,xy(23).y-xy(24).y))/2;
  if(span/length<.4 || !visiblePoint(p[0],.5))return fail('얼굴과 두 어깨가 보이도록 카메라 정면을 향해 주세요.');
  const left=xy(23),right=xy(24),dx=Math.abs(left.x-right.x);
  if(dx<width*.04)return fail('골반 양쪽을 구분하기 어려워요. 정면을 향해 주세요.');
  const supportMissing=[25,26,27,28].filter(i=>!visiblePoint(p[i])).map(i=>names[i]);
  const leg=(knee,ankle)=>visiblePoint(p[knee])&&visiblePoint(p[ankle])&&xy(ankle).y-xy(knee).y>height*.06
    ? Math.atan2(xy(ankle).x-xy(knee).x,xy(ankle).y-xy(knee).y)*180/Math.PI : null;
  return {valid:true,bridgeable:true,reason:supportMissing.length?'골반은 보여요 · 무릎부터 양발까지 보여 주세요.':'골반과 양발이 잘 보여요',supportMissing,
    anchor:{x:hip.x/width,y:hip.y/height,scale:length/height,facing:Math.sign(right.x-left.x)},
    ankleLeft:leg(25,27),ankleRight:leg(26,28),
    pelvis:Math.atan2(right.y-left.y,dx)*180/Math.PI,trunk:Math.atan2(sh.x-hip.x,hip.y-sh.y)*180/Math.PI};
}
export function frontBaseline(samples) {
  if(!samples.length)return null;
  const capture=createFrontBaselineCapture(samples[0].at);
  for(const sample of samples)capture.push(sample);
  return capture.snapshot(samples.at(-1).at).baseline;
}
export function frontChange(sample,baseline) {
  if(!sample?.valid||!baseline)return null;
  const pelvis=sample.pelvis-baseline.pelvis,trunk=sample.trunk-baseline.trunk;
  const leg=key=>Number.isFinite(sample[key])&&Number.isFinite(baseline[key])?sample[key]-baseline[key]:null;
  const ankleLeft=leg('ankleLeft'),ankleRight=leg('ankleRight');
  return {pelvis,trunk,ankleLeft,ankleRight,changed:Math.abs(pelvis)>5||Math.abs(trunk)>8||Math.abs(ankleLeft)>12||Math.abs(ankleRight)>12};
}
export function drawFrontPose(ctx,poses,width,height,{baseline=null}={}) {
  ctx.clearRect(0,0,width,height);
  for(const p of poses||[]) {
    // Reference lines follow the person's screen position/scale, not a fixed
    // floor coordinate. These are visual comparisons, not a required gait path.
    const guide=(a,b,angle,pelvis=false)=>{
      if(!Number.isFinite(angle)||!visiblePoint(p[a])||!visiblePoint(p[b]))return;
      const x=p[a].x*width,y=p[a].y*height,dx=(p[b].x-p[a].x)*width,dy=(p[b].y-p[a].y)*height;
      const length=Math.hypot(dx,dy),r=angle*Math.PI/180;
      ctx.strokeStyle='#b3dcff';ctx.lineWidth=10;ctx.setLineDash([10,8]);ctx.beginPath();ctx.moveTo(x,y);
      ctx.lineTo(x+(pelvis?Math.sign(dx)*Math.cos(r):Math.sin(r))*length,y+(pelvis?Math.sin(r):Math.cos(r))*length);ctx.stroke();
    };
    if(baseline){guide(23,24,baseline.pelvis,true);guide(25,27,baseline.ankleLeft);guide(26,28,baseline.ankleRight);}
    for(const [a,b] of FRONT_CONNECTIONS) {
      if(!visiblePoint(p[a],.35)||!visiblePoint(p[b],.35))continue;
      const sure=visiblePoint(p[a])&&visiblePoint(p[b])&&!p[a].estimated&&!p[b].estimated;
      ctx.strokeStyle=sure?(a===23&&b===24?'#81c9e1':'#76d4b3'):'#f0ad9f';ctx.lineWidth=4;ctx.setLineDash(sure?[]:[8,6]);
      ctx.beginPath();ctx.moveTo(p[a].x*width,p[a].y*height);ctx.lineTo(p[b].x*width,p[b].y*height);ctx.stroke();
    }
    ctx.setLineDash([]);
    for(let i=11;i<33;i++)if(visiblePoint(p[i],.35)){ctx.beginPath();ctx.arc(p[i].x*width,p[i].y*height,5,0,Math.PI*2);ctx.fillStyle=visiblePoint(p[i])&&!p[i].estimated?'#76d4b3':'#f0ad9f';ctx.fill();ctx.strokeStyle='#183d47';ctx.lineWidth=1.5;ctx.stroke();}
  }
}
