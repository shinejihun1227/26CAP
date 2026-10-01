import { createMobileFogAudio } from './mobile-fog-audio.js';
import { speakCue } from './cue-controller.js';

// Korean spelling keeps the acronym intelligible across installed TTS voices.
export const FOG_VOICE_MESSAGE = '보행동결, 포그가 발생하였습니다. 잠시 멈추고 안전을 확인해 주세요.';
export function isLiveFog(state, now = Date.now()) {
  const ai = state.ai ?? {}, at = ai.lastWindowAtMs;
  return Boolean(state.dataSource === 'esp32' && !state.paused && !state.fogLocalStop
    && state.aiEnabled !== false && ai.detectionEnabled !== false && ai.available && ai.ready
    && ai.deviceConnected && ai.windowReady && ai.state === 'confirmed'
    && typeof at === 'number' && Number.isFinite(at) && now >= at && now-at <= 2500);
}

// One popup and one spoken message per fresh confirmed episode, on every page.
export function createFogNotifications({ audio = createMobileFogAudio(), speak = speakCue,
  cancelSpeech = () => globalThis.speechSynthesis?.cancel(), onAlert, now = Date.now } = {}) {
  let soundEnabled = false;
  return {
    get soundEnabled() { return soundEnabled; },
    async activate() {
      // Called directly by a click so iOS can unlock speech and media playback.
      const voice = speak(`음성 알림 테스트입니다. ${FOG_VOICE_MESSAGE}`);
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
