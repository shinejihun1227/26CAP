import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createAnnouncementPlayer } from '../src/services/announcement-player.js';
import { ANNOUNCEMENTS, FOG_VOICE_MESSAGE, FOG_TEST_MESSAGE, announcementUrl } from '../src/services/announcement-catalog.js';

function fixture() {
  let created = 0;
  const fallbacks = [], pending = [];
  const audio = { paused: true, currentTime: 0,
    pause() { this.paused = true; },
    play() { this.paused = false; return new Promise((resolve, reject) => pending.push({resolve, reject})); },
  };
  const player = createAnnouncementPlayer({ createAudio: () => { created++; return audio; },
    fallback: text => { fallbacks.push(text); return true; } });
  return { audio, player, pending, fallbacks, get created() { return created; } };
}

test('test click and later FoG warning reuse one media element and bundled voice', () => {
  const f = fixture();
  assert.equal(f.player.speak(FOG_TEST_MESSAGE), true);
  assert.equal(f.audio.src, announcementUrl('fog-test'));
  f.audio.currentTime = 2;
  f.player.speak(FOG_VOICE_MESSAGE);
  assert.equal(f.created, 1);
  assert.equal(f.audio.src, announcementUrl('fog'));
  assert.equal(f.audio.currentTime, 0);
  assert.equal(f.audio.playbackRate, 1);
  assert.equal(f.audio.volume, 1);
  assert.deepEqual(f.fallbacks, []);
});

test('stop immediately pauses media; a late rejection cannot restart speech', async () => {
  const f = fixture();
  f.player.speak(FOG_VOICE_MESSAGE);
  const staleError = f.audio.onerror;
  f.player.cancel();
  assert.equal(f.audio.paused, true);
  assert.equal(f.audio.onerror, null);
  f.pending[0].reject(new Error('late network error'));
  staleError();
  await Promise.resolve();
  assert.deepEqual(f.fallbacks, []);
});

test('a replaced announcement cannot interrupt the new one through an old error', async () => {
  const f = fixture();
  f.player.speak(FOG_TEST_MESSAGE);
  const staleError = f.audio.onerror;
  f.player.speak(FOG_VOICE_MESSAGE);
  staleError();
  f.pending[0].reject(new Error('replaced source'));
  await Promise.resolve();
  assert.equal(f.audio.paused, false);
  assert.deepEqual(f.fallbacks, []);
});

test('missing or blocked audio falls back exactly once even with two error events', async () => {
  const f = fixture();
  f.player.speak(FOG_VOICE_MESSAGE);
  f.audio.onerror();
  f.pending[0].reject(new Error('unsupported media'));
  await Promise.resolve();
  assert.equal(f.audio.paused, true);
  assert.deepEqual(f.fallbacks, [FOG_VOICE_MESSAGE]);
});

test('unavailable media uses browser speech; cancellation also stops that speech', () => {
  const messages = []; let cancelled = 0;
  const player = createAnnouncementPlayer({ createAudio: () => null,
    fallback: text => { messages.push(text); return true; }, cancelFallback: () => cancelled++ });
  assert.equal(player.speak(FOG_VOICE_MESSAGE), true);
  const before = cancelled;
  player.cancel();
  assert.equal(cancelled, before + 1);
  assert.deepEqual(messages, [FOG_VOICE_MESSAGE]);
});

test('every shipped clip matches the current text, generation manifest and audio checksum', async () => {
  const manifest = JSON.parse(await fs.readFile(new URL('../assets/audio/announcer-v1/manifest.json', import.meta.url), 'utf8'));
  assert.equal(manifest.voice, 'ko-KR-InJoonNeural');
  assert.equal(manifest.messages.length, ANNOUNCEMENTS.length);
  for (const clip of ANNOUNCEMENTS) {
    const built = manifest.messages.find(item => item.id === clip.id);
    assert.equal(built.text, clip.text);
    const file = await fs.readFile(new URL(announcementUrl(clip.id)));
    assert.ok(file.length > 1024);
    assert.equal(createHash('sha256').update(file).digest('hex'), built.sha256);
  }
});
