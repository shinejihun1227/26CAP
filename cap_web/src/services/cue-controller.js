export function speakCue(message) {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return false;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.lang = "ko-KR";
  utterance.rate = 0.9;
  utterance.pitch = 1;
  window.speechSynthesis.speak(utterance);
  return true;
}

export const cueMessages = {
  laser: "레이저 기준점을 따라 천천히 발을 내딛어 주세요.",
  vibration: "진동 안내를 확인하고 천천히 걸어주세요.",
  voice: "현재 보행 상태를 확인하고 다음 걸음을 준비해 주세요.",
};
