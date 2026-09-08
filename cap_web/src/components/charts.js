export function renderSparkline(values, tone = "coral") {
  const width = 520;
  const height = 120;
  const max = Math.max(...values, 1);
  const min = Math.min(...values, 0);
  const points = values.map((value, index) => {
    const x = (index / Math.max(values.length - 1, 1)) * width;
    const y = height - ((value - min) / Math.max(max - min, 1)) * (height - 18) - 9;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = points.split(" ").at(-1).split(",");
  return `
    <svg class="sparkline" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="최근 활동 추이">
      <defs><linearGradient id="chart-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="var(--${tone})" stop-opacity=".28"/><stop offset="1" stop-color="var(--${tone})" stop-opacity="0"/></linearGradient></defs>
      <path class="chart-area" d="M ${points.replaceAll(" ", " L ")} L ${width},${height} L 0,${height} Z" fill="url(#chart-fill)"/>
      <polyline points="${points}" fill="none" stroke="var(--${tone})" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="${last[0]}" cy="${last[1]}" r="5" fill="var(--${tone})" stroke="#fff" stroke-width="3"/>
    </svg>
  `;
}

export function renderProgress(label, value, tone = "mint", note = "") {
  const parsed = Number(value);
  const available = value !== null && value !== undefined && Number.isFinite(parsed);
  const display = available ? parsed : "--";
  const width = available ? Math.min(100, Math.max(0, parsed)) : 0;
  return `<div class="progress-row"><div class="progress-label"><span>${label}</span><b>${display}${available ? "%" : ""}</b></div><div class="progress-track"><span class="progress-${tone}" style="width:${width}%"></span></div>${note ? `<small>${note}</small>` : ""}</div>`;
}
