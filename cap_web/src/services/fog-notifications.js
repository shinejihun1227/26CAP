import { createMobileFogAudio } from './mobile-fog-audio.js';
import { speakCue, cancelCue } from './cue-controller.js';
import { FOG_VOICE_MESSAGE, FOG_TEST_MESSAGE } from './announcement-catalog.js';
export { FOG_VOICE_MESSAGE } from './announcement-catalog.js';

export function isLiveFog(state, now = Date.now()) {
  const ai = state.ai ?? {}, at = ai.lastWindowAtMs;
  return Boolean(state.dataSource === 'esp32' && !state.paused && !state.fogLocalStop
    && state.aiEnabled !== false && ai.detectionEnabled !== false && !ai.suppression?.active && ai.available && ai.ready
    && ai.deviceConnected && ai.windowReady && ai.state === 'confirmed'
    && typeof at === 'number' && Number.isFinite(at) && now >= at && now-at <= 2500);
}

// One popup and one spoken message per fresh confirmed episode, on every page.
export function createFogNotifications({ audio = createMobileFogAudio(), speak = speakCue,
  cancelSpeech = cancelCue, onAlert, now = Date.now } = {}) {
  let soundEnabled = false;
  return {
    get soundEnabled() { return soundEnabled; },
    async activate() {
      // Called directly by a click so iOS can unlock speech and media playback.
      const voice = speak(FOG_TEST_MESSAGE);
      const tone = await audio.activate();
      soundEnabled = voice || tone.ok;
      return { ok: soundEnabled, voice, tone: tone.ok };
    },
    async deactivate() { soundEnabled = false; cancelSpeech(); await audio.deactivate(); },
    silence() { cancelSpeech(); audio.silence(); audio.observe({ready:false}); },
    observe(state, {foreground = true} = {}) {
      const confirmed = isLiveFog(state, now());
      const entered = audio.observe({ready:confirmed, state:confirmed?'confirmed':null}, {foreground});
      if (entered) { onAlert?.(); if (soundEnabled) speak(FOG_VOICE_MESSAGE); }
      return entered;
    },
  };
}
