// Calendar export: .ics file + Google Calendar "add event" links. Times are Israel local time.
import { TZ } from './util.js';

function tzOffsetMin(date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(date).map((x) => [x.type, x.value]));
  const asUtc = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return Math.round((asUtc - date.getTime()) / 60000);
}

// date "YYYY-MM-DD" + minutes from local midnight (in Israel) -> Date
export function zonedToUtc(iso, minutes) {
  const [y, m, d] = iso.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d, 0, minutes);
  let t = guess - tzOffsetMin(new Date(guess)) * 60000;
  const off2 = tzOffsetMin(new Date(t));
  t = guess - off2 * 60000;
  return new Date(t);
}

const stamp = (d) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

const escText = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// Fold lines to 75 octets (UTF-8 aware)
function fold(line) {
  const enc = new TextEncoder();
  const out = [];
  let cur = '', bytes = 0;
  for (const ch of line) {
    const b = enc.encode(ch).length;
    if (bytes + b > (out.length ? 74 : 75)) { out.push(cur); cur = ''; bytes = 0; }
    cur += ch; bytes += b;
  }
  out.push(cur);
  return out.join('\r\n ');
}

/** events: [{uid, date, start, duration, title, description, location}] */
export function buildIcs(calName, events) {
  const now = stamp(new Date());
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//training-scheduler//HE', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${escText(calName)}`, `X-WR-TIMEZONE:${TZ}`,
  ];
  for (const e of events) {
    const s = zonedToUtc(e.date, e.start), en = zonedToUtc(e.date, e.start + e.duration);
    lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${now}`, `DTSTART:${stamp(s)}`, `DTEND:${stamp(en)}`,
      `SUMMARY:${escText(e.title)}`);
    if (e.description) lines.push(`DESCRIPTION:${escText(e.description)}`);
    if (e.location) lines.push(`LOCATION:${escText(e.location)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}

export function googleLink(e) {
  const s = zonedToUtc(e.date, e.start), en = zonedToUtc(e.date, e.start + e.duration);
  const q = new URLSearchParams({ action: 'TEMPLATE', text: e.title, dates: `${stamp(s)}/${stamp(en)}`, ctz: TZ });
  if (e.description) q.set('details', e.description);
  if (e.location) q.set('location', e.location);
  return `https://calendar.google.com/calendar/render?${q}`;
}
