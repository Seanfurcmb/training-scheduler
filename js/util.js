export const DAY_START = 6 * 60;   // 06:00
export const DAY_END = 24 * 60;    // 00:00
export const SNAP = 10;
export const DEFAULT_APPEND_START = 8 * 60;
export const TZ = 'Asia/Jerusalem';

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const snap = (m, step = SNAP) => Math.round(m / step) * step;
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function fmtTime(min) {
  const h = Math.floor(min / 60) % 24, m = min % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}
export function parseTime(str) {
  const [h, m] = String(str).split(':').map(Number);
  return h * 60 + (m || 0);
}
export const ltr = (s) => `<span class="ltr">${s}</span>`;
export const durRange = (min, max) => `${fmtDur(min)} עד ${fmtDur(max)}`;
export const timeRange = (s, e) => `${fmtTime(s)}–${fmtTime(e)}`;

export function fmtDur(min) {
  const h = Math.floor(min / 60), m = min % 60;
  if (!h) return `${m} ד'`;
  if (!m) return h === 1 ? 'שעה' : `${h} ש'`;
  return `${h}:${String(m).padStart(2, '0')} ש'`;
}

const dateObj = (iso) => { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d); };
export function fmtDate(iso, opts = { weekday: 'long', day: 'numeric', month: 'numeric' }) {
  if (!iso) return '';
  return new Intl.DateTimeFormat('he-IL', opts).format(dateObj(iso));
}
export function addDays(iso, n) {
  const d = dateObj(iso); d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
export function todayIso() { return addDays(new Date().toISOString().slice(0, 10), 0); }

export const CATEGORIES = {
  lesson: { label: 'שיעור', color: '#3b82f6' },
  drill: { label: 'תרגול', color: '#16a34a' },
  logistics: { label: 'מנהלה', color: '#64748b' },
};
export const BLOCK_TYPES = {
  meal: { label: 'ארוחה', color: '#f59e0b', icon: '🍽️' },
  break: { label: 'הפסקה', color: '#a3a3a3', icon: '☕' },
  external: { label: 'לו"ז חיצוני', color: '#8b5cf6', icon: '🔗' },
};

// Default min/max from the ideal duration: ±25% for lessons, -50%/+100% for drills.
export function defaultRange(ideal, category) {
  const [lo, hi] = category === 'drill' ? [0.5, 2] : [0.75, 1.25];
  return { min: Math.max(SNAP, snap(ideal * lo)), max: Math.max(snap(ideal * hi), ideal) };
}

let toastTimer;
export function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg; el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2500);
}

export function download(filename, content, type) {
  const blob = new Blob([content], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

export function byName(a, b) { return (a.name || '').localeCompare(b.name || '', 'he'); }
