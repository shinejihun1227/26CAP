function oscillatorBeep(context, frequency, startAt) {
  const oscillator = context.createOscillator();
  const gain = context.createGain();
  oscillator.type = 'sine';
  oscillator.frequency.setValueAtTime(frequency, startAt);
  gain.gain.setValueAtTime(0.0001, startAt);
  gain.gain.exponentialRampToValueAtTime(0.12, startAt + 0.025);
  gain.gain.setTargetAtTime(0.0001, startAt + 0.12, 0.025);
  oscillator.connect(gain);
  gain.connect(context.destination);
  oscillator.start(startAt);
  oscillator.stop(startAt + 0.23);
}

export function createMobileFogAudio({ AudioContextCtor = globalThis.AudioContext || globalThis.webkitAudioContext } = {}) {
  let context = null, enabled = false, wasConfirmed = false;

  function playPattern(frequencies) {
    if (!enabled || !context || context.state !== 'running') return false;
    const at = context.currentTime + 0.01;
    frequencies.forEach((frequency, index) => oscillatorBeep(context, frequency, at + index * 0.3));
    return true;
  }

  return {
    get enabled() { return enabled; },
    async activate() {
      if (typeof AudioContextCtor !== 'function') return { ok: false, reason: 'unsupported' };
      try {
        if (!context || context.state === 'closed') context = new AudioContextCtor();
        await context.resume();
        if (context.state !== 'running') return { ok: false, reason: 'blocked' };
        enabled = true;
        playPattern([740]); // A short test tone confirms the phone's media volume.
        return { ok: true };
      } catch { enabled = false; return { ok: false, reason: 'blocked' }; }
    },
    async deactivate() {
      enabled = false;
      if (context && context.state !== 'closed') await context.suspend().catch(() => {});
    },
    observe(ai, { foreground = true } = {}) {
      const confirmed = Boolean(foreground && ai?.ready && ai.state === 'confirmed');
      const started = confirmed && !wasConfirmed;
      wasConfirmed = confirmed;
      if (started) playPattern([880, 660]);
      return started;
    },
  };
}
