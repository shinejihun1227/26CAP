const paths = {
  user: '<circle cx="12" cy="8" r="4"/><path d="M4 21v-2a8 8 0 0 1 16 0v2"/>',
  grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  activity: '<path d="M3 12h4l2.1-6 4.2 12 2.1-6H21"/>',
  shield: '<path d="M12 3 20 6v5.8c0 4.9-3.4 7.8-8 9.2-4.6-1.4-8-4.3-8-9.2V6l8-3Z"/><path d="m8.5 12 2.2 2.2 4.8-4.8"/>',
  report: '<path d="M6 3.5h9l3 3V20a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V4.5a1 1 0 0 1 1-1Z"/><path d="M14 3.5V7h4M8 11h6M8 15h6M8 18h3"/>',
  device: '<rect x="7" y="2.5" width="10" height="19" rx="2.5"/><path d="M10 5.5h4M11 18.5h2"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  alert: '<path d="M12 3 22 20H2L12 3Z"/><path d="M12 9v4M12 16h.01"/>',
  cue: '<path d="M12 3v18M3 12h18"/><circle cx="12" cy="12" r="7.5"/>',
  bell: '<path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9ZM10 21h4"/>',
  arrow: '<path d="M5 12h14M13 6l6 6-6 6"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M4.93 19.07l1.41-1.41M17.66 6.34l1.41-1.41"/>',
  drop: '<path d="M12 3.5S6.5 9.4 6.5 13.6a5.5 5.5 0 0 0 11 0C17.5 9.4 12 3.5 12 3.5Z"/><path d="M9.2 14.1a3 3 0 0 0 2.2 2.1"/>',
  shoe: '<path d="M4 7.5c2.7 1.5 4.5 3.2 6.3 5.2 1.3 1.4 2.9 2.1 5 2.5l3.5.7c1 .2 1.7 1.1 1.7 2.1 0 1.1-.9 2-2 2H6c-2.2 0-4-1.8-4-4 0-1.9.8-4.4 2-8.5Z"/><path d="M6.5 13.5h4M8 11l1.4-1.2M11 13l1.3-1.3"/>',
  image: '<rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9" r="1.5"/><path d="m4 17 4.5-4 3.5 3 2.5-2 5.5 4"/>',
  camera: '<path d="M4 7.5h3l1.5-2h7l1.5 2h3a1.5 1.5 0 0 1 1.5 1.5v9A1.5 1.5 0 0 1 20 19.5H4A1.5 1.5 0 0 1 2.5 18V9A1.5 1.5 0 0 1 4 7.5Z"/><circle cx="12" cy="13.5" r="3.2"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chevron: '<path d="m9 18 6-6-6-6"/>',
  pause: '<path d="M8 5v14M16 5v14"/>',
  play: '<path d="m9 5 10 7-10 7V5Z"/>',
};

export function icon(name, className = "") {
  return `<svg class="icon ${className}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] ?? paths.activity}</svg>`;
}
