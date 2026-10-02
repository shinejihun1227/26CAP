import assert from 'node:assert/strict';
import test from 'node:test';
import { speakCue } from '../src/services/cue-controller.js';

test('Korean cue prefers a natural Korean voice and uses a calm speaking pace', () => {
  const utterances = [];
  const naturalVoice = { lang: 'ko-KR', name: 'Korean Natural Online' };
  const standardVoice = { lang: 'ko-KR', name: 'Korean Standard' };
  const previousWindow = globalThis.window;
  globalThis.window = {
    SpeechSynthesisUtterance: class {
      constructor(text) { this.text = text; utterances.push(this); }
    },
    speechSynthesis: {
      cancel() {},
      getVoices: () => [standardVoice, naturalVoice, { lang: 'en-US', name: 'English Natural' }],
      speak(utterance) { utterances.push(utterance); },
    },
  };
  try {
    assert.equal(speakCue('보행동결 신호가 감지되었습니다. 안전한 곳에 잠시 멈춰 주세요.'), true);
    const utterance = utterances.at(-1);
    assert.equal(utterance.text, '보행동결 신호가 감지되었습니다. 안전한 곳에 잠시 멈춰 주세요.');
    assert.equal(utterance.lang, 'ko-KR');
    assert.equal(utterance.voice, naturalVoice);
    assert.equal(utterance.rate, 0.97);
    assert.equal(utterance.pitch, 1);
    assert.equal(utterance.volume, 1);
  } finally {
    if (previousWindow === undefined) delete globalThis.window;
    else globalThis.window = previousWindow;
  }
});
