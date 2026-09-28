import test from 'node:test';
import assert from 'node:assert/strict';
import { createMobileFogAudio } from '../src/services/mobile-fog-audio.js';

class FakeAudioContext {
  constructor() { this.state = 'suspended'; this.currentTime = 3; this.destination = {}; this.oscillators = []; }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  createOscillator() {
    const node = { frequency: { setValueAtTime() {} }, connect() {}, start() {}, stop() {} };
    this.oscillators.push(node); return node;
  }
  createGain() { return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, connect() {} }; }
}

test('phone sound starts only after user activation and plays the test tone', async () => {
  const contexts = [];
  class Capture extends FakeAudioContext { constructor() { super(); contexts.push(this); } }
  const audio = createMobileFogAudio({ AudioContextCtor: Capture });
  assert.deepEqual(await audio.activate(), { ok: true });
  assert.equal(audio.enabled, true);
  assert.equal(audio.observe({ ready: true, state: 'confirmed' }), true);
  assert.equal(contexts[0].oscillators.length, 3); // one test beep + two FoG entry beeps
});

test('FoG confirmed entry sounds once, warning does not, and a new entry sounds again', async () => {
  const contexts = [];
  class Capture extends FakeAudioContext { constructor() { super(); contexts.push(this); } }
  const audio = createMobileFogAudio({ AudioContextCtor: Capture });
  await audio.activate();
  assert.equal(audio.observe({ ready: true, state: 'warning' }), false);
  assert.equal(audio.observe({ ready: true, state: 'confirmed' }), true);
  assert.equal(audio.observe({ ready: true, state: 'confirmed' }), false);
  assert.equal(audio.observe({ ready: true, state: 'normal' }), false);
  assert.equal(audio.observe({ ready: true, state: 'confirmed' }), true);
  assert.equal(audio.enabled, true);
  assert.equal(contexts[0].oscillators.length, 5); // one test beep + two confirmed transitions
});

test('sound remains off when unsupported and cannot alert after user disables it', async () => {
  const unsupported = createMobileFogAudio({ AudioContextCtor: null });
  assert.deepEqual(await unsupported.activate(), { ok: false, reason: 'unsupported' });
  assert.equal(unsupported.observe({ ready: true, state: 'confirmed' }), true);
  const audio = createMobileFogAudio({ AudioContextCtor: FakeAudioContext });
  await audio.activate();
  await audio.deactivate();
  assert.equal(audio.enabled, false);
  assert.equal(audio.observe({ ready: true, state: 'normal' }), false);
  assert.equal(audio.observe({ ready: true, state: 'confirmed' }), true);
  assert.equal(audio.enabled, false);
});
