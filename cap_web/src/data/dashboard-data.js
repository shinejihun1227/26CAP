import { createDefaultRehabState } from "./gait-algorithms.js";

export const navItems = [
  { id: "overview", label: "Today", korean: "오늘 요약", icon: "grid" },
  { id: "live", label: "Live", korean: "실시간 측정", icon: "activity" },
  { id: "safety", label: "Analysis", korean: "분석 센터", icon: "shield" },
  { id: "reports", label: "Reports", korean: "보행 리포트", icon: "report" },
  { id: "devices", label: "Devices", korean: "기기 관리", icon: "device" },
  { id: "mediapipe", label: "Personalize", korean: "개인화 설정", icon: "camera" },
];

export const observationGoals = [
  { id: "fog", label: "보행동결 관찰", desc: "BMI270 + 압력센서 기반" },
  { id: "foot", label: "발 상태 관찰", desc: "양발 온·습도 차이" },
  { id: "balance", label: "균형·낙상 관찰", desc: "좌우 압력과 보행 리듬" },
  { id: "daily", label: "일상 보행 기록", desc: "걸음과 활동 흐름" },
];

export const cueOptions = [
  { id: "laser", label: "레이저 기준점", desc: "다음 발 디딤 위치를 시각 안내" },
  { id: "vibration", label: "진동 알림", desc: "발 또는 손목에 촉각 안내" },
  { id: "voice", label: "음성 안내", desc: "한국어 음성으로 천천히 안내" },
];

export const initialState = {
  connected: true,
  dataSource: "mock",
  ai: {
    available: false,
    ready: false,
    status: "unavailable",
    state: null,
    score: null,
    model: "ensemble",
    deviceConnected: false,
    detectorLoaded: false,
    windowReady: false,
    windowCount: 0,
    sampleRateHz: 64,
    windowSec: 4,
    hopSec: 0.5,
    calibration: {},
    lastError: null,
    bridgeUrl: null,
  },
  rehab: createDefaultRehabState(false),
  paused: false,
  profile: { name: "김서준", age: 68, mode: "보행 동결 관찰", goals: ["fog"], preferredCues: ["laser", "vibration", "voice"], configured: false },
  metrics: {
    risk: 24,
    steps: 3842,
    balance: 82,
    temperature: 31.8,
    humidity: 48,
    cadence: 96,
    stride: 42,
  },
  thermal: {
    left: [
      { site: "heel", temp: 31.4, humidity: 46 },
      { site: "arch", temp: 31.8, humidity: 48 },
      { site: "forefoot", temp: 32.1, humidity: 51 },
      { site: "toe", temp: 31.9, humidity: 49 },
    ],
    right: [
      { site: "heel", temp: 31.8, humidity: 47 },
      { site: "arch", temp: 32.2, humidity: 50 },
      { site: "forefoot", temp: 33.0, humidity: 54 },
      { site: "toe", temp: 32.1, humidity: 49 },
    ],
  },
  imu: {
    accel: { x: 0.12, y: -0.03, z: 0.98 },
    gyro: { x: 1.4, y: 0.2, z: 4.1 },
    freezeBandEnergy: 0.34,
    locomotorBandEnergy: 1.72,
  },
  outputs: { auto: true, laser: true, vibration: true, voice: true },
  heatmapMode: "pressure",
  pressure: [72, 54, 68, 44, 38, 81, 63, 49],
  bilateralPressure: {
    left: [72, 54, 68, 44, 38, 81, 63, 49],
    right: [66, 58, 74, 51, 43, 76, 61, 55],
  },
  activity: [36, 42, 39, 54, 48, 65, 58, 71, 63, 77, 68, 74],
  events: [
    { time: "10:42", title: "보행 리듬이 안정적이에요", detail: "평균 보폭 42cm · 좌우 편차 5%", tone: "mint", icon: "check" },
    { time: "10:18", title: "왼발 체중 이동이 늦었어요", detail: "다음 걸음은 레이저 기준점을 따라가세요", tone: "coral", icon: "cue" },
    { time: "09:56", title: "센서 연결이 시작됐어요", detail: "깔창 1 · SHTC3 4 · BMI270 1", tone: "lavender", icon: "device" },
  ],
  device: { name: "StepOn insole · Prototype", battery: 87, signal: "좋음", lastSync: "방금 전" },
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function evolveState(state) {
  const tick = (state.tick ?? 0) + 1;
  const wave = Math.sin(tick / 2.4);
  const drift = Math.cos(tick / 3.8);
  const pressure = state.pressure.map((value, index) =>
    Math.round(clamp(value + Math.sin(tick / 2 + index) * 3 + drift * (index % 2 ? 1 : -1), 12, 94)),
  );
  const bilateralPressure = {
    left: pressure,
    right: state.bilateralPressure?.right?.map((value, index) =>
      Math.round(clamp(value + Math.sin(tick / 2.2 + index * 0.7) * 2 + drift * (index % 2 ? -1 : 1), 12, 94)),
    ) ?? pressure.map((value) => Math.round(clamp(value * 0.92, 12, 94))),
  };
  const risk = Math.round(clamp(state.metrics.risk + wave * 1.4, 12, 58));
  const activity = [...state.activity.slice(1), Math.round(clamp(60 + wave * 16 + drift * 8, 22, 90))];
  const imu = {
    ...state.imu,
    gyro: { ...state.imu.gyro, z: Number(clamp(state.imu.gyro.z + wave * 0.2, 2.5, 8).toFixed(1)) },
    freezeBandEnergy: Number(clamp(state.imu.freezeBandEnergy + wave * 0.018, 0.18, 0.82).toFixed(2)),
  };

  return {
    ...state,
    tick,
    metrics: {
      ...state.metrics,
      risk,
      balance: Math.round(clamp(84 - risk * 0.35 + drift * 2, 65, 94)),
      temperature: Number(clamp(state.metrics.temperature + wave * 0.06, 30.8, 33.2).toFixed(1)),
      cadence: Math.round(clamp(state.metrics.cadence + drift * 1.1, 84, 106)),
    },
    pressure,
    bilateralPressure,
    activity,
    imu,
  };
}

export function riskLabel(risk) {
  if (risk >= 55) return { label: "관찰 필요", tone: "coral" };
  if (risk >= 30) return { label: "가벼운 주의", tone: "orange" };
  return { label: "안정적", tone: "mint" };
}
