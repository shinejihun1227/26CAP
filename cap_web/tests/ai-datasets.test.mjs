import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createAiHandler } from '../server/ai-proxy.mjs';
import { captureText, readCsvFile, resultHtml } from '../data/data.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const delay = ms => new Promise(r => setTimeout(r, ms));
const listen = async s => { await new Promise(r => s.listen(0, '127.0.0.1', r)); return s.address().port; };
const freePort = async () => { const s = http.createServer(); const p = await listen(s); await new Promise(r => s.close(r)); return p; };
const waitFor = async (fn, timeout = 45000) => { const deadline = Date.now()+timeout; while (Date.now()<deadline) { try { const value = await fn(); if(value) return value; } catch {} await delay(150); } throw new Error('Timed out waiting for CSV service'); };

function fixture(calibration) {
  const rows = ['device_time_us,ax_g,ay_g,az_g,gx_dps,gy_dps,gz_dps,device_id,boot_id,side,placement,sequence,clip_mask,label'];
  for (let i=0;i<=(calibration?2500:600);i++) {
    const t=i/100, walk=!calibration||t>=5;
    rows.push([i*10000,walk?.23*Math.sin(2*Math.PI*1.5*t):0,walk?.045*Math.sin(2*Math.PI*t):0,1+(walk?.12*Math.sin(2*Math.PI*3*t):0),walk?5*Math.sin(t):0,0,0,'synthetic-device','synthetic-boot','left','shoe',i+1,0,'합성_테스트'].join(','));
  }
  return '\ufeff'+rows.join('\n');
}

test('CSV UI preserves unavailable scores, escapes context and separates highest window', () => {
  const w={elapsed_s:4,state:'normal',decision_score:null,raw_model_score:.4,rf_score:.5,cnn_score:.3,reason:'<script>'};
  const html=resultHtml({id:'a'.repeat(32),result:{metadata:{participant_id:'<img>',session_id:'test',placement:'shoe'},foot:'left',latest:w,highest:{...w,decision_score:.6},window_count:2,resets:0,state_counts:{normal:2,warning:0,confirmed:0}}});
  assert.match(html,/마지막 분석 창/); assert.match(html,/가장 높은 상태의 창/); assert.match(html,/&lt;img&gt;/); assert.doesNotMatch(html,/<script>/);
  assert.match(html,/<strong>—/); assert.match(html,/windows.csv/);
  assert.match(captureText({status:'recording',purpose:'calibration',elapsed_s:4,rows:401,duration_s:25}), /가만히/);
  assert.match(captureText({status:'recording',purpose:'calibration',elapsed_s:6,rows:601,duration_s:25}), /걸어/);
});

test('file intake rejects invalid UTF-8 and oversized data', async () => {
  await assert.rejects(readCsvFile(null));
  await assert.rejects(readCsvFile({size:9*1024*1024}));
  await assert.rejects(readCsvFile({size:1,arrayBuffer:async()=>new Uint8Array([0xff]).buffer}));
  assert.equal(await readCsvFile(new Blob(['한글,CSV'])), '한글,CSV');
  assert.equal(await readCsvFile(new Blob(['\ufeff한글,CSV\r\n'])), '\ufeff한글,CSV\r\n');
});

test('CSV proxy preserves UTF-8 chunk boundaries and restricts writes and downloads', async t => {
  let payload;
  const s=http.createServer(createAiHandler({fetchImpl:async(_url, options)=>{
    if (options.body) payload=JSON.parse(options.body);
    return new Response('\ufefftimestamp_ms,메모\n0,테스트', {headers:{'content-type':'text/csv; charset=utf-8','content-disposition':'attachment; filename="test.csv"'}});
  }}));
  const base=`http://127.0.0.1:${await listen(s)}`;
  t.after(()=>{s.closeAllConnections();s.close();});
  const body=Buffer.from(JSON.stringify({measurement_csv:'x'.repeat(5000)+'한글'}));
  await new Promise((resolve,reject)=>{
    const req=http.request(base+'/api/ai/datasets/validate',{method:'POST',headers:{'content-type':'application/json'}},res=>{assert.equal(res.statusCode,200);res.resume();res.on('end',resolve);});
    req.on('error',reject);
    const at=body.indexOf(Buffer.from('한글'))+1;
    req.write(body.subarray(0,at));setTimeout(()=>req.end(body.subarray(at)),10);
  });
  assert.equal(payload.measurement_csv,'x'.repeat(5000)+'한글');
  const download=await fetch(base+'/api/ai/datasets/'+'a'.repeat(32)+'/windows.csv');
  assert.match(download.headers.get('content-disposition'),/attachment/);
  assert.match(await download.text(),/테스트/);
  assert.equal((await fetch(base+'/api/ai/datasets/'+'a'.repeat(32)+'/source-measurement.csv')).status,404);
  assert.equal((await fetch(base+'/api/ai/datasets/analyze',{method:'POST',headers:{origin:'https://other.test','content-type':'application/json'},body:'{}'})).status,403);
});

test('web CSV upload -> private calibration -> real RF/CNN worker -> downloadable scores', {timeout:90000}, async t => {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'stepon-csv-http-test-'));
  const processes=[]; let logs='';
  t.after(async()=>{for(const p of processes)p.kill();await delay(400);assert.ok(path.resolve(temp).startsWith(path.resolve(os.tmpdir())+path.sep));await fs.rm(temp,{recursive:true,force:true,maxRetries:10,retryDelay:300});});
  const aiPort=await freePort(), webPort=await freePort();
  const python=process.env.STEPON_TEST_PYTHON||path.join(root,'.venv-ai',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const start=(exe,args,env={})=>{const p=spawn(exe,args,{cwd:root,env:{...process.env,...env},windowsHide:true});processes.push(p);p.stdout.on('data',d=>logs+=d);p.stderr.on('data',d=>logs+=d);p.on('error',e=>logs+=e.message);return p;};
  start(python,['-u','web/ai_bridge/server.py','--hub-url','http://127.0.0.1:1','--port',`${aiPort}`,'--data-dir',temp]);
  start(process.execPath,['cap_web/dev-server.mjs',`${webPort}`],{STEPON_AI_URL:`http://127.0.0.1:${aiPort}`,STEPON_ROM_DATA_DIR:path.join(temp,'rom'),STEPON_TREND_DATA_DIR:path.join(temp,'trends')});
  const base=`http://127.0.0.1:${webPort}`;
  const request=async(route,body)=>{const r=await fetch(base+route,body?{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}:{});return [r.status,await r.json()];};
  try {
    await waitFor(async()=>{const [s,data]=await request('/api/ai/datasets');return s===200&&Array.isArray(data.items);});
    const page=await(await fetch(base+'/data/')).text();assert.match(page,/보정 25초 기록/);assert.match(page,/analysis-form/);
    assert.equal((await fetch(base+'/data/data.js')).status,200);
    const template=await(await fetch(base+'/data/imu-template.csv')).text();assert.equal(template.trim().split('\n').length,1);
    const body={participant_id:'SYNTHETIC_HTTP',session_id:'테스트_회차',side:'left',placement:'shoe',calibration_csv:fixture(true),measurement_csv:fixture(false)};
    const [validStatus,validation]=await request('/api/ai/datasets/validate',body);assert.equal(validStatus,200,JSON.stringify(validation));assert.equal(validation.measurement.received_hz,100);
    const [badStatus]=await request('/api/ai/datasets/analyze',{...body,side:'right'});assert.equal(badStatus,400);
    const [accepted,job]=await request('/api/ai/datasets/analyze',body);assert.equal(accepted,202,JSON.stringify(job));
    const done=await waitFor(async()=>{const [s,j]=await request(`/api/ai/datasets/${job.id}`);return s===200&&j.status!=='running'?j:null;});
    assert.equal(done.status,'complete',JSON.stringify(done));assert.equal(done.result.metadata.session_id,'테스트_회차');
    assert.ok(done.result.window_count>=5);assert.match(done.result.artifact_id,/^[a-f0-9]{64}$/);
    const scores=await fetch(base+`/api/ai/datasets/${job.id}/windows.csv`);assert.match(scores.headers.get('content-disposition'),/attachment/);
    assert.match(await scores.text(),/rf_score,cnn_score,raw_model_score,decision_score/);
    const [_,state]=await request('/api/ai/state');assert.equal(state.ready,false);assert.equal(state.score_percent,null);
    await assert.rejects(fs.access(path.join(temp,'left.calibration.json')));
    await waitFor(async()=>{const [s,list]=await request('/api/ai/datasets');return s===200&&!list.active_job;});
    console.log(JSON.stringify({synthetic_csv_http:true,windows:done.result.window_count,latest_state:done.result.latest.state,latest_score:done.result.latest.score_percent}));
  } catch(error) { throw new Error(`${error.stack}\n${logs}`); }
});
