// Thin promise wrapper over IndexedDB.
const DB_NAME = 'workout-tracker';
export const DB_VERSION = 2;

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
  // if (oldVersion < 3) { … }
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
