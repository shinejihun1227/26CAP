import assert from 'node:assert/strict';
import test from 'node:test';
import { createMobileFogAudio } from '../src/services/mobile-fog-audio.js';

class FakeAudioContext {
  static instances = [];
  constructor() {
    this.state = 'suspended';
    this.currentTime = 0;
    this.destination = {};
    this.frequencies = [];
    FakeAudioContext.instances.push(this);
  }
  async resume() { this.state = 'running'; }
  async suspend() { this.state = 'suspended'; }
  createOscillator() {
    const context = this;
    return { type: '', frequency: { setValueAtTime(value) { context.frequencies.push(value); } }, connect() {}, start() {}, stop() {} };
  }
  createGain() {
    return { gain: { setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime() {} }, connect() {} };
  }
}

test('test tone works on desktop and FoG sound fires once per foreground confirmed transition', async () => {
  FakeAudioContext.instances = [];
  const alert = createMobileFogAudio({ AudioContextCtor: FakeAudioContext });
  assert.deepEqual(await alert.activate(), { ok: true });
  const context = FakeAudioContext.instances[0];
  assert.deepEqual(context.frequencies, [740]);
  assert.equal(alert.observe({ ready: true, state: 'warning' }), false);
  assert.equal(alert.observe({ ready: true, state: 'confirmed' }), true);
  assert.deepEqual(context.frequencies, [740, 880, 660]);
  assert.equal(alert.observe({ ready: true, state: 'confirmed' }), false);
  assert.equal(alert.observe({ ready: true, state: 'normal' }), false);
  assert.equal(alert.observe({ ready: true, state: 'confirmed' }), true);
  await alert.deactivate();
});

test('FoG sound does not trigger while page is backgrounded or AI is not ready', async () => {
  FakeAudioContext.instances = [];
  const alert = createMobileFogAudio({ AudioContextCtor: FakeAudioContext });
  await alert.activate();
  assert.equal(alert.observe({ ready: true, state: 'confirmed' }, { foreground: false }), false);
  assert.equal(alert.observe({ ready: false, state: 'confirmed' }), false);
  assert.deepEqual(FakeAudioContext.instances[0].frequencies, [740]);
  await alert.deactivate();
});
