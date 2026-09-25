// Trainee view: renders a schedule decoded from the URL hash, with calendar export.
import { decodeShare } from './share.js';
import { buildIcs, googleLink } from './ics.js';
import { esc, fmtTime, fmtDate, download, BLOCK_TYPES } from './util.js';

const main = document.getElementById('main');

async function init() {
  let payload;
  try { payload = await decodeShare(location.hash.slice(1)); } catch {
    main.innerHTML = '<div class="center-card"><h1>הקישור לא תקין</h1><p>בקשו מהמדריך לשלוח קישור חדש.</p></div>';
    return;
  }
  const events = payload.b.map(([date, start, duration, title, description, loc, type], i) => ({
    uid: `${date}-${start}-${i}@training-scheduler`, date, start, duration, title, description, location: loc, type,
  }));
  document.title = `לו"ז · ${payload.n}`;
  const byDay = new Map();
  for (const e of events) { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); }
  const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const isAndroid = /Android/.test(navigator.userAgent);

  main.innerHTML = `
    <header class="trainee-head">
      <h1>${esc(payload.n)}</h1>
      <button class="btn primary big" id="add-all">📅 הוספת כל הלו"ז ליומן</button>
      <p class="hint">${isAndroid
        ? 'באנדרואיד גוגל קלנדר לא תמיד פותח את הקובץ. אפשר להוסיף כל משבצת בנפרד עם כפתור "+ ליומן", או לייבא את הקובץ ממחשב (calendar.google.com ← הגדרות ← ייבוא).'
        : isIos ? 'אחרי ההורדה: פותחים את הקובץ ← "הוסף הכל".' : 'בגוגל קלנדר: הגדרות ← ייבוא ובוחרים את הקובץ שהורד.'}</p>
    </header>
    ${[...byDay].map(([date, list]) => `<section class="t-day">
      <h2>${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
      <ul class="t-events">${list.map((e) => `<li class="type-${e.type}">
        <div class="t-time">${fmtTime(e.start)}<br><span class="muted">${fmtTime(e.start + e.duration)}</span></div>
        <div class="t-body"><b>${e.type && BLOCK_TYPES[e.type] ? BLOCK_TYPES[e.type].icon + ' ' : ''}${esc(e.title)}</b>
          ${e.location ? `<div class="muted">📍 ${esc(e.location)}</div>` : ''}
          ${e.description ? `<div class="muted">${esc(e.description)}</div>` : ''}</div>
        <a class="btn small" href="${esc(googleLink(e))}" target="_blank" rel="noopener">+ ליומן</a>
      </li>`).join('')}</ul></section>`).join('')}`;
  main.querySelector('#add-all').onclick = () => download(`${payload.n}.ics`, buildIcs(payload.n, events), 'text/calendar;charset=utf-8');
}
init();
