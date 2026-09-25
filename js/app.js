import { data, store, initStore, onChange } from './store.js';
import { esc, ltr, durRange, uid, fmtDate, fmtDur, addDays, todayIso, CATEGORIES, defaultRange, snap, SNAP, byName, toast } from './util.js';
import { openModal, confirmDialog } from './modal.js';
import { KINDS, isKit, kitModal, itemLabel, equipmentEditorHtml, bindEquipmentEditor, readEquipmentEditor, rowLabel } from './equipment.js';
import { renderEditor, isDragging, mobileQuery } from './editor.js';

const main = document.getElementById('main');
const ui = { lessonSearch: '', lessonCat: '' };

/* ---------- routing ---------- */
function route() {
  const [, name = 'trainings', id, tab] = location.hash.split('/');
  return { name, id, tab };
}

let pendingRender = false;
export function render() {
  if (isDragging()) { pendingRender = true; return; }
  pendingRender = false;
  renderUser();
  if (store.status === 'loading') { main.innerHTML = '<div class="loading">טוען…</div>'; return; }
  if (store.status === 'signed-out') return renderSignIn();
  if (store.status === 'denied') return renderDenied();
  const r = route();
  document.querySelectorAll('#nav a').forEach((a) => a.classList.toggle('active', a.dataset.route === (r.name === 'training' ? 'trainings' : r.name)));
  switch (r.name) {
    case 'training': {
      const t = data.trainings.get(r.id);
      if (!t) { location.hash = '#/trainings'; return; }
      return renderEditor(main, t, r.tab || 'schedule');
    }
    case 'lessons': return renderLessons();
    case 'items': return renderItems();
    case 'staff': return renderStaff();
    default: return renderTrainings();
  }
}
export const flushRender = () => { if (pendingRender) render(); };

function renderUser() {
  const el = document.getElementById('user');
  document.querySelectorAll('.firebase-only').forEach((x) => (x.hidden = store.mode !== 'firebase' || store.status !== 'ready'));
  if (store.mode === 'local') {
    el.innerHTML = '<span class="badge warn" title="הנתונים נשמרים רק בדפדפן הזה. ראו README לחיבור Firebase.">שמירה מקומית</span>';
  } else if (store.user) {
    el.innerHTML = `<span class="muted desktop-only">${esc(store.user.email)}</span> <button class="btn small" id="signout">יציאה</button>`;
    el.querySelector('#signout').onclick = () => store.signOut();
  } else el.innerHTML = '';
}

function renderSignIn() {
  main.innerHTML = `<div class="center-card"><h1>בונה לו"ז אימונים</h1><p>כניסה למדריכים מורשים בלבד.</p>
    <button class="btn primary" id="signin">התחברות עם Google</button></div>`;
  main.querySelector('#signin').onclick = () => store.signIn().catch((e) => toast(e.message));
}
function renderDenied() {
  main.innerHTML = `<div class="center-card"><h1>אין הרשאה</h1>
    <p>החשבון <b dir="ltr">${esc(store.user?.email)}</b> לא נמצא ברשימת הצוות.<br>בקשו ממדריך קיים להוסיף אתכם במסך "צוות".</p>
    <button class="btn" id="signout2">התחברות עם חשבון אחר</button></div>`;
  main.querySelector('#signout2').onclick = () => store.signOut();
}

/* ---------- trainings list ---------- */
function trainingRange(t) {
  const dates = t.days.map((d) => d.date).sort();
  if (!dates.length) return 'ללא תאריכים';
  const f = (d) => fmtDate(d, { day: 'numeric', month: 'numeric', year: '2-digit' });
  return ltr(dates.length === 1 ? f(dates[0]) : `${f(dates[0])} – ${f(dates.at(-1))}`);
}

function renderTrainings() {
  const list = [...data.trainings.values()].sort((a, b) => {
    const da = a.days.map((d) => d.date).sort()[0] || '', db = b.days.map((d) => d.date).sort()[0] || '';
    return db.localeCompare(da);
  });
  main.innerHTML = `<div class="page">
    <div class="page-head"><h1>אימונים</h1><button class="btn primary" id="new-training">+ אימון חדש</button></div>
    ${list.length ? '' : '<p class="empty">עוד אין אימונים. צרו אימון חדש כדי להתחיל.</p>'}
    <div class="cards">${list.map((t) => `
      <div class="card training-card" data-id="${t.id}">
        <a class="card-main" href="#/training/${t.id}">
          <h3>${esc(t.name)}</h3>
          <div class="muted">${trainingRange(t)} · ${t.days.length} ימים · ${t.trainees} מתאמנים</div>
          <div class="muted">${t.blocks.length} משבצות${t.location ? ' · ' + esc(t.location) : ''}</div>
        </a>
        <div class="card-actions">
          <button class="btn small" data-act="dup">שכפול</button>
          <button class="btn small danger" data-act="del">מחיקה</button>
        </div>
      </div>`).join('')}</div>
  </div>`;
  main.querySelector('#new-training').onclick = () => trainingModal();
  main.querySelectorAll('.training-card').forEach((card) => {
    const t = data.trainings.get(card.dataset.id);
    card.querySelector('[data-act=dup]').onclick = () => duplicateModal(t);
    card.querySelector('[data-act=del]').onclick = async () => {
      if (await confirmDialog(`למחוק את "${t.name}"?`)) store.remove('trainings', t.id);
    };
  });
}

function trainingModal() {
  openModal({
    title: 'אימון חדש',
    body: `<label>שם האימון<input name="name" required placeholder="שם האימון"></label>
      <div class="row">
        <label>מספר מתאמנים<input name="trainees" type="number" min="1" value="20"></label>
        <label>מיקום<input name="location" placeholder="אופציונלי"></label>
      </div>
      <div class="row">
        <label>תאריך יום ראשון<input name="date" type="date" value="${todayIso()}" required></label>
        <label>מספר ימים רצופים<input name="days" type="number" min="1" max="30" value="1"></label>
      </div>
      <p class="hint">למפגשים לא רצופים: צרו יום אחד והוסיפו תאריכים נוספים מתוך הלו"ז.</p>`,
    saveLabel: 'יצירה',
    onSave: async (f) => {
      const name = f.name.value.trim();
      if (!name || !f.date.value) { toast('צריך שם ותאריך'); return false; }
      const days = Array.from({ length: Math.max(1, +f.days.value || 1) }, (_, i) => ({ id: uid(), date: addDays(f.date.value, i) }));
      const t = { id: uid(), name, trainees: Math.max(1, +f.trainees.value || 1), location: f.location.value.trim(),
        days, blocks: [], extras: [], packed: {}, includeMeals: true, createdAt: Date.now() };
      await store.put('trainings', t);
      location.hash = `#/training/${t.id}`;
    },
  });
}

function duplicateModal(t) {
  const first = t.days.map((d) => d.date).sort()[0] || todayIso();
  openModal({
    title: `שכפול "${t.name}"`,
    body: `<label>שם<input name="name" value="${esc(t.name)} (עותק)"></label>
      <label>תאריך התחלה חדש<input name="date" type="date" value="${first}"></label>
      <p class="hint">כל הימים יוזזו באותו מרווח. ציוד שסומן כארוז יאופס.</p>`,
    saveLabel: 'שכפול',
    onSave: async (f) => {
      const shift = Math.round((new Date(f.date.value) - new Date(first)) / 86400000);
      const dayMap = new Map();
      const days = t.days.map((d) => { const nd = { id: uid(), date: addDays(d.date, shift) }; dayMap.set(d.id, nd.id); return nd; });
      const blocks = t.blocks.map((b) => ({ ...structuredClone(b), id: uid(), dayId: dayMap.get(b.dayId) }));
      const copy = { ...structuredClone(t), id: uid(), name: f.name.value.trim() || t.name, days, blocks, packed: {}, createdAt: Date.now() };
      await store.put('trainings', copy);
      location.hash = `#/training/${copy.id}`;
    },
  });
}

/* ---------- lessons catalog ---------- */
function lessonUsage(id) {
  let n = 0;
  for (const t of data.trainings.values()) n += t.blocks.filter((b) => b.lessonId === id).length;
  return n;
}

function renderLessons() {
  const q = ui.lessonSearch.trim();
  const list = [...data.lessons.values()].sort(byName)
    .filter((l) => (!ui.lessonCat || l.category === ui.lessonCat) && (!q || l.name.includes(q)));
  main.innerHTML = `<div class="page">
    <div class="page-head"><h1>מאגר שיעורים</h1><button class="btn primary" id="new-lesson">+ שיעור חדש</button></div>
    <div class="filters">
      <input type="search" id="lesson-search" placeholder="חיפוש…" value="${esc(ui.lessonSearch)}">
      <select id="lesson-cat"><option value="">כל הסוגים</option>
        ${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}" ${ui.lessonCat === k ? 'selected' : ''}>${c.label}</option>`).join('')}
      </select>
      <span class="muted">${list.length} שיעורים</span>
    </div>
    <table class="table">
      <thead><tr><th>שם</th><th class="hide-m">סוג</th><th>אידיאלי</th><th class="hide-m">טווח</th><th class="hide-m">ציוד</th><th></th></tr></thead>
      <tbody>${list.map((l) => `<tr data-id="${l.id}">
        <td><span class="dot" style="background:${l.color || CATEGORIES[l.category]?.color}"></span>${esc(l.name)}</td>
        <td class="hide-m">${CATEGORIES[l.category]?.label || ''}</td>
        <td>${fmtDur(l.ideal)}</td>
        <td class="nowrap hide-m">${durRange(l.min, l.max)}</td>
        <td class="eq-cell hide-m">${(l.equipment || []).map((r) => `<span class="chip">${esc(itemLabel(data.items.get(r.itemId)))} × ${rowLabel(r)}</span>`).join('') || '<span class="muted">—</span>'}</td>
        <td class="nowrap actions-cell"><button class="btn small" data-act="edit">עריכה</button> <button class="btn small danger" data-act="del">מחיקה</button></td>
      </tr>`).join('')}</tbody>
    </table>
  </div>`;
  const search = main.querySelector('#lesson-search');
  search.oninput = () => { ui.lessonSearch = search.value; renderLessons(); const s = main.querySelector('#lesson-search'); s.focus(); s.setSelectionRange(s.value.length, s.value.length); };
  main.querySelector('#lesson-cat').onchange = (e) => { ui.lessonCat = e.target.value; renderLessons(); };
  main.querySelector('#new-lesson').onclick = () => lessonModal();
  main.querySelectorAll('tbody tr').forEach((tr) => {
    const l = data.lessons.get(tr.dataset.id);
    tr.querySelector('[data-act=edit]').onclick = () => lessonModal(l);
    tr.querySelector('[data-act=del]').onclick = async () => {
      const used = lessonUsage(l.id);
      if (await confirmDialog(`למחוק את "${l.name}"?${used ? ` השיעור משובץ ב-${used} משבצות, והן יסומנו כ"שיעור נמחק".` : ''}`)) store.remove('lessons', l.id);
    };
  });
}

export function lessonModal(lesson) {
  const l = lesson || { name: '', category: 'lesson', ideal: 60, ...defaultRange(60, 'lesson'), equipment: [], notes: '' };
  const form = openModal({
    title: lesson ? 'עריכת שיעור' : 'שיעור חדש', wide: true,
    body: `<label>שם<input name="name" required value="${esc(l.name)}"></label>
      <div class="row">
        <label>סוג<select name="category">${Object.entries(CATEGORIES).map(([k, c]) => `<option value="${k}" ${l.category === k ? 'selected' : ''}>${c.label}</option>`).join('')}</select></label>
        <label>צבע<input name="color" type="color" value="${l.color || CATEGORIES[l.category].color}"></label>
      </div>
      <div class="row">
        <label>זמן אידיאלי (דק')<input name="ideal" type="number" min="${SNAP}" step="${SNAP}" value="${l.ideal}"></label>
        <label>מינימום (דק')<input name="min" type="number" min="${SNAP}" step="${SNAP}" value="${l.min}"></label>
        <label>מקסימום (דק')<input name="max" type="number" min="${SNAP}" step="${SNAP}" value="${l.max}"></label>
      </div>
      <button type="button" class="btn small" id="auto-range">חישוב טווח אוטומטי (שיעור: 25% לכל כיוון · תרגול: מחצי עד פי 2)</button>
      <label>הערות<textarea name="notes" rows="2">${esc(l.notes)}</textarea></label>
      <h3>ציוד נדרש</h3>
      ${equipmentEditorHtml(l.equipment || [])}`,
    onSave: async (f) => {
      const name = f.name.value.trim();
      const ideal = snap(+f.ideal.value), min = snap(+f.min.value), max = snap(+f.max.value);
      if (!name) { toast('צריך שם'); return false; }
      if (!(min >= SNAP && min <= ideal && ideal <= max)) { toast('צריך מינימום ≤ אידיאלי ≤ מקסימום'); return false; }
      const color = f.color.value.toLowerCase() === CATEGORIES[f.category.value].color ? undefined : f.color.value;
      const equipment = await readEquipmentEditor(f);
      const doc = { ...l, id: l.id || uid(), name, category: f.category.value, ideal, min, max, notes: f.notes.value.trim(), equipment };
      if (color) doc.color = color; else delete doc.color;
      await store.put('lessons', doc);
    },
  });
  bindEquipmentEditor(form);
  const recalc = () => {
    const r = defaultRange(snap(+form.ideal.value || 60), form.category.value);
    form.min.value = r.min; form.max.value = r.max;
  };
  form.querySelector('#auto-range').onclick = recalc;
  form.category.onchange = () => { if (!lesson?.color) form.color.value = CATEGORIES[form.category.value].color; if (!lesson) recalc(); };
  if (!lesson) form.ideal.oninput = recalc;
}

/* ---------- equipment items ---------- */
function renderItems() {
  const usage = new Map();
  for (const l of data.lessons.values()) for (const r of l.equipment || []) usage.set(r.itemId, (usage.get(r.itemId) || 0) + 1);
  const inKits = new Map();
  const kits = [...data.items.values()].filter(isKit).sort(byName);
  for (const k of kits) for (const c of k.components || []) inKits.set(c.itemId, [...(inKits.get(c.itemId) || []), k.name]);
  const list = [...data.items.values()].filter((i) => !isKit(i)).sort(byName);
  main.innerHTML = `<div class="page">
    <div class="page-head"><h1>ערכות</h1><button class="btn primary" id="new-kit">+ ערכה חדשה</button></div>
    <p class="hint">ערכה היא קבוצת פריטים, למשל ערכת וריד. בשיעור בוחרים את הערכה, וברשימת האריזה היא מתפרקת לפריטים שלה.</p>
    ${kits.length ? `<div class="cards kit-cards">${kits.map((k) => `<div class="card kit-card" data-id="${k.id}">
        <div class="card-main"><h3>🧰 ${esc(k.name)}</h3>
          <div class="kit-items">${(k.components || []).map((c) => `<span class="chip">${esc(data.items.get(c.itemId)?.name || '?')} ×${c.qty}</span>`).join('')}</div>
          <div class="muted">בשימוש ב-${usage.get(k.id) || 0} שיעורים</div></div>
        <div class="card-actions"><button class="btn small" data-act="edit">עריכה</button><button class="btn small danger" data-act="del">מחיקה</button></div>
      </div>`).join('')}</div>` : '<p class="empty">אין עדיין ערכות.</p>'}

    <div class="page-head section-gap"><h1>פריטים</h1><button class="btn primary" id="new-item">+ פריט חדש</button></div>
    <p class="hint">רב-פעמי: בסיכום נלקחת הכמות הגדולה ביותר שנדרשת במשבצת אחת (בובה שמשמשת בכמה שיעורים נספרת פעם אחת).
      מתכלה: הכמויות מכל המשבצות מצטברות.</p>
    ${list.length ? '' : '<p class="empty">אין עדיין פריטים. הם נוצרים אוטומטית כשמוסיפים ציוד לשיעור או לערכה, או כאן.</p>'}
    <table class="table items-table">
      <thead><tr><th>פריט</th><th>סוג</th><th>בשיעורים</th><th class="hide-m">בערכות</th><th></th></tr></thead>
      <tbody>${list.map((i) => `<tr data-id="${i.id}">
        <td><input class="inline-input" data-f="name" value="${esc(i.name)}"></td>
        <td><select data-f="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${i.kind === k ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
        <td>${usage.get(i.id) || 0}</td>
        <td class="hide-m muted">${esc((inKits.get(i.id) || []).join(', '))}</td>
        <td><button class="btn small danger" data-act="del">מחיקה</button></td>
      </tr>`).join('')}</tbody>
    </table></div>`;
  main.querySelector('#new-kit').onclick = () => kitModal(openModal);
  main.querySelectorAll('.kit-card').forEach((card) => {
    const kit = data.items.get(card.dataset.id);
    card.querySelector('[data-act=edit]').onclick = () => kitModal(openModal, kit);
    card.querySelector('[data-act=del]').onclick = async () => {
      const n = usage.get(kit.id) || 0;
      if (!(await confirmDialog(`למחוק את הערכה "${kit.name}"?${n ? ` היא תוסר מ-${n} שיעורים.` : ''} הפריטים עצמם יישארו במאגר.`))) return;
      await removeItemEverywhere(kit.id);
    };
  });
  main.querySelector('#new-item').onclick = () => openModal({
    title: 'פריט חדש',
    body: `<label>שם<input name="name" required></label>
      <label>סוג<select name="kind">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}">${v}</option>`).join('')}</select></label>`,
    onSave: async (f) => {
      if (!f.name.value.trim()) return false;
      await store.put('items', { id: uid(), name: f.name.value.trim(), kind: f.kind.value });
    },
  });
  main.querySelectorAll('tbody tr').forEach((tr) => {
    const item = data.items.get(tr.dataset.id);
    tr.querySelectorAll('[data-f]').forEach((el) => (el.onchange = () => {
      const v = el.value.trim(); if (!v) return;
      store.put('items', { ...item, [el.dataset.f]: v });
    }));
    tr.querySelector('[data-act=del]').onclick = async () => {
      const n = usage.get(item.id) || 0, k = (inKits.get(item.id) || []).length;
      const where = [n && `מ-${n} שיעורים`, k && `מ-${k} ערכות`].filter(Boolean).join(' ו');
      if (!(await confirmDialog(`למחוק את "${item.name}"?${where ? ` הפריט יוסר ${where}.` : ''}`))) return;
      await removeItemEverywhere(item.id);
    };
  });
}

// Deletes an item/kit and strips it from lessons and from kits that contain it.
async function removeItemEverywhere(id) {
  for (const l of data.lessons.values()) {
    if ((l.equipment || []).some((r) => r.itemId === id)) await store.put('lessons', { ...l, equipment: l.equipment.filter((r) => r.itemId !== id) });
  }
  for (const kit of [...data.items.values()].filter(isKit)) {
    if ((kit.components || []).some((c) => c.itemId === id)) await store.put('items', { ...kit, components: kit.components.filter((c) => c.itemId !== id) });
  }
  await store.remove('items', id);
}

/* ---------- staff (firebase only) ---------- */
function renderStaff() {
  const list = [...data.staff.values()].sort((a, b) => a.id.localeCompare(b.id));
  main.innerHTML = `<div class="page narrow">
    <div class="page-head"><h1>צוות מורשה</h1></div>
    <p class="hint">רק כתובות Gmail שברשימה יכולות להתחבר ולערוך.</p>
    <form id="add-staff" class="filters"><input name="email" type="email" dir="ltr" placeholder="name@gmail.com" required><button class="btn primary">הוספה</button></form>
    <table class="table"><tbody>${list.map((s) => `<tr data-id="${esc(s.id)}"><td dir="ltr">${esc(s.id)}</td>
      <td>${s.id === store.user?.email?.toLowerCase() ? '<span class="muted">(את/ה)</span>' : '<button class="btn small danger">הסרה</button>'}</td></tr>`).join('')}</tbody></table></div>`;
  main.querySelector('#add-staff').onsubmit = (e) => {
    e.preventDefault();
    const email = e.target.email.value.trim().toLowerCase();
    if (email) store.put('staff', { id: email, addedBy: store.user?.email || '' });
  };
  main.querySelectorAll('tbody tr button').forEach((b) => (b.onclick = async () => {
    const id = b.closest('tr').dataset.id;
    if (await confirmDialog(`להסיר את ${id}?`, 'הסרה')) store.remove('staff', id);
  }));
}

/* ---------- boot ---------- */
window.addEventListener('hashchange', render);
onChange(render);
mobileQuery.addEventListener('change', render);
initStore().then(render);
