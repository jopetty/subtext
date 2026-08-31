export const DRAFT_DB_NAME = 'subtext-drafts';
export const DRAFT_DB_VERSION = 1;
export const DRAFT_STORE_NAME = 'drafts';
export const DRAFT_KEY = 'latest';

export function createDraftStore(indexedDb = globalThis.indexedDB) {
  let dbPromise = null;

  function open() {
    if (!indexedDb) return Promise.resolve(null);
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve) => {
      try {
        const request = indexedDb.open(DRAFT_DB_NAME, DRAFT_DB_VERSION);
        request.onupgradeneeded = () => {
          const db = request.result;
          if (!db.objectStoreNames.contains(DRAFT_STORE_NAME)) db.createObjectStore(DRAFT_STORE_NAME);
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
    return dbPromise;
  }

  async function read() {
    const db = await open();
    if (!db) return null;
    return new Promise((resolve) => {
      try {
        const request = db.transaction(DRAFT_STORE_NAME, 'readonly').objectStore(DRAFT_STORE_NAME).get(DRAFT_KEY);
        request.onsuccess = () => resolve(request.result || null);
        request.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }

  async function write(record) {
    const db = await open();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(DRAFT_STORE_NAME, 'readwrite');
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.objectStore(DRAFT_STORE_NAME).put(record, DRAFT_KEY);
      } catch {
        resolve(false);
      }
    });
  }

  async function clear() {
    const db = await open();
    if (!db) return false;
    return new Promise((resolve) => {
      try {
        const transaction = db.transaction(DRAFT_STORE_NAME, 'readwrite');
        transaction.oncomplete = () => resolve(true);
        transaction.onerror = () => resolve(false);
        transaction.objectStore(DRAFT_STORE_NAME).delete(DRAFT_KEY);
      } catch {
        resolve(false);
      }
    });
  }

  return { open, read, write, clear };
}
