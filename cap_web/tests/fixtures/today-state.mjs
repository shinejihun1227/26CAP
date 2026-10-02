import { initialState } from '../../src/data/dashboard-data.js';

// Isolated render fixture only: never posted to live sensor/AI endpoints.
export function todayState(now = Date.now()) {
  const raw = (side, front, rear) => ({ foot_side: side, pressure_ready: true, pressure: [front, front, rear, rear],
    sensor_profile: 'two-shared', pressure_count: 4, pressure_physical_count: 2,
    pressure_layout: 'stepon-pressure-2-shared-v1', pressure_channels: [0,0,1,1], pressure_sensor_map: [0,0,1,1],
    thermal_physical_count: 2, thermal_sensor_map: [0,0,1,1], thermal_transport: 'dual-i2c' });
  return { ...structuredClone(initialState), dataSource: 'esp32', connected: true, easyMode: true, aiEnabled: true, sensorReceivedAt: now,
    profile: {configured: false},
    ai: { available: true, ready: true, detectionEnabled: true, status: 'warning', selectedFoot: 'right', score: .68, lastWindowAtMs: now,
      feet: {left: {device_connected: true, ready: true, status: 'normal', decision_score: .23, last_window_at_ms: now, diagnostics:{rf_score:.25,cnn_score:.21}},
        right: {device_connected: true, ready: true, status: 'warning', decision_score: .68, last_window_at_ms: now, diagnostics:{rf_score:.7,cnn_score:.66}}} },
    hardware: {transport:'sta', feet:{left:{connected:true,age_ms:0,state:raw('left',80,20)},right:{connected:true,age_ms:0,state:raw('right',25,75)}}},
    dailyAnkle: {receivedAt:now,data:{version:1,scope:'foot-inclination-quiet-only',events:[],feet:{
      left:{phase:'ready',state:'within',plan:{max:25,margin:5,at:now-60000,directionReady:true},current:{tilt:12.5,vector:[8.84,8.84,0],direction:{source:'toe-up',code:'front',label:'전방 · 발끝 들림',forward:12.5,left:0}},comparedSeconds:35},
      right:{phase:'ready',state:'outside',plan:{max:25,margin:5,at:now-60000,directionReady:true},current:{tilt:34.2,vector:[24.18,24.18,0],direction:{source:'toe-up',code:'right',label:'바깥쪽 측면 들림',forward:10,left:-32}},comparedSeconds:42},
    }}},
  };
}
