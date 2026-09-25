// Equipment requirements: rows are {itemId, qty, mode: 'fixed'|'perTrainee', per}
// Summaries: reusable items -> max needed by any single slot, consumables -> summed.
import { data, store } from './store.js';
import { esc, uid, byName } from './util.js';

export const KINDS = { reusable: 'רב-פעמי', consumable: 'מתכלה' };

export function rowQty(row, trainees) {
  if (row.mode === 'perTrainee') return row.qty * Math.ceil((trainees || 0) / (row.per || 1));
  return row.qty;
}

export function rowLabel(row) {
  if (row.mode !== 'perTrainee') return `${row.qty}`;
  return row.per > 1 ? `${row.qty} לכל ${row.per} מתאמנים` : `${row.qty} לכל מתאמן`;
}

function addReq(map, row, trainees, source) {
  const item = data.items.get(row.itemId);
  if (!item) return;
  const q = rowQty(row, trainees);
  const cur = map.get(item.id) || { item, qty: 0, sources: [] };
  cur.qty = item.kind === 'consumable' ? cur.qty + q : Math.max(cur.qty, q);
  if (source && !cur.sources.includes(source)) cur.sources.push(source);
  map.set(item.id, cur);
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
      for (const row of blockRows(b)) addReq(map, row, n, blockTitle(b));
    }
    return { day, map };
  });
  const total = new Map();
  for (const { map } of days) {
    for (const [id, r] of map) {
      const cur = total.get(id) || { item: r.item, qty: 0, sources: [] };
      cur.qty = r.item.kind === 'consumable' ? cur.qty + r.qty : Math.max(cur.qty, r.qty);
      for (const s of r.sources) if (!cur.sources.includes(s)) cur.sources.push(s);
      total.set(id, cur);
    }
  }
  for (const row of training.extras || []) {
    const item = data.items.get(row.itemId);
    if (!item) continue;
    const cur = total.get(item.id) || { item, qty: 0, sources: [] };
    cur.qty += rowQty(row, n);
    cur.sources.push('ציוד כללי לאימון');
    total.set(item.id, cur);
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
  const opts = [...data.items.values()].sort(byName).map((i) => `<option value="${esc(i.name)}">`).join('');
  return `<datalist id="items-datalist">${opts}</datalist>
    <div class="eq-editor">
      <div class="eq-rows">${rows.map(rowHtml).join('')}</div>
      <button type="button" class="btn small eq-add">+ הוסף פריט</button>
      <p class="hint">פריט חדש ייווצר אוטומטית במאגר הציוד (ברירת מחדל: רב-פעמי).</p>
    </div>`;
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
