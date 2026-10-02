import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { serveAudioFile } from '../server/audio-file.mjs';

test('MP3 delivery supports complete files, Safari byte probes, suffixes and HEAD', async t => {
  const path = fileURLToPath(new URL('../assets/audio/announcer-v1/fog.mp3', import.meta.url));
  const original = await fs.readFile(path);
  const server = http.createServer((req, res) => serveAudioFile(req, res, path, original.length));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = `http://127.0.0.1:${server.address().port}`;
  const full = await fetch(url);
  assert.equal(full.status, 200);
  assert.equal(full.headers.get('content-type'), 'audio/mpeg');
  assert.equal(full.headers.get('content-length'), String(original.length));
  assert.deepEqual(Buffer.from(await full.arrayBuffer()), original);
  for (const [range, start, end] of [['bytes=0-1', 0, 1], ['bytes=100-', 100, original.length-1], ['bytes=-12', original.length-12, original.length-1]]) {
    const part = await fetch(url, {headers:{Range:range}});
    assert.equal(part.status, 206);
    assert.equal(part.headers.get('content-range'), `bytes ${start}-${end}/${original.length}`);
    assert.deepEqual(Buffer.from(await part.arrayBuffer()), original.subarray(start, end+1));
  }
  const head = await fetch(url, {method:'HEAD'});
  assert.equal(head.headers.get('content-length'), String(original.length));
  assert.equal((await head.arrayBuffer()).byteLength, 0);
  const invalid = await fetch(url, {headers:{Range:`bytes=${original.length}-`}});
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get('content-range'), `bytes */${original.length}`);
});
