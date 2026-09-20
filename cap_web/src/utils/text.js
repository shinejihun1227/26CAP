const htmlEntities = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" };

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => htmlEntities[character]);
}

export function formatDateLabel(date = new Date()) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "short",
    day: "numeric",
    year: "numeric",
  }).format(date).toUpperCase();
}

export function formatTimeLabel(date = new Date()) {
  return new Intl.DateTimeFormat("ko-KR", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  }).format(date);
}
