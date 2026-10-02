import { createFrontBaselineCapture } from './front-capture.js';
export const FRONT_CONNECTIONS=[[11,12],[11,13],[13,15],[12,14],[14,16],[11,23],[12,24],[23,24],[23,25],[25,27],[24,26],[26,28],[27,29],[29,31],[28,30],[30,32]];
export function visiblePoint(p, threshold=.7) {return p && [p.x,p.y,p.visibility].every(Number.isFinite) && p.visibility>=threshold && (!Number.isFinite(p.presence)||p.presence>=threshold) && p.x>.015 && p.x<.985 && p.y>.015 && p.y<.985;}
export function analyzeFront(poses,width,height) {
  const fail=(reason,missing=[])=>({valid:false,reason,missing});
  if(!width||!height)return fail('카메라 영상을 기다려요.');
  if(poses?.length!==1)return fail(poses?.length>1?'한 사람만 화면에 들어오세요.':'사람 인식 0명 · 머리부터 발끝까지 화면에 넣어 주세요.');
  // These four landmarks determine pelvis/trunk angles. Leg points are framing
  // guidance, not dependencies of the angle calculation.
  const p=poses[0], ids=[11,12,23,24];
  const names={11:'왼쪽 어깨',12:'오른쪽 어깨',23:'왼쪽 골반',24:'오른쪽 골반',25:'왼쪽 무릎',26:'오른쪽 무릎',27:'왼쪽 발목',28:'오른쪽 발목'};
  const missing=ids.filter(i=>!visiblePoint(p[i]));
  if(missing.length){
    const parts=missing.map(i=>names[i]);
    return fail(`${parts.slice(0,3).join('·')}${parts.length>3?' 등':''} 인식 확인 필요 · 가려지거나 화면 밖으로 나가지 않게 해 주세요.`,parts);
  }
  const xy=i=>({x:p[i].x*width,y:p[i].y*height}), mid=(a,b)=>({x:(a.x+b.x)/2,y:(a.y+b.y)/2});
  const sh=mid(xy(11),xy(12)), hip=mid(xy(23),xy(24)), length=Math.hypot(sh.x-hip.x,sh.y-hip.y);
  if(length<height*.15 || hip.y<=sh.y)return fail('카메라를 세우고 정면으로 서 주세요. 몸이 너무 작게 보이면 가까이 이동하세요.');
  const span=(Math.hypot(xy(11).x-xy(12).x,xy(11).y-xy(12).y)+Math.hypot(xy(23).x-xy(24).x,xy(23).y-xy(24).y))/2;
  if(span/length<.4 || !visiblePoint(p[0],.5))return fail('얼굴과 두 어깨가 보이도록 카메라 정면을 향해 주세요.');
  const left=xy(23),right=xy(24),dx=Math.abs(left.x-right.x);
  if(dx<width*.04)return fail('골반 양쪽을 구분하기 어려워요. 정면을 향해 주세요.');
  const supportMissing=[25,26,27,28].filter(i=>!visiblePoint(p[i])).map(i=>names[i]);
  return {valid:true,reason:supportMissing.length?'어깨·골반 인식됨 · 가능하면 무릎과 양발도 보여 주세요.':'어깨·골반 인식 완료',supportMissing,
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
  return {pelvis,trunk,changed:Math.abs(pelvis)>5||Math.abs(trunk)>8};
}
export function drawFrontPose(ctx,poses,width,height) {
  ctx.clearRect(0,0,width,height);
  for(const p of poses||[]) {
    for(const [a,b] of FRONT_CONNECTIONS) {
      if(!visiblePoint(p[a],.35)||!visiblePoint(p[b],.35))continue;
      const sure=visiblePoint(p[a])&&visiblePoint(p[b]);
      ctx.strokeStyle=sure?(a===23&&b===24?'#81c9e1':'#76d4b3'):'#f0ad9f';ctx.lineWidth=4;ctx.setLineDash(sure?[]:[8,6]);
      ctx.beginPath();ctx.moveTo(p[a].x*width,p[a].y*height);ctx.lineTo(p[b].x*width,p[b].y*height);ctx.stroke();
    }
    ctx.setLineDash([]);
    for(let i=11;i<33;i++)if(visiblePoint(p[i],.35)){ctx.beginPath();ctx.arc(p[i].x*width,p[i].y*height,5,0,Math.PI*2);ctx.fillStyle=visiblePoint(p[i])?'#76d4b3':'#f0ad9f';ctx.fill();ctx.strokeStyle='#183d47';ctx.lineWidth=1.5;ctx.stroke();}
  }
}
