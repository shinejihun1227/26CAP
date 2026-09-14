// Display-only connection facts. Never switch the selected foot or enable outputs.
export function connectionSummary(state) {
  const real = state.dataSource === 'esp32';
  const sta = real && state.hardware?.transport === 'sta';
  const sides = ['left', 'right'];
  const active = state.rehab?.config?.activeFoot === 'right' ? 'right' : 'left';
  const activeLabel = active === 'left' ? '왼발' : '오른발';
  const count = sta ? sides.filter((side) => state.hardware.feet?.[side]?.connected === true).length : Number(Boolean(state.connected));
  const activeConnected = !real || (sta ? state.hardware.feet?.[active]?.connected === true : Boolean(state.connected));
  const label = !real ? '시연 데이터' : state.paused ? '화면 갱신 일시정지' : sta ? `깔창 ${count}/2 연결` : count ? '깔창 연결됨' : '깔창 연결 대기';
  return { real, sta, active, activeLabel, count, activeConnected, label,
    tone: !real ? 'demo' : state.paused ? 'paused' : count === 0 ? 'waiting' : sta && count < 2 ? 'partial' : 'connected' };
}
