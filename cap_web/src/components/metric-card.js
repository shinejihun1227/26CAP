import { icon } from "./icons.js";

export function renderMetricCard({ label, value, unit, delta, description, tone = "blue", iconName }) {
  return `
    <article class="metric-card metric-${tone}">
      <div class="metric-card-top">
        <span class="metric-label">${label}</span>
        <span class="metric-icon">${icon(iconName)}</span>
      </div>
      <div class="metric-value">${value}<small>${unit}</small></div>
      <div class="metric-foot"><span class="metric-delta">${delta}</span><span>${description}</span></div>
    </article>
  `;
}
