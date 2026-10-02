import { ANNOUNCEMENTS, announcementUrl } from './announcement-catalog.js';

function createBrowserAudio() {
  if (typeof window === 'undefined' || typeof window.Audio !== 'function') return null;
  const audio = new window.Audio();
  audio.hidden = true;
  audio.setAttribute('aria-hidden', 'true');
  audio.dataset.steponAnnouncement = '';
  document.body?.append(audio);
  return audio;
}

// Reuse the element activated by the user's sound-test click, including on iOS.
export function createAnnouncementPlayer({ createAudio = createBrowserAudio,
  fallback = () => false, cancelFallback = () => {} } = {}) {
  let audio = null;
  let revision = 0;

  function stopMedia() {
    if (!audio) return;
    audio.onerror = null;
    audio.pause();
    try { audio.currentTime = 0; } catch { /* Metadata may not be loaded yet. */ }
  }

  function cancel() {
    revision += 1;
    stopMedia();
    cancelFallback();
  }

  function speak(message) {
    cancel();
    const clip = ANNOUNCEMENTS.find(item => item.text === message);
    if (!clip) return fallback(message);
    const current = revision;
    let failed = false;
    function useFallback() {
      // An old load/play error must never restart sound after stop or a new cue.
      if (failed || revision !== current) return false;
      failed = true;
      stopMedia();
      return fallback(message);
    }
    try {
      audio ??= createAudio();
      if (!audio) return useFallback();
      audio.preload = 'auto';
      audio.volume = 1;
      audio.playbackRate = 1;
      audio.onerror = useFallback;
      audio.src = announcementUrl(clip.id);
      const playback = audio.play();
      playback?.catch(useFallback);
      return true;
    } catch {
      return useFallback();
    }
  }

  return { speak, cancel };
}
