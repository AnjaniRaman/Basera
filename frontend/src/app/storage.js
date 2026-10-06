// Storage that never throws. localStorage for small preferences and the session, IndexedDB for
// property documents and uploaded files, with an in-memory fallback when a browser blocks both
// (private windows, embedded previews). The app keeps working either way; it just forgets on reload.

const memory = new Map();

export const prefs = {
  get(key, fallback = null) {
    try {
      const raw = globalThis.localStorage?.getItem(key);
      if (raw === null || raw === undefined) return memory.has(key) ? memory.get(key) : fallback;
      return JSON.parse(raw);
    } catch {
      return memory.has(key) ? memory.get(key) : fallback;
    }
  },
  set(key, value) {
    memory.set(key, value);
    try {
      globalThis.localStorage?.setItem(key, JSON.stringify(value));
    } catch {
      /* storage blocked: kept in memory only */
    }
  },
  remove(key) {
    memory.delete(key);
    try {
      globalThis.localStorage?.removeItem(key);
    } catch {
      /* ignore */
    }
  }
};

const DB_NAME = 'basera';
const DB_VERSION = 1;
const STORES = ['properties', 'files', 'meta'];

let dbPromise = null;
let fallback = null;

function memoryDb() {
  if (!fallback) fallback = Object.fromEntries(STORES.map((s) => [s, new Map()]));
  return fallback;
}

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    try {
      if (!globalThis.indexedDB) return resolve(null);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        for (const store of STORES) if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
  return dbPromise;
}

function request(store, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        if (!db) {
          try {
            resolve(fn.memory(memoryDb()[store]));
          } catch (err) {
            reject(err);
          }
          return;
        }
        try {
          const tx = db.transaction(store, mode);
          const req = fn.idb(tx.objectStore(store));
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        } catch {
          // Database gone (cleared mid-session): fall back to memory from now on.
          dbPromise = Promise.resolve(null);
          try {
            resolve(fn.memory(memoryDb()[store]));
          } catch (e) {
            reject(e);
          }
        }
      })
  );
}

export const idb = {
  get: (store, key) => request(store, 'readonly', { idb: (s) => s.get(key), memory: (m) => m.get(key) }),
  set: (store, key, value) => request(store, 'readwrite', { idb: (s) => s.put(value, key), memory: (m) => m.set(key, value) }),
  remove: (store, key) => request(store, 'readwrite', { idb: (s) => s.delete(key), memory: (m) => m.delete(key) }),
  keys: (store) => request(store, 'readonly', { idb: (s) => s.getAllKeys(), memory: (m) => [...m.keys()] }),
  all: (store) => request(store, 'readonly', { idb: (s) => s.getAll(), memory: (m) => [...m.values()] }),
  async isPersistent() {
    const db = await openDb();
    return Boolean(db);
  }
};
