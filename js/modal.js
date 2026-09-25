import { esc } from './util.js';

/** Opens a modal. `onSave(root)` may return false to keep it open. Returns the root element. */
export function openModal({ title, body, onSave, saveLabel = 'שמירה', extraButtons = '', wide = false }) {
  const root = document.getElementById('modal-root');
  root.innerHTML = `<div class="modal-backdrop">
    <form class="modal ${wide ? 'wide' : ''}" novalidate>
      <header><h2>${esc(title)}</h2><button type="button" class="icon-btn" data-close title="סגירה">✕</button></header>
      <div class="modal-body">${body}</div>
      <footer>
        ${extraButtons}
        <span class="spacer"></span>
        <button type="button" class="btn" data-close>ביטול</button>
        ${onSave ? `<button type="submit" class="btn primary">${esc(saveLabel)}</button>` : ''}
      </footer>
    </form>
  </div>`;
  const form = root.querySelector('form');
  const close = () => { root.innerHTML = ''; document.removeEventListener('keydown', onKey); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  root.querySelectorAll('[data-close]').forEach((b) => (b.onclick = close));
  root.querySelector('.modal-backdrop').addEventListener('mousedown', (e) => { if (e.target === e.currentTarget) close(); });
  form.onsubmit = async (e) => {
    e.preventDefault();
    if (!onSave) return close();
    if ((await onSave(form)) !== false) close();
  };
  form.close = close;
  setTimeout(() => form.querySelector('input:not([type=hidden]),select,textarea')?.focus(), 0);
  return form;
}

export function confirmDialog(message, okLabel = 'מחיקה') {
  return new Promise((resolve) => {
    const form = openModal({ title: 'אישור', body: `<p>${esc(message)}</p>`, saveLabel: okLabel, onSave: () => resolve(true) });
    form.querySelectorAll('[data-close]').forEach((b) => b.addEventListener('click', () => resolve(false)));
  });
}
