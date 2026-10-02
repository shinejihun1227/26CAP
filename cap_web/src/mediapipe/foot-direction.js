import { inclination } from './ankle-monitor.js';

export const RANGE_SECONDS = 10;
export const DIRECTION_SECONDS = 4;
const dot = (a,b) => a.reduce((sum,value,i)=>sum+value*b[i],0);
const unit = v => Array.isArray(v) && v.length===3 && v.every(Number.isFinite) && Math.hypot(...v)>.000001 ? v.map(n=>n/Math.hypot(...v)) : null;
const cross = (a,b) => [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]];

// During the instructed toe-up hold, the gravity change projected on the
// neutral plane identifies the foot's toe axis, regardless of sensor mounting.
// This is a user-performed display reference, not anatomical joint calibration.
export function directionFromToeUp(neutral, samples) {
  const up=unit(neutral?.vector);
  if(!up)return null;
  const good=samples.filter(s=>s.ok && s.deviceId===neutral.deviceId && s.bootId===neutral.bootId
    && unit(s.accel) && inclination(up,s.accel)>=5 && inclination(up,s.accel)<=60);
  if(good.length<8 || good.at(-1).at-good[0].at<400 || new Set(good.map(s=>s.key)).size!==good.length)return null;
  // Require a continuous, stable hold: do not average disconnected fragments.
  if(good.some((s,i)=>i>0 && (s.at<=good[i-1].at || s.at-good[i-1].at>500)))return null;
  const mean=unit([0,1,2].map(i=>good.reduce((sum,s)=>sum+s.accel[i],0)/good.length));
  if(!mean || good.some(s=>inclination(mean,s.accel)>3))return null;
  const forward=unit(mean.map((value,i)=>value-dot(mean,up)*up[i]));
  if(!forward)return null;
  const left=unit(cross(up,forward));
  return {source:'toe-up',up,forward,left,at:good.at(-1).at};
}

export function footDirection(frame,accel,side) {
  const a=unit(accel), up=unit(frame?.up), forward=unit(frame?.forward), left=unit(frame?.left);
  if(frame?.source!=='toe-up' || !a || !up || !forward || !left || !['left','right'].includes(side))return null;
  if(Math.abs(dot(up,forward))>.01 || Math.abs(dot(up,left))>.01 || dot(cross(up,forward),left)<.99)return null;
  const f=dot(a,forward), l=dot(a,left), z=dot(a,up), tilt=inclination(up,a);
  if(tilt>=90)return null; // Beyond this, a raised-side label is ambiguous.
  const forwardDeg=Math.atan2(f,z)*180/Math.PI, leftDeg=Math.atan2(l,z)*180/Math.PI;
  const code=tilt<2?'center':Math.abs(f)>=Math.abs(l)?f>=0?'front':'rear':l>=0?'left':'right';
  const lateral=code==='left'?(side==='left'?'바깥쪽':'안쪽'):(side==='left'?'안쪽':'바깥쪽');
  const label=code==='center'?'기준 자세 부근':code==='front'?'전방 · 발끝 들림':code==='rear'?'후방 · 뒤꿈치 들림':`${lateral} 측면 들림`;
  return {source:'toe-up',code,label,forward:Math.round(forwardDeg*10)/10,left:Math.round(leftDeg*10)/10};
}
