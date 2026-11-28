// Thin promise wrapper over IndexedDB.
const DB_NAME = 'workout-tracker';
export const DB_VERSION = 3;

let dbPromise = null;

/** Structural upgrades. Each block runs once, in order, for databases older than it. */
function upgrade(db, oldVersion) {
  if (oldVersion < 1) {
    db.createObjectStore('sessions', { keyPath: 'date' }); // one session per local date
    db.createObjectStore('exercises', { keyPath: 'key' }); // custom exercise names
    db.createObjectStore('meta', { keyPath: 'key' }); // settings, lastExportAt, …
  }
  if (oldVersion < 2) {
    db.createObjectStore('body', { keyPath: 'date' }); // bodyweight/waist log, one entry per date
  }
  if (oldVersion < 3) {
    db.createObjectStore('snapshots', { keyPath: 'id' }); // copies of all data taken before a data migration
  }
  // if (oldVersion < 4) { … }   Adding a store never touches existing data.
}

export function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('This browser does not support on-device storage (IndexedDB). Private browsing can cause this.'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => upgrade(req.result, e.oldVersion);
    req.onsuccess = () => {
      const db = req.result;
      // A newer version of the app opened in another tab: step aside so it can upgrade.
      db.onversionchange = () => { db.close(); location.reload(); };
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

/** Run fn(tx) in one transaction; resolves when it has committed. */
export async function run(storeNames, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeNames, mode);
    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error('Transaction aborted'));
    result = fn(tx);
  });
}

const request = (req) => new Promise((resolve, reject) => {
  req.onsuccess = () => resolve(req.result);
  req.onerror = () => reject(req.error);
});

export async function getAll(store) {
  const db = await open();
  return request(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await open();
  return request(db.transaction(store).objectStore(store).get(key));
}

export const put = (store, value) => run(store, 'readwrite', (tx) => { tx.objectStore(store).put(value); });
export const putMany = (store, values) => run(store, 'readwrite', (tx) => {
  const os = tx.objectStore(store);
  values.forEach((v) => os.put(v));
});
export const del = (store, key) => run(store, 'readwrite', (tx) => { tx.objectStore(store).delete(key); });

export async function getMeta(key) {
  return (await get('meta', key))?.value;
}
export const setMeta = (key, value) => put('meta', { key, value });

export const DATA_STORES = ['sessions', 'exercises', 'meta', 'body'];

/** Every record of every data store, in one read transaction. → { sessions, exercises, body, meta: { key: value } } */
export async function readAll() {
  const db = await open();
  const tx = db.transaction(DATA_STORES);
  const [sessions, exercises, meta, body] = await Promise.all(DATA_STORES.map((n) => request(tx.objectStore(n).getAll())));
  return { sessions, exercises, body, meta: Object.fromEntries(meta.map((r) => [r.key, r.value])) };
}

/** Save a snapshot and keep only the newest `keep`. Resolves to the snapshot id. */
export function saveSnapshot(snapshot, keep) {
  return run('snapshots', 'readwrite', (tx) => {
    const os = tx.objectStore('snapshots');
    os.put(snapshot);
    const req = os.getAllKeys();
    req.onsuccess = () => {
      const ids = req.result.sort((a, b) => a - b);
      ids.slice(0, Math.max(0, ids.length - keep)).forEach((id) => os.delete(id));
    };
    return snapshot.id;
  });
}
export const getSnapshots = async () => (await getAll('snapshots')).sort((a, b) => b.id - a.id);

/**
 * Write a migration in ONE transaction: sessions to put and meta keys to set. If anything fails the transaction
 * aborts and nothing is written (the old data stays as it was).
 */
export function writeMigration({ sessions = [], meta = {} }) {
  return run(['sessions', 'meta'], 'readwrite', (tx) => {
    const ss = tx.objectStore('sessions');
    const ms = tx.objectStore('meta');
    sessions.forEach((s) => ss.put(s));
    Object.entries(meta).forEach(([key, value]) => ms.put({ key, value }));
  });
}
