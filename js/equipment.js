// Equipment requirements: rows are {itemId, qty, mode: 'fixed'|'perTrainee', per}
// An item with kind 'kit' has components [{itemId, qty}] and is expanded into them.
// Summaries: within one slot everything adds up; across slots reusable items take the
// max needed by any single slot, consumables are summed.
import { data, store } from './store.js';
import { esc, uid, byName, toast } from './util.js';

export const KINDS = { reusable: 'רב-פעמי', consumable: 'מתכלה' };
export const isKit = (item) => item?.kind === 'kit';

export function rowQty(row, trainees) {
  if (row.mode === 'perTrainee') return row.qty * Math.ceil((trainees || 0) / (row.per || 1));
  return row.qty;
}

export function rowLabel(row) {
  if (row.mode !== 'perTrainee') return `${row.qty}`;
  return row.per > 1 ? `${row.qty} לכל ${row.per} מתאמנים` : `${row.qty} לכל מתאמן`;
}

const addSource = (r, s) => { if (s && !r.sources.includes(s)) r.sources.push(s); };

/** Adds `qty` of an item (expanding kits into their components) to map, summing. */
function addQty(map, itemId, qty, source, depth = 0) {
  const item = data.items.get(itemId);
  if (!item || !qty) return;
  if (isKit(item)) {
    if (depth > 3) return; // guard against a kit that (indirectly) contains itself
    for (const c of item.components || []) addQty(map, c.itemId, qty * c.qty, `${source} (${item.name})`, depth + 1);
    return;
  }
  const cur = map.get(item.id) || { item, qty: 0, sources: [] };
  cur.qty += qty;
  addSource(cur, source);
  map.set(item.id, cur);
}

/** Folds one slot's needs into a running total: reusable -> max, consumable -> sum. */
function merge(into, from) {
  for (const [id, r] of from) {
    const cur = into.get(id) || { item: r.item, qty: 0, sources: [] };
    cur.qty = r.item.kind === 'consumable' ? cur.qty + r.qty : Math.max(cur.qty, r.qty);
    r.sources.forEach((s) => addSource(cur, s));
    into.set(id, cur);
  }
}

export function blockRows(block) {
  const lesson = block.type === 'lesson' ? data.lessons.get(block.lessonId) : null;
  return [...(lesson?.equipment || []), ...(block.equipment || [])];
}

/** returns { days: [{day, list}], total: list } where list = [{item, qty, sources}] sorted */
export function summarize(training, blockTitle) {
  const n = training.trainees;
  const days = training.days.map((day) => {
    const map = new Map();
    for (const b of training.blocks.filter((x) => x.dayId === day.id)) {
      const slot = new Map();
      for (const row of blockRows(b)) addQty(slot, row.itemId, rowQty(row, n), blockTitle(b));
      merge(map, slot);
    }
    return { day, map };
  });
  const total = new Map();
  for (const { map } of days) merge(total, map);
  const extras = new Map();
  for (const row of training.extras || []) addQty(extras, row.itemId, rowQty(row, n), 'ציוד כללי לאימון');
  for (const [id, r] of extras) {
    const cur = total.get(id) || { item: r.item, qty: 0, sources: [] };
    cur.qty += r.qty;
    r.sources.forEach((s) => addSource(cur, s));
    total.set(id, cur);
  }
  const sort = (m) => [...m.values()].sort((a, b) => byName(a.item, b.item));
  return { days: days.map(({ day, map }) => ({ day, list: sort(map) })), total: sort(total) };
}

/* ---------- editor widget (used in lesson, block and training-extras modals) ---------- */

function rowHtml(row = {}) {
  const item = data.items.get(row.itemId);
  const perTrainee = row.mode === 'perTrainee';
  return `<div class="eq-row">
    <input class="eq-name" list="items-datalist" placeholder="שם פריט" value="${esc(item?.name || '')}">
    <input class="eq-qty" type="number" min="1" step="1" value="${row.qty || 1}" title="כמות">
    <select class="eq-mode">
      <option value="fixed" ${!perTrainee ? 'selected' : ''}>קבוע</option>
      <option value="perTrainee" ${perTrainee ? 'selected' : ''}>לפי מתאמנים</option>
    </select>
    <span class="eq-per" ${perTrainee ? '' : 'hidden'}>לכל <input class="eq-per-n" type="number" min="1" step="1" value="${row.per || 1}"> מתאמנים</span>
    <button type="button" class="icon-btn eq-del" title="הסר">✕</button>
  </div>`;
}

export function equipmentEditorHtml(rows) {
  const opts = [...data.items.values()].sort(byName)
    .map((i) => `<option value="${esc(i.name)}">${isKit(i) ? `ערכה: ${esc(kitSummary(i))}` : ''}</option>`).join('');
  return `<datalist id="items-datalist">${opts}</datalist>
    <div class="eq-editor">
      <div class="eq-rows">${rows.map(rowHtml).join('')}</div>
      <button type="button" class="btn small eq-add">+ הוסף פריט או ערכה</button>
      <p class="hint">אפשר לבחור ערכה (מוגדרת במסך "ציוד"), והיא תפורק לפריטים שלה ברשימת האריזה. פריט חדש ייווצר אוטומטית במאגר.</p>
    </div>`;
}

export const itemLabel = (item) => (isKit(item) ? `🧰 ${item.name}` : item?.name || '?');

export function kitSummary(kit) {
  return (kit.components || []).map((c) => `${data.items.get(c.itemId)?.name || '?'} ×${c.qty}`).join(', ');
}

/* ---------- kit editor ---------- */

function kitRowHtml(c = {}) {
  const item = data.items.get(c.itemId);
  return `<div class="eq-row kit-row">
    <input class="eq-name" list="plain-items-datalist" placeholder="שם פריט" value="${esc(item?.name || '')}">
    <input class="eq-qty" type="number" inputmode="numeric" min="1" step="1" value="${c.qty || 1}" title="כמות בערכה">
    <select class="eq-kind" title="סוג הפריט">${Object.entries(KINDS).map(([k, v]) => `<option value="${k}" ${(item?.kind || 'consumable') === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    <button type="button" class="icon-btn eq-del" title="הסר">✕</button>
  </div>`;
}

export function kitModal(openModal, kit) {
  const k = kit || { name: '', kind: 'kit', components: [] };
  const plain = [...data.items.values()].filter((i) => !isKit(i)).sort(byName);
  const form = openModal({
    title: kit ? 'עריכת ערכה' : 'ערכה חדשה', wide: true,
    body: `<label>שם הערכה<input name="name" required value="${esc(k.name)}" placeholder="לדוגמה: ערכת וריד"></label>
      <h3>פריטים בערכה</h3>
      <datalist id="plain-items-datalist">${plain.map((i) => `<option value="${esc(i.name)}">`).join('')}</datalist>
      <div class="eq-editor">
        <div class="eq-rows">${(k.components.length ? k.components : [{}]).map(kitRowHtml).join('')}</div>
        <button type="button" class="btn small eq-add">+ הוסף פריט</button>
        <p class="hint">הכמות היא לערכה אחת. שיעור שדורש 3 ערכות יקבל פי 3 מכל פריט. פריט חדש נוצר כ"מתכלה", ואפשר לשנות את זה כאן.</p>
      </div>`,
    onSave: async (f) => {
      const name = f.name.value.trim();
      if (!name) return false;
      const clash = [...data.items.values()].find((i) => i.name.trim() === name && i.id !== k.id);
      if (clash) { toast('כבר קיים פריט או ערכה בשם הזה'); return false; }
      const byName_ = new Map(plain.map((i) => [i.name.trim(), i]));
      const components = [];
      for (const r of f.querySelectorAll('.kit-row')) {
        const n = r.querySelector('.eq-name').value.trim();
        if (!n) continue;
        const kind = r.querySelector('.eq-kind').value;
        let item = byName_.get(n);
        if (!item) {
          item = { id: uid(), name: n, kind };
          byName_.set(n, item);
          await store.put('items', item);
        } else if (item.kind !== kind) {
          item = { ...item, kind };
          await store.put('items', item);
        }
        const qty = Math.max(1, +r.querySelector('.eq-qty').value || 1);
        const same = components.find((c) => c.itemId === item.id);
        if (same) same.qty += qty; else components.push({ itemId: item.id, qty });
      }
      if (!components.length) { toast('צריך לפחות פריט אחד בערכה'); return false; }
      await store.put('items', { ...k, id: k.id || uid(), name, kind: 'kit', components });
    },
  });
  const rowsEl = form.querySelector('.eq-rows');
  form.querySelector('.eq-add').onclick = () => {
    rowsEl.insertAdjacentHTML('beforeend', kitRowHtml());
    rowsEl.lastElementChild.querySelector('.eq-name').focus();
  };
  rowsEl.addEventListener('click', (e) => { if (e.target.closest('.eq-del')) e.target.closest('.eq-row').remove(); });
  // picking an existing item shows its current kind
  rowsEl.addEventListener('change', (e) => {
    if (!e.target.classList.contains('eq-name')) return;
    const item = plain.find((i) => i.name.trim() === e.target.value.trim());
    if (item) e.target.closest('.eq-row').querySelector('.eq-kind').value = item.kind;
  });
}

export function bindEquipmentEditor(root) {
  const rowsEl = root.querySelector('.eq-rows');
  root.querySelector('.eq-add').onclick = () => {
    rowsEl.insertAdjacentHTML('beforeend', rowHtml());
    rowsEl.lastElementChild.querySelector('.eq-name').focus();
  };
  rowsEl.addEventListener('click', (e) => { if (e.target.closest('.eq-del')) e.target.closest('.eq-row').remove(); });
  rowsEl.addEventListener('change', (e) => {
    if (e.target.classList.contains('eq-mode')) {
      e.target.closest('.eq-row').querySelector('.eq-per').hidden = e.target.value !== 'perTrainee';
    }
  });
}

/** Reads rows from the editor, creating missing items. */
export async function readEquipmentEditor(root) {
  const byItemName = new Map([...data.items.values()].map((i) => [i.name.trim(), i]));
  const rows = [];
  for (const r of root.querySelectorAll('.eq-row')) {
    const name = r.querySelector('.eq-name').value.trim();
    if (!name) continue;
    let item = byItemName.get(name);
    if (!item) {
      item = { id: uid(), name, kind: 'reusable' };
      byItemName.set(name, item);
      await store.put('items', item);
    }
    const mode = r.querySelector('.eq-mode').value;
    const row = { itemId: item.id, qty: Math.max(1, +r.querySelector('.eq-qty').value || 1), mode };
    if (mode === 'perTrainee') row.per = Math.max(1, +r.querySelector('.eq-per-n').value || 1);
    rows.push(row);
  }
  return rows;
}
