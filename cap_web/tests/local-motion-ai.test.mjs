import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createLocalMotionAiHandler } from '../server/local-motion-ai.mjs';

function mockRequest({ method = 'POST', headers = {}, body = '{}' } = {}) {
  const request = Readable.from([body]);
  request.method = method;
  request.headers = { host: '127.0.0.1:8000', 'content-type': 'application/json', ...headers };
  request.setEncoding = () => {};
  return request;
}
function mockResponse() {
  return { writeHead(code, headers) { this.code = code; this.headers = headers; }, end(body) { this.body = JSON.parse(body); } };
}
const valid = { metric: 'right_ankle', medianDeg: 18.2, observedRangeDeg: 7.4, validRatio: 0.92, previousRangeDeltaDeg: -0.4 };

test('local ankle feedback calls only fixed localhost Ollama with numeric summary, returns concise model text', async () => {
  let url, sent;
  const handler = createLocalMotionAiHandler({ fetchImpl: async (nextUrl, options) => {
    url = nextUrl; sent = JSON.parse(options.body);
    return { ok: true, json: async () => ({ message: { content: '현재 기록은 18.2도 중앙값입니다.' } }) };
  } });
  const response = mockResponse();
  await handler(mockRequest({ body: JSON.stringify(valid) }), response);
  assert.equal(response.code, 200);
  assert.equal(url, 'http://127.0.0.1:11434/api/chat');
  assert.match(sent.messages[1].content, /right_ankle/);
  assert.doesNotMatch(JSON.stringify(sent), /participant|webcam|video|P01|csv/i);
  assert.match(response.body.text, /18.2/);
});

test('local feedback rejects remote origins and non-ankle or invalid measurements', async () => {
  let calls = 0;
  const handler = createLocalMotionAiHandler({ fetchImpl: async () => { calls++; throw new Error('must not call'); } });
  const remote = mockResponse();
  await handler(mockRequest({ headers: { origin: 'https://attacker.example' }, body: JSON.stringify(valid) }), remote);
  assert.equal(remote.code, 403);
  const invalid = mockResponse();
  await handler(mockRequest({ body: JSON.stringify({ ...valid, metric: 'left_knee' }) }), invalid);
  assert.equal(invalid.code, 400);
  assert.equal(calls, 0);
});

test('unavailable Ollama returns actionable local setup status', async () => {
  const handler = createLocalMotionAiHandler({ fetchImpl: async () => { throw new Error('offline'); } });
  const response = mockResponse();
  await handler(mockRequest({ body: JSON.stringify(valid) }), response);
  assert.equal(response.code, 503);
  assert.equal(response.body.error, 'local_model_unavailable');
});
