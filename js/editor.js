// Training editor: drag & drop schedule board, equipment summary and trainee export.
import { data, store } from './store.js';
import {
  esc, ltr, durRange, timeRange, uid, fmtTime, parseTime, fmtDur, fmtDate, addDays, snap, clamp, toast, download, byName,
  DAY_START, DAY_END, SNAP, DEFAULT_APPEND_START, CATEGORIES, BLOCK_TYPES,
} from './util.js';
import { openModal, confirmDialog } from './modal.js';
import { summarize, equipmentEditorHtml, bindEquipmentEditor, readEquipmentEditor, rowLabel, KINDS } from './equipment.js';
import { buildIcs, googleLink } from './ics.js';
import { encodeShare } from './share.js';
import { flushRender, lessonModal } from './app.js';

const view = { ppm: 1.4, search: '', cat: '', selectedDay: null, scroll: null, trainingId: null, scrollToMin: null };
let drag = null;
export const isDragging = () => !!drag;

// Phones: one day at a time, lessons added from a bottom sheet, blocks moved with long-press.
export const mobileQuery = window.matchMedia('(max-width: 800px)');
const isMobile = () => mobileQuery.matches;
const LONG_PRESS_MS = 350;
// SVG chevrons: text arrows (‹ ›) get mirrored in RTL, these never do.
const chevron = (d) => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${d}"/></svg>`;
const CHEVRON_RIGHT = chevron('M9 5l7 7-7 7');
const CHEVRON_LEFT = chevron('M15 5l-7 7 7 7');

// While a touch drag is active, stop the page from scrolling under the finger.
document.addEventListener('touchmove', (e) => { if (drag?.armed) e.preventDefault(); }, { passive: false });

/* ---------- helpers ---------- */
export function blockTitle(b) {
  if (b.title) return b.title;
  if (b.type === 'lesson') return data.lessons.get(b.lessonId)?.name || '(שיעור נמחק)';
  return BLOCK_TYPES[b.type]?.label || '';
}
function blockColor(b) {
  if (b.type === 'lesson') {
    const l = data.lessons.get(b.lessonId);
    return l ? l.color || CATEGORIES[l.category]?.color : '#ef4444';
  }
  return BLOCK_TYPES[b.type]?.color || '#999';
}
function blockRange(b) {
  const l = b.type === 'lesson' && data.lessons.get(b.lessonId);
  return l ? [l.min, l.max] : [SNAP, DAY_END - DAY_START];
}
const sortedDays = (t) => [...t.days].sort((a, b) => a.date.localeCompare(b.date));

function save(t, patch) {
  const next = { ...t, ...patch };
  store.put('trainings', next);
  return next;
}

// Side-by-side lanes for overlapping blocks
function layoutDay(blocks) {
  const sorted = [...blocks].sort((a, b) => a.start - b.start || b.duration - a.duration);
  const out = new Map();
  let cluster = [], clusterEnd = -1;
  const flush = () => {
    const lanes = [];
    for (const b of cluster) {
      let i = lanes.findIndex((end) => end <= b.start);
      if (i === -1) { i = lanes.length; lanes.push(0); }
      lanes[i] = b.start + b.duration;
      out.set(b.id, { lane: i });
    }
    for (const b of cluster) Object.assign(out.get(b.id), { lanes: lanes.length });
    cluster = []; clusterEnd = -1;
  };
  for (const b of sorted) {
    if (cluster.length && b.start >= clusterEnd) flush();
    cluster.push(b); clusterEnd = Math.max(clusterEnd, b.start + b.duration);
  }
  flush();
  return out;
}

/* ---------- main render ---------- */
export function renderEditor(main, t, tab) {
  // keep scroll positions across re-renders
  const gs = main.querySelector('.grid-scroll'), pl = main.querySelector('.palette-list');
  if (gs && view.trainingId === t.id) view.scroll = { top: gs.scrollTop, left: gs.scrollLeft, pal: pl?.scrollTop || 0 };
  else if (view.trainingId !== t.id) { view.scroll = null; view.selectedDay = null; }
  view.trainingId = t.id;
  if (!t.days.some((d) => d.id === view.selectedDay)) view.selectedDay = sortedDays(t)[0]?.id || null;

  const tabs = [['schedule', 'לו"ז'], ['equipment', 'ציוד'], ['share', 'שליחה למתאמנים']];
  main.innerHTML = `<div class="editor">
    <div class="editor-head">
      <a href="#/trainings" class="back" title="חזרה לאימונים">→<span class="desktop-only"> אימונים</span></a>
      <input class="title-input" id="t-name" value="${esc(t.name)}" aria-label="שם האימון">
      <label class="inline desktop-only">מתאמנים <input id="t-trainees" type="number" min="1" value="${t.trainees}"></label>
      <label class="inline desktop-only">מיקום <input id="t-location" value="${esc(t.location || '')}" placeholder="—"></label>
      <button class="icon-btn mobile-only" id="t-settings" title="פרטי האימון">⚙️</button>
      <nav class="tabs">${tabs.map(([k, v]) => `<a href="#/training/${t.id}/${k}" class="${tab === k ? 'active' : ''}">${v}</a>`).join('')}</nav>
    </div>
    <div class="editor-body tab-${tab}" id="editor-body"></div>
  </div>`;
  main.querySelector('#t-name').onchange = (e) => e.target.value.trim() && save(t, { name: e.target.value.trim() });
  main.querySelector('#t-trainees').onchange = (e) => save(t, { trainees: Math.max(1, +e.target.value || 1) });
  main.querySelector('#t-location').onchange = (e) => save(t, { location: e.target.value.trim() });
  main.querySelector('#t-settings').onclick = () => openModal({
    title: 'פרטי האימון',
    body: `<label>שם<input name="name" value="${esc(t.name)}"></label>
      <div class="row">
        <label>מספר מתאמנים<input name="trainees" type="number" inputmode="numeric" min="1" value="${t.trainees}"></label>
        <label>מיקום<input name="location" value="${esc(t.location || '')}"></label>
      </div>`,
    onSave: (f) => {
      const cur = data.trainings.get(t.id);
      save(cur, { name: f.name.value.trim() || cur.name, trainees: Math.max(1, +f.trainees.value || 1), location: f.location.value.trim() });
    },
  });

  const body = main.querySelector('#editor-body');
  if (tab === 'equipment') return renderEquipment(body, t);
  if (tab === 'share') return renderShare(body, t);
  renderSchedule(body, t);
}

/* ---------- schedule board ---------- */
function paletteListHtml(t) {
  const q = view.search.trim();
  const used = new Map();
  for (const b of t.blocks) if (b.lessonId) used.set(b.lessonId, (used.get(b.lessonId) || 0) + 1);
  const lessons = [...data.lessons.values()].sort(byName)
    .filter((l) => (!view.cat || l.category === view.cat) && (!q || l.name.includes(q)));
  return lessons.map((l) => `<div class="pal-item" data-lesson="${l.id}" style="--c:${l.color || CATEGORIES[l.category].color}" title="גררו ללו&quot;ז, או לחצו להוספה בסוף היום הנבחר">
      <div class="pal-name">${esc(l.name)}</div>
      <div class="pal-meta">${fmtDur(l.ideal)} <span class="muted">(${durRange(l.min, l.max)})</span>
        ${used.get(l.id) ? `<span class="used">✓${used.get(l.id) > 1 ? '×' + used.get(l.id) : ''}</span>` : ''}
        ${(l.equipment || []).length ? '<span class="muted" title="יש ציוד מוגדר">🎒</span>' : ''}</div>
    </div>`).join('') || '<p class="muted pad">אין תוצאות</p>';
}

function renderSchedule(body, t) {
  const days = sortedDays(t);
  const mobile = isMobile();
  const shown = mobile ? days.filter((d) => d.id === view.selectedDay) : days;
  const dayIdx = days.findIndex((d) => d.id === view.selectedDay);
  const height = (DAY_END - DAY_START) * view.ppm;
  const hours = [];
  for (let m = DAY_START; m < DAY_END; m += 30) hours.push(m);

  const prevScroll = body.querySelector('.grid-scroll');
  if (prevScroll) view.scroll = { top: prevScroll.scrollTop, left: prevScroll.scrollLeft, pal: body.querySelector('.palette-list')?.scrollTop || 0 };

  const toolbar = mobile
    ? `<div class="board-toolbar day-switch">
        <button class="icon-btn big" id="day-next" ${dayIdx >= days.length - 1 ? 'disabled' : ''} title="היום הבא" aria-label="היום הבא">${CHEVRON_RIGHT}</button>
        <button class="day-switch-label" id="day-label">${dayIdx >= 0 ? `יום ${dayIdx + 1}/${days.length} · ${fmtDate(days[dayIdx].date)}` : 'אין ימים'}</button>
        <button class="icon-btn big" id="day-prev" ${dayIdx <= 0 ? 'disabled' : ''} title="היום הקודם" aria-label="היום הקודם">${CHEVRON_LEFT}</button>
        <button class="btn small" id="add-day">+ יום</button>
      </div>`
    : `<div class="board-toolbar">
        <button class="btn small" id="add-day">+ הוספת יום</button>
        <span class="muted">גררו שיעורים ללוח · משכו את התחתית לשינוי אורך · לחיצה לעריכה</span>
        <span class="spacer"></span>
        <button class="icon-btn" id="zoom-out" title="הקטנה">−</button>
        <button class="icon-btn" id="zoom-in" title="הגדלה">+</button>
      </div>`;

  body.innerHTML = `<div class="schedule ${mobile ? 'mobile' : ''}">
    <aside class="palette">
      <input type="search" id="pal-search" placeholder="חיפוש שיעור…" value="${esc(view.search)}">
      <div class="chips">
        <button class="chip-btn ${!view.cat ? 'active' : ''}" data-cat="">הכל</button>
        ${Object.entries(CATEGORIES).map(([k, c]) => `<button class="chip-btn ${view.cat === k ? 'active' : ''}" data-cat="${k}">${c.label}</button>`).join('')}
      </div>
      <div class="pal-special">
        ${Object.entries(BLOCK_TYPES).map(([k, v]) => `<div class="pal-item special" data-special="${k}" style="--c:${v.color}">${v.icon} ${v.label}</div>`).join('')}
      </div>
      <div class="palette-list">${paletteListHtml(t)}</div>
      <button class="btn small" id="new-lesson">+ שיעור חדש למאגר</button>
    </aside>
    <section class="board">
      ${toolbar}
      <div class="grid-scroll">
        ${shown.length ? `<div class="grid" style="--ppm:${view.ppm}">
          <div class="time-col">
            <div class="col-head"></div>
            <div class="time-body" style="height:${height}px">
              ${hours.map((m) => `<div class="time-label ${m % 60 ? 'half' : ''}" style="top:${(m - DAY_START) * view.ppm}px">${fmtTime(m)}</div>`).join('')}
            </div>
          </div>
          ${shown.map((d) => dayColumnHtml(t, d, height)).join('')}
        </div>` : '<p class="empty">אין ימים באימון. הוסיפו יום כדי להתחיל.</p>'}
      </div>
      ${mobile && shown.length ? `<p class="mobile-hint">לחיצה על משבצת לעריכה · לחיצה ארוכה וגרירה להזזה</p>
        <button class="fab" id="fab-add">+ הוספה</button>` : ''}
    </section>
  </div>`;

  if (mobile) {
    const go = (i) => { if (days[i]) { view.selectedDay = days[i].id; renderSchedule(body, t); } };
    body.querySelector('#day-prev').onclick = () => go(dayIdx - 1);
    body.querySelector('#day-next').onclick = () => go(dayIdx + 1);
    body.querySelector('#day-label').onclick = () => dayIdx >= 0 && dayModal(t, days[dayIdx]);
    body.querySelector('#fab-add')?.addEventListener('click', () => openAddSheet(t));
    // Horizontal swipe switches days, matching the arrows: swipe left = next day
    const gs = body.querySelector('.grid-scroll');
    let sx = 0, sy = 0;
    gs.addEventListener('touchstart', (e) => { sx = e.touches[0].clientX; sy = e.touches[0].clientY; }, { passive: true });
    gs.addEventListener('touchend', (e) => {
      if (drag) return;
      const dx = e.changedTouches[0].clientX - sx, dy = e.changedTouches[0].clientY - sy;
      if (Math.abs(dx) > 70 && Math.abs(dx) > 2 * Math.abs(dy)) go(dayIdx + (dx < 0 ? 1 : -1));
    });
  }

  // palette
  const search = body.querySelector('#pal-search');
  const list = body.querySelector('.palette-list');
  search.oninput = () => { view.search = search.value; list.innerHTML = paletteListHtml(t); };
  body.querySelectorAll('.chip-btn').forEach((b) => (b.onclick = () => {
    view.cat = b.dataset.cat;
    body.querySelectorAll('.chip-btn').forEach((x) => x.classList.toggle('active', x === b));
    list.innerHTML = paletteListHtml(t);
  }));
  body.querySelector('#new-lesson').onclick = () => lessonModal();
  body.querySelector('#add-day').onclick = () => addDayModal(t);
  body.querySelector('#zoom-in')?.addEventListener('click', () => { view.ppm = Math.min(3, view.ppm + 0.3); keepCenter(body); renderSchedule(body, t); });
  body.querySelector('#zoom-out')?.addEventListener('click', () => { view.ppm = Math.max(0.6, view.ppm - 0.3); keepCenter(body); renderSchedule(body, t); });

  body.querySelector('.palette').addEventListener('pointerdown', (e) => {
    const item = e.target.closest('.pal-item');
    if (!item || e.button !== 0) return;
    if (item.dataset.lesson) {
      const l = data.lessons.get(item.dataset.lesson);
      beginDrag(e, t, { kind: 'new', template: { type: 'lesson', lessonId: l.id }, duration: l.ideal, title: l.name, color: item.style.getPropertyValue('--c') });
    } else {
      const type = item.dataset.special;
      const duration = { meal: 60, break: 20, external: 120 }[type];
      beginDrag(e, t, { kind: 'new', template: { type }, duration, title: BLOCK_TYPES[type].label, color: BLOCK_TYPES[type].color });
    }
  });

  // board
  const grid = body.querySelector('.grid');
  if (grid) {
    grid.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      const blockEl = e.target.closest('.block');
      if (blockEl) {
        const b = t.blocks.find((x) => x.id === blockEl.dataset.id);
        const kind = e.target.closest('.resize') ? 'resize' : 'move';
        const offsetMin = (e.clientY - blockEl.getBoundingClientRect().top) / view.ppm;
        beginDrag(e, t, { kind, block: b, el: blockEl, duration: b.duration, offsetMin, title: blockTitle(b), color: blockColor(b) });
        return;
      }
      const col = e.target.closest('.day-col');
      if (col) selectDay(body, col.dataset.day);
      if (e.target.closest('.day-date')) dayModal(t, t.days.find((d) => d.id === col.dataset.day));
    });
  }

  // restore scroll (first open: 07:00)
  const gs = body.querySelector('.grid-scroll');
  const pl = body.querySelector('.palette-list');
  if (view.scroll) { gs.scrollTop = view.scroll.top; gs.scrollLeft = view.scroll.left; pl.scrollTop = view.scroll.pal; }
  else gs.scrollTop = 60 * view.ppm - 12;
  if (view.scrollToMin != null) {
    // bring a just-added block into view
    const top = (view.scrollToMin - DAY_START) * view.ppm;
    if (top < gs.scrollTop || top > gs.scrollTop + gs.clientHeight - 80) gs.scrollTop = top - 60;
    view.scrollToMin = null;
  }
}

function keepCenter(body) {
  const gs = body.querySelector('.grid-scroll');
  if (!gs) return;
  const ratio = (gs.scrollTop + gs.clientHeight / 2) / gs.scrollHeight;
  view.scroll = { top: 0, left: gs.scrollLeft, pal: body.querySelector('.palette-list').scrollTop };
  requestAnimationFrame(() => {
    const g = body.querySelector('.grid-scroll');
    g.scrollTop = ratio * g.scrollHeight - g.clientHeight / 2;
  });
}

function selectDay(body, dayId) {
  view.selectedDay = dayId;
  body.querySelectorAll('.day-col').forEach((c) => c.classList.toggle('selected', c.dataset.day === dayId));
}

function dayColumnHtml(t, d, height) {
  const blocks = t.blocks.filter((b) => b.dayId === d.id);
  const lay = layoutDay(blocks);
  const content = blocks.filter((b) => b.type === 'lesson').reduce((s, b) => s + b.duration, 0);
  const first = Math.min(...blocks.map((b) => b.start)), last = Math.max(...blocks.map((b) => b.start + b.duration));
  const idx = sortedDays(t).indexOf(d) + 1;
  return `<div class="day-col ${view.selectedDay === d.id ? 'selected' : ''}" data-day="${d.id}">
    <div class="col-head">
      <button class="day-date" title="שינוי תאריך / מחיקת יום">יום ${idx} · ${fmtDate(d.date)}</button>
      <div class="day-meta">${blocks.length ? `${ltr(timeRange(first, last))} · תוכן ${fmtDur(content)}` : 'ריק'}</div>
    </div>
    <div class="day-body" style="height:${height}px">
      ${blocks.map((b) => blockHtml(b, lay.get(b.id))).join('')}
    </div>
  </div>`;
}

function blockHtml(b, pos) {
  const [min, max] = blockRange(b);
  const out = b.duration < min || b.duration > max;
  const w = 100 / pos.lanes;
  const l = b.type === 'lesson' && data.lessons.get(b.lessonId);
  const cls = ['block', `type-${b.type}`, pos.lanes > 1 ? 'conflict' : '', out ? 'out-of-range' : '', b.duration * view.ppm < 34 ? 'compact' : ''].join(' ');
  return `<div class="${cls}" data-id="${b.id}" style="top:${(b.start - DAY_START) * view.ppm}px;height:${b.duration * view.ppm}px;inset-inline-start:${pos.lane * w}%;width:calc(${w}% - 4px);--c:${blockColor(b)}"
      title="${esc(blockTitle(b))}\n${fmtTime(b.start)} עד ${fmtTime(b.start + b.duration)}${l ? `\nטווח: ${durRange(l.min, l.max)}` : ''}${pos.lanes > 1 ? '\n⚠ חפיפה עם משבצת אחרת' : ''}">
    <div class="block-title">${b.type !== 'lesson' ? BLOCK_TYPES[b.type].icon + ' ' : ''}${esc(blockTitle(b))}</div>
    <div class="block-time"><span class="range ltr">${timeRange(b.start, b.start + b.duration)}</span> · <span class="dur">${fmtDur(b.duration)}</span>${out ? ' ⚠' : ''}</div>
    <div class="resize" title="שינוי אורך"></div>
  </div>`;
}

/* ---------- drag & drop (pointer events: mouse + touch) ---------- */
// Mouse: drag starts after a small move. Touch: a short swipe scrolls as usual, and a
// long press "lifts" the block so it can be dragged (resize handles drag immediately).
function beginDrag(e, t, spec) {
  const touch = e.pointerType === 'touch' && spec.kind !== 'resize';
  if (!touch) e.preventDefault();
  drag = { ...spec, t, touch, armed: !touch, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, started: false, target: null };
  if (touch) {
    drag.pressTimer = setTimeout(() => {
      if (!drag) return;
      drag.armed = true;
      navigator.vibrate?.(15);
      startVisuals();
      update();
    }, LONG_PRESS_MS);
  }
  window.addEventListener('pointermove', onMove);
  window.addEventListener('pointerup', onUp);
  window.addEventListener('pointercancel', cancelDrag);
}

function startVisuals() {
  drag.started = true;
  document.body.classList.add('dragging-active');
  if (drag.kind === 'resize') {
    drag.el.classList.add('resizing');
  } else {
    drag.ghost = document.createElement('div');
    drag.ghost.className = 'drag-ghost';
    drag.ghost.style.setProperty('--c', drag.color);
    drag.ghost.textContent = drag.title;
    document.body.appendChild(drag.ghost);
    drag.el?.classList.add('drag-source');
    drag.preview = document.createElement('div');
    drag.preview.className = 'drop-preview';
    drag.preview.style.setProperty('--c', drag.color);
  }
  drag.timer = setInterval(autoScroll, 30);
}

function autoScroll() {
  const gs = document.querySelector('.grid-scroll');
  if (!gs) return;
  const r = gs.getBoundingClientRect(), edge = 50, sp = 14;
  let moved = false;
  if (drag.y < r.top + edge && drag.y > r.top - 100) { gs.scrollTop -= sp; moved = true; }
  if (drag.y > r.bottom - edge) { gs.scrollTop += sp; moved = true; }
  if (drag.kind !== 'resize') {
    if (drag.x < r.left + edge && drag.x > r.left) { gs.scrollLeft -= sp; moved = true; }
    if (drag.x > r.right - edge && drag.x < r.right) { gs.scrollLeft += sp; moved = true; }
  }
  if (moved) update();
}

function onMove(e) {
  drag.x = e.clientX; drag.y = e.clientY;
  if (!drag.armed) {
    // finger moved before the long press fired: it's a scroll, not a drag
    if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) > 8) { drag.scrolled = true; clearTimeout(drag.pressTimer); }
    return;
  }
  if (!drag.started) {
    if (Math.hypot(drag.x - drag.x0, drag.y - drag.y0) < 5) return;
    startVisuals();
  }
  update();
}

function update() {
  const { x, y } = drag;
  if (drag.kind === 'resize') {
    const body = drag.el.parentElement.getBoundingClientRect();
    const [min, max] = blockRange(drag.block);
    const end = snap(DAY_START + (y - body.top) / view.ppm);
    drag.duration = clamp(end - drag.block.start, min, Math.min(max, DAY_END - drag.block.start));
    drag.el.style.height = `${drag.duration * view.ppm}px`;
    drag.el.querySelector('.range').textContent = timeRange(drag.block.start, drag.block.start + drag.duration);
    drag.el.querySelector('.dur').textContent = fmtDur(drag.duration);
    return;
  }
  // keep the ghost visible above the finger on touch
  drag.ghost.style.left = `${drag.touch ? x - 60 : x + 12}px`;
  drag.ghost.style.top = `${drag.touch ? y - 56 : y + 8}px`;
  const gs = document.querySelector('.grid-scroll');
  const gsr = gs?.getBoundingClientRect();
  const inside = gsr && x >= gsr.left && x <= gsr.right && y >= gsr.top - 20 && y <= gsr.bottom;
  const col = inside && [...document.querySelectorAll('.day-body')].find((c) => {
    const r = c.getBoundingClientRect(); return x >= r.left && x <= r.right;
  });
  if (!col) { drag.target = null; drag.preview.remove(); return; }
  const r = col.getBoundingClientRect();
  const offset = drag.kind === 'move' ? drag.offsetMin : 0;
  const start = clamp(snap(DAY_START + (y - r.top) / view.ppm - offset), DAY_START, DAY_END - drag.duration);
  drag.target = { dayId: col.parentElement.dataset.day, start };
  drag.preview.style.top = `${(start - DAY_START) * view.ppm}px`;
  drag.preview.style.height = `${drag.duration * view.ppm}px`;
  drag.preview.textContent = timeRange(start, start + drag.duration);
  if (drag.preview.parentElement !== col) col.appendChild(drag.preview);
}

function cleanup() {
  window.removeEventListener('pointermove', onMove);
  window.removeEventListener('pointerup', onUp);
  window.removeEventListener('pointercancel', cancelDrag);
  clearInterval(drag.timer);
  clearTimeout(drag.pressTimer);
  drag.ghost?.remove(); drag.preview?.remove();
  drag.el?.classList.remove('drag-source', 'resizing');
  document.body.classList.remove('dragging-active');
  const d = drag; drag = null;
  return d;
}
function cancelDrag() { cleanup(); flushRender(); }

function onUp() {
  const d = cleanup();
  const t = data.trainings.get(d.t.id) || d.t;
  if (d.scrolled) return flushRender();
  if (!d.started) {
    // a lifted-but-not-moved touch block is a no-op; a plain tap opens / adds
    if (d.touch && d.armed) return flushRender();
    if (d.kind === 'new') appendToSelectedDay(t, d);
    else blockModal(t, d.block);
    return flushRender();
  }
  if (d.kind === 'resize') {
    save(t, { blocks: t.blocks.map((b) => (b.id === d.block.id ? { ...b, duration: d.duration } : b)) });
  } else if (d.target) {
    if (d.kind === 'move') {
      save(t, { blocks: t.blocks.map((b) => (b.id === d.block.id ? { ...b, ...d.target } : b)) });
    } else {
      view.selectedDay = d.target.dayId;
      save(t, { blocks: [...t.blocks, { id: uid(), ...d.template, ...d.target, duration: d.duration }] });
    }
  }
  flushRender();
}

function appendToSelectedDay(t, d) {
  const day = t.days.find((x) => x.id === view.selectedDay);
  if (!day) { toast('הוסיפו יום לאימון קודם'); return; }
  const dayBlocks = t.blocks.filter((b) => b.dayId === day.id);
  const start = dayBlocks.length ? Math.max(...dayBlocks.map((b) => b.start + b.duration)) : DEFAULT_APPEND_START;
  if (start + d.duration > DAY_END) { toast('אין מספיק מקום בסוף היום הזה'); return; }
  save(t, { blocks: [...t.blocks, { id: uid(), ...d.template, dayId: day.id, start, duration: d.duration }] });
  toast(`נוסף ל${fmtDate(day.date)} ב-${fmtTime(start)}`);
}

const dayEnd = (t, dayId) => {
  const bs = t.blocks.filter((b) => b.dayId === dayId);
  return bs.length ? Math.max(...bs.map((b) => b.start + b.duration)) : DEFAULT_APPEND_START;
};

// Bottom sheet for phones: pick a lesson/meal/break and a start time (default: end of the day).
function openAddSheet(t) {
  const day = t.days.find((d) => d.id === view.selectedDay);
  if (!day) return;
  const root = document.getElementById('modal-root');
  const start = Math.min(dayEnd(t, day.id), DAY_END - SNAP);
  root.innerHTML = `<div class="modal-backdrop sheet-backdrop">
    <div class="modal sheet add-sheet">
      <header><h2>הוספה ל${esc(fmtDate(day.date))}</h2><button type="button" class="icon-btn" data-close>✕</button></header>
      <div class="sheet-controls">
        <label class="inline">שעת התחלה <input type="time" step="600" id="add-start" value="${fmtTime(start)}"></label>
        <input type="search" id="sheet-search" placeholder="חיפוש שיעור…" value="${esc(view.search)}">
        <div class="chips">
          <button class="chip-btn ${!view.cat ? 'active' : ''}" data-cat="">הכל</button>
          ${Object.entries(CATEGORIES).map(([k, c]) => `<button class="chip-btn ${view.cat === k ? 'active' : ''}" data-cat="${k}">${c.label}</button>`).join('')}
        </div>
        <div class="pal-special">
          ${Object.entries(BLOCK_TYPES).map(([k, v]) => `<button class="pal-item special" data-special="${k}" style="--c:${v.color}">${v.icon} ${v.label}</button>`).join('')}
        </div>
      </div>
      <div class="sheet-list">${paletteListHtml(t)}</div>
      <button class="btn small sheet-new" id="sheet-new-lesson">+ שיעור חדש למאגר</button>
    </div>
  </div>`;
  const close = () => { root.innerHTML = ''; };
  root.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  root.querySelector('.sheet-backdrop').addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
  const list = root.querySelector('.sheet-list');
  const search = root.querySelector('#sheet-search');
  search.oninput = () => { view.search = search.value; list.innerHTML = paletteListHtml(t); };
  root.querySelectorAll('.chip-btn').forEach((b) => (b.onclick = () => {
    view.cat = b.dataset.cat;
    root.querySelectorAll('.chip-btn').forEach((x) => x.classList.toggle('active', x === b));
    list.innerHTML = paletteListHtml(t);
  }));
  root.querySelector('#sheet-new-lesson').onclick = () => { close(); lessonModal(); };
  root.querySelector('.add-sheet').addEventListener('click', (e) => {
    const item = e.target.closest('.pal-item');
    if (!item) return;
    let template, duration;
    if (item.dataset.lesson) {
      const l = data.lessons.get(item.dataset.lesson);
      template = { type: 'lesson', lessonId: l.id }; duration = l.ideal;
    } else {
      template = { type: item.dataset.special }; duration = { meal: 60, break: 20, external: 120 }[item.dataset.special];
    }
    const s = snap(parseTime(root.querySelector('#add-start').value || fmtTime(start)));
    const at = clamp(s, DAY_START, DAY_END - SNAP);
    const dur = Math.min(duration, DAY_END - at);
    const cur = data.trainings.get(t.id);
    view.scrollToMin = at;
    close();
    save(cur, { blocks: [...cur.blocks, { id: uid(), ...template, dayId: day.id, start: at, duration: dur }] });
    toast(`נוסף ב-${fmtTime(at)}`);
  });
}

/* ---------- modals ---------- */
function blockModal(t, b) {
  const l = b.type === 'lesson' ? data.lessons.get(b.lessonId) : null;
  const [min, max] = blockRange(b);
  const days = sortedDays(t);
  const form = openModal({
    title: l ? l.name : blockTitle(b), wide: true,
    body: `${l ? `<p class="muted">${CATEGORIES[l.category].label} · אידיאלי ${fmtDur(l.ideal)} · טווח ${durRange(l.min, l.max)}
        · <a href="#" id="edit-lesson">עריכת השיעור במאגר</a></p>` : ''}
      <label>${l ? 'כותרת (ריק = שם השיעור)' : 'כותרת'}<input name="title" value="${esc(b.title || '')}" placeholder="${esc(l?.name || BLOCK_TYPES[b.type]?.label || '')}"></label>
      <div class="row">
        <label>יום<select name="day">${days.map((d, i) => `<option value="${d.id}" ${d.id === b.dayId ? 'selected' : ''}>יום ${i + 1} · ${fmtDate(d.date)}</option>`).join('')}</select></label>
        <label>שעת התחלה<span class="stepper"><button type="button" data-step="start:-10">−</button><input name="start" type="time" step="600" value="${fmtTime(b.start)}"><button type="button" data-step="start:10">+</button></span></label>
        <label>משך (דק')<span class="stepper"><button type="button" data-step="duration:-10">−</button><input name="duration" type="number" inputmode="numeric" step="${SNAP}" min="${min}" max="${max}" value="${b.duration}"><button type="button" data-step="duration:10">+</button></span></label>
      </div>
      <label>מיקום (ריק = מיקום האימון)<input name="location" value="${esc(b.location || '')}"></label>
      <label>הערות (יופיעו ביומן של המתאמנים)<textarea name="notes" rows="2">${esc(b.notes || '')}</textarea></label>
      <h3>ציוד נוסף למשבצת הזו</h3>
      ${l && l.equipment?.length ? `<p class="muted">מהשיעור: ${l.equipment.map((r) => `${esc(data.items.get(r.itemId)?.name || '?')} × ${rowLabel(r)}`).join(', ')}</p>` : ''}
      ${equipmentEditorHtml(b.equipment || [])}`,
    extraButtons: `<button type="button" class="btn danger" id="del-block">מחיקה</button><button type="button" class="btn" id="dup-block">שכפול</button>`,
    onSave: async (f) => {
      const start = snap(parseTime(f.start.value));
      const duration = snap(+f.duration.value);
      if (duration < min || duration > max) { toast(`המשך צריך להיות בין ${min} ל-${max} דקות`); return false; }
      if (start < DAY_START || start + duration > DAY_END) { toast('המשבצת חייבת להיות בין 06:00 ל-00:00'); return false; }
      const equipment = await readEquipmentEditor(f);
      const nb = { ...b, title: f.title.value.trim(), dayId: f.day.value, start, duration, location: f.location.value.trim(), notes: f.notes.value.trim(), equipment };
      const cur = data.trainings.get(t.id);
      save(cur, { blocks: cur.blocks.map((x) => (x.id === b.id ? nb : x)) });
    },
  });
  bindEquipmentEditor(form);
  form.querySelectorAll('[data-step]').forEach((btn) => (btn.onclick = () => {
    const [field, delta] = btn.dataset.step.split(':');
    const input = form[field];
    if (field === 'start') {
      input.value = fmtTime(clamp(parseTime(input.value) + +delta, DAY_START, DAY_END - SNAP));
    } else {
      input.value = clamp((+input.value || 0) + +delta, min, max);
    }
  }));
  form.querySelector('#edit-lesson')?.addEventListener('click', (e) => { e.preventDefault(); form.close(); lessonModal(l); });
  form.querySelector('#del-block').onclick = () => {
    const cur = data.trainings.get(t.id);
    save(cur, { blocks: cur.blocks.filter((x) => x.id !== b.id) });
    form.close();
  };
  form.querySelector('#dup-block').onclick = () => {
    const cur = data.trainings.get(t.id);
    const dayBlocks = cur.blocks.filter((x) => x.dayId === b.dayId);
    const start = Math.max(...dayBlocks.map((x) => x.start + x.duration));
    if (start + b.duration > DAY_END) { toast('אין מקום בסוף היום לשכפול'); return; }
    save(cur, { blocks: [...cur.blocks, { ...structuredClone(b), id: uid(), start }] });
    form.close();
    toast(`שוכפל לסוף היום (${fmtTime(start)})`);
  };
}

function addDayModal(t) {
  const last = sortedDays(t).at(-1)?.date;
  openModal({
    title: 'הוספת יום',
    body: `<label>תאריך<input name="date" type="date" value="${last ? addDays(last, 1) : new Date().toISOString().slice(0, 10)}" required></label>`,
    saveLabel: 'הוספה',
    onSave: (f) => {
      if (!f.date.value) return false;
      if (t.days.some((d) => d.date === f.date.value)) { toast('התאריך כבר קיים באימון'); return false; }
      const id = uid(); view.selectedDay = id;
      save(t, { days: [...t.days, { id, date: f.date.value }] });
    },
  });
}

function dayModal(t, day) {
  const n = t.blocks.filter((b) => b.dayId === day.id).length;
  const form = openModal({
    title: `יום ${fmtDate(day.date)}`,
    body: `<label>תאריך<input name="date" type="date" value="${day.date}" required></label>
      <p class="hint">שינוי התאריך מזיז את כל המשבצות של היום.</p>`,
    extraButtons: '<button type="button" class="btn danger" id="del-day">מחיקת היום</button>',
    onSave: (f) => {
      if (!f.date.value) return false;
      if (t.days.some((d) => d.date === f.date.value && d.id !== day.id)) { toast('התאריך כבר קיים באימון'); return false; }
      save(t, { days: t.days.map((d) => (d.id === day.id ? { ...d, date: f.date.value } : d)) });
    },
  });
  form.querySelector('#del-day').onclick = async () => {
    form.close();
    if (await confirmDialog(`למחוק את היום${n ? ` ואת ${n} המשבצות שבו` : ''}?`)) {
      save(t, { days: t.days.filter((d) => d.id !== day.id), blocks: t.blocks.filter((b) => b.dayId !== day.id) });
    }
  };
}

/* ---------- equipment tab ---------- */
function renderEquipment(body, t) {
  const sum = summarize(t, blockTitle);
  const packed = t.packed || {};
  const listHtml = (list, withCheck) => list.length ? `<table class="table eq-table"><tbody>${list.map((r) => `
      <tr class="${withCheck && packed[r.item.id] ? 'packed' : ''}">
        ${withCheck ? `<td class="chk"><input type="checkbox" data-item="${r.item.id}" ${packed[r.item.id] ? 'checked' : ''}></td>` : ''}
        <td class="qty">${r.qty}</td>
        <td><b>${esc(r.item.name)}</b> <span class="kind ${r.item.kind}">${KINDS[r.item.kind] || ''}</span>
          <div class="sources">${r.sources.map(esc).join(' · ')}</div></td>
      </tr>`).join('')}</tbody></table>` : '<p class="muted">אין ציוד מוגדר.</p>';
  const count = sum.total.length, done = sum.total.filter((r) => packed[r.item.id]).length;

  body.innerHTML = `<div class="page equipment-page">
    <div class="page-head">
      <h1>ציוד לאימון · ${t.trainees} מתאמנים</h1>
      <div class="actions no-print">
        <button class="btn" id="extras">ציוד כללי לאימון (${(t.extras || []).length})</button>
        <button class="btn" id="reset-packed">איפוס סימונים</button>
        <button class="btn primary" onclick="window.print()">הדפסה</button>
      </div>
    </div>
    <p class="hint no-print">רב-פעמי נספר לפי הכמות הגדולה שנדרשת במשבצת אחת, ומתכלה מצטבר בין המשבצות. ציוד "לפי מתאמנים" מחושב לפי ${t.trainees} מתאמנים.
      סוג הפריט נקבע במסך <a href="#/items">ציוד</a>.</p>
    <section class="eq-total">
      <h2>רשימת אריזה לכל האימון <span class="muted">(${done}/${count} נארזו)</span></h2>
      ${listHtml(sum.total, true)}
    </section>
    ${sum.days.length > 1 ? `<h2>לפי ימים</h2><div class="eq-days">${sum.days.map(({ day, list }, i) => `
      <section><h3>יום ${i + 1} · ${fmtDate(day.date)}</h3>${listHtml(list, false)}</section>`).join('')}</div>` : ''}
  </div>`;
  body.querySelectorAll('input[data-item]').forEach((cb) => (cb.onchange = () => {
    const cur = data.trainings.get(t.id);
    save(cur, { packed: { ...(cur.packed || {}), [cb.dataset.item]: cb.checked } });
  }));
  body.querySelector('#reset-packed').onclick = () => save(t, { packed: {} });
  body.querySelector('#extras').onclick = () => {
    const form = openModal({
      title: 'ציוד כללי לאימון', wide: true,
      body: `<p class="hint">ציוד שלא שייך לשיעור מסוים, למשל ערכת עזרה ראשונה או לוח מחיק. הוא מתווסף לרשימה הכוללת.</p>${equipmentEditorHtml(t.extras || [])}`,
      onSave: async (f) => { const extras = await readEquipmentEditor(f); save(data.trainings.get(t.id), { extras }); },
    });
    bindEquipmentEditor(form);
  };
}

/* ---------- share tab ---------- */
function traineeEvents(t) {
  const dayDate = new Map(t.days.map((d) => [d.id, d.date]));
  return t.blocks
    .filter((b) => dayDate.has(b.dayId) && (t.includeMeals !== false || !['meal', 'break'].includes(b.type)))
    .map((b) => ({
      uid: `${b.id}@training-scheduler`, date: dayDate.get(b.dayId), start: b.start, duration: b.duration,
      title: blockTitle(b), description: b.notes || '', location: b.location || t.location || '', type: b.type,
    }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
}

async function shareUrl(t) {
  const ev = traineeEvents(t);
  const payload = { n: t.name, b: ev.map((e) => [e.date, e.start, e.duration, e.title, e.description, e.location, e.type]) };
  return new URL(`view.html#${await encodeShare(payload)}`, location.href).href;
}

function renderShare(body, t) {
  const ev = traineeEvents(t);
  const byDay = new Map();
  for (const e of ev) { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); }
  body.innerHTML = `<div class="page narrow">
    <h1>שליחה למתאמנים</h1>
    <label class="check"><input type="checkbox" id="incl-meals" ${t.includeMeals !== false ? 'checked' : ''}> לכלול ארוחות והפסקות</label>
    <div class="share-actions">
      <div class="share-card">
        <h3>🔗 קישור לדף הלו"ז</h3>
        <p class="hint">שולחים למתאמנים בוואטסאפ. בדף יש כפתור "הוספת כל הלו"ז ליומן" וקישורים לגוגל קלנדר לכל משבצת.
          הקישור שומר את הלו"ז כפי שהוא עכשיו. אם משנים משהו, שולחים קישור חדש.</p>
        <div class="row"><button class="btn primary" id="copy-link">העתקת קישור</button>
          <button class="btn" id="copy-msg">העתקת הודעה לוואטסאפ</button>
          <button class="btn" id="open-view">תצוגה מקדימה</button></div>
      </div>
      <div class="share-card">
        <h3>📅 קובץ יומן (.ics)</h3>
        <p class="hint">קובץ אחד עם כל ${ev.length} המשבצות. בגוגל קלנדר במחשב: הגדרות ← ייבוא. באייפון: פותחים את הקובץ ומוסיפים הכל.</p>
        <button class="btn" id="dl-ics">הורדת קובץ</button>
      </div>
    </div>
    <h2>כל המשבצות</h2>
    ${[...byDay].map(([date, list]) => `<h3>${fmtDate(date, { weekday: 'long', day: 'numeric', month: 'long' })}</h3>
      <ul class="event-list">${list.map((e) => `<li><span class="nowrap ltr">${timeRange(e.start, e.start + e.duration)}</span>
        <span>${esc(e.title)}</span><a href="${esc(googleLink(e))}" target="_blank" rel="noopener" class="btn small">+ גוגל קלנדר</a></li>`).join('')}</ul>`).join('')
      || '<p class="empty">אין משבצות בלו"ז.</p>'}
  </div>`;
  body.querySelector('#incl-meals').onchange = (e) => save(t, { includeMeals: e.target.checked });
  body.querySelector('#dl-ics').onclick = () => download(`${t.name}.ics`, buildIcs(t.name, ev), 'text/calendar;charset=utf-8');
  body.querySelector('#copy-link').onclick = async () => { await navigator.clipboard.writeText(await shareUrl(t)); toast('הקישור הועתק'); };
  body.querySelector('#copy-msg').onclick = async () => {
    const dates = [...byDay.keys()];
    const range = dates.length > 1 ? `${fmtDate(dates[0], { day: 'numeric', month: 'numeric' })}–${fmtDate(dates.at(-1), { day: 'numeric', month: 'numeric' })}` : fmtDate(dates[0] || '', { day: 'numeric', month: 'numeric' });
    const msg = `לו"ז ${t.name} (${range})\nלצפייה ולהוספה ליומן:\n${await shareUrl(t)}`;
    await navigator.clipboard.writeText(msg); toast('ההודעה הועתקה');
  };
  body.querySelector('#open-view').onclick = async () => window.open(await shareUrl(t), '_blank');
}
