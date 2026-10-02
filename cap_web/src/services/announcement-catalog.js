export const FOG_VOICE_MESSAGE = '보행동결, 포그가 발생하였습니다. 잠시 멈추고 안전을 확인해 주세요.';
export const FOG_TEST_MESSAGE = `음성 알림 테스트입니다. ${FOG_VOICE_MESSAGE}`;
export const ALL_OUTPUTS_TEST_MESSAGE = '안내 테스트입니다. 레이저 기준점을 따라 천천히 발을 내딛어 주세요.';

export const cueMessages = {
  laser: '레이저 기준점을 따라 천천히 발을 내딛어 주세요.',
  vibration: '진동 안내를 확인하고 천천히 걸어주세요.',
  voice: '현재 보행 상태를 확인하고 다음 걸음을 준비해 주세요.',
};

// Fixed messages only. Generation never receives sensor values or personal records.
export const ANNOUNCEMENTS = [
  { id: 'fog', text: FOG_VOICE_MESSAGE },
  { id: 'fog-test', text: FOG_TEST_MESSAGE },
  { id: 'voice-test', text: cueMessages.voice },
  { id: 'laser', text: cueMessages.laser },
  { id: 'vibration', text: cueMessages.vibration },
  { id: 'all-outputs-test', text: ALL_OUTPUTS_TEST_MESSAGE },
];

export function announcementUrl(id) {
  return new URL(`../../assets/audio/announcer-v1/${id}.mp3`, import.meta.url).href;
}
