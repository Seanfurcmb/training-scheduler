// Data layer. Two backends with the same interface:
//  - local: localStorage (single browser), used when no Firebase config is set
//  - firebase: Firestore + Google sign-in, shared between all approved staff
import { firebaseConfig } from './firebase-config.js';
import { toast } from './util.js';

const fail = (err) => { console.error(err); toast('שגיאה בשמירה: ' + (err.code || err.message)); };

export const COLLS = ['lessons', 'items', 'trainings'];
const LS_KEY = 'training-scheduler:v1';
const FB = 'https://www.gstatic.com/firebasejs/10.12.2';

export const data = { lessons: new Map(), items: new Map(), trainings: new Map(), staff: new Map() };

let listeners = [];
export const onChange = (fn) => listeners.push(fn);
const emit = (coll) => listeners.forEach((fn) => fn(coll));

let backend;
export const store = {
  // ?local in the URL forces browser-only storage (handy for testing without signing in)
  mode: firebaseConfig && !new URLSearchParams(location.search).has('local') ? 'firebase' : 'local',
  user: null,
  status: 'loading', // loading | signed-out | denied | ready
  put: (coll, doc) => backend.put(coll, doc).catch(fail),
  remove: (coll, id) => backend.remove(coll, id).catch(fail),
  signIn: () => backend.signIn?.(),
  signOut: () => backend.signOut?.(),
};

function setStatus(s) { store.status = s; emit('status'); }

/* ---------- local ---------- */
function localBackend() {
  const load = () => {
    try { return JSON.parse(localStorage.getItem(LS_KEY)) || {}; } catch { return {}; }
  };
  const save = () => {
    const out = {};
    for (const c of COLLS) out[c] = Object.fromEntries(data[c]);
    localStorage.setItem(LS_KEY, JSON.stringify(out));
  };
  const raw = load();
  for (const c of COLLS) data[c] = new Map(Object.entries(raw[c] || {}));
  // Sync edits made in another tab
  window.addEventListener('storage', (e) => {
    if (e.key !== LS_KEY) return;
    const r = load();
    for (const c of COLLS) data[c] = new Map(Object.entries(r[c] || {}));
    emit('all');
  });
  return {
    async put(coll, doc) { doc.updatedAt = Date.now(); data[coll].set(doc.id, doc); save(); emit(coll); },
    async remove(coll, id) { data[coll].delete(id); save(); emit(coll); },
  };
}

/* ---------- firebase ---------- */
async function firebaseBackend() {
  const [{ initializeApp }, auth, fs] = await Promise.all([
    import(`${FB}/firebase-app.js`), import(`${FB}/firebase-auth.js`), import(`${FB}/firebase-firestore.js`),
  ]);
  const app = initializeApp(firebaseConfig);
  const a = auth.getAuth(app);
  const db = fs.getFirestore(app);
  let unsubs = [];

  const subscribe = () => {
    let pending = new Set([...COLLS, 'staff']);
    for (const c of [...COLLS, 'staff']) {
      unsubs.push(fs.onSnapshot(fs.collection(db, c), (snap) => {
        data[c] = new Map(snap.docs.map((d) => [d.id, { ...d.data(), id: d.id }]));
        if (pending.delete(c) && pending.size === 0) setStatus('ready');
        else if (!pending.size) emit(c);
      }, (err) => {
        console.error(err);
        if (err.code === 'permission-denied') setStatus('denied');
      }));
    }
  };

  auth.onAuthStateChanged(a, (user) => {
    unsubs.forEach((u) => u()); unsubs = [];
    store.user = user;
    if (!user) return setStatus('signed-out');
    setStatus('loading');
    subscribe();
  });

  return {
    async put(coll, doc) {
      doc.updatedAt = Date.now();
      data[coll].set(doc.id, doc); emit(coll); // optimistic
      const { id, ...rest } = doc;
      await fs.setDoc(fs.doc(db, coll, id), JSON.parse(JSON.stringify(rest)));
    },
    async remove(coll, id) {
      data[coll].delete(id); emit(coll);
      await fs.deleteDoc(fs.doc(db, coll, id));
    },
    signIn: () => auth.signInWithPopup(a, new auth.GoogleAuthProvider()),
    signOut: () => auth.signOut(a),
  };
}

export async function initStore() {
  if (store.mode === 'firebase') {
    backend = await firebaseBackend();
  } else {
    backend = localBackend();
    setStatus('ready');
  }
}
