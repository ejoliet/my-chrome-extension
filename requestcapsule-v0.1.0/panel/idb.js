'use strict';

const DB_NAME = 'requestcapsule';
const DB_VERSION = 1;

function requestToPromise(request) {
  return new Promise((resolve, reject) => {
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('IndexedDB operation failed.')), { once: true });
  });
}

export function openDatabase() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.addEventListener('upgradeneeded', () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('savedCaptures')) {
        const store = db.createObjectStore('savedCaptures', { keyPath: 'id' });
        store.createIndex('createdAt', 'createdAt');
        store.createIndex('origin', 'origin');
      }
    });
    request.addEventListener('success', () => resolve(request.result), { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('Could not open IndexedDB.')), { once: true });
  });
}

async function withStore(storeName, mode, operation) {
  const db = await openDatabase();
  try {
    const transaction = db.transaction(storeName, mode);
    const store = transaction.objectStore(storeName);
    const result = await operation(store);
    await new Promise((resolve, reject) => {
      transaction.addEventListener('complete', resolve, { once: true });
      transaction.addEventListener('abort', () => reject(transaction.error || new Error('IndexedDB transaction aborted.')), { once: true });
      transaction.addEventListener('error', () => reject(transaction.error || new Error('IndexedDB transaction failed.')), { once: true });
    });
    return result;
  } finally {
    db.close();
  }
}

export async function getValue(key, fallback = null) {
  return withStore('kv', 'readonly', async (store) => {
    const record = await requestToPromise(store.get(key));
    return record ? record.value : fallback;
  });
}

export async function setValue(key, value) {
  return withStore('kv', 'readwrite', (store) => requestToPromise(store.put({ key, value, updatedAt: new Date().toISOString() })));
}

export async function deleteValue(key) {
  return withStore('kv', 'readwrite', (store) => requestToPromise(store.delete(key)));
}

export async function saveCapture(capture) {
  return withStore('savedCaptures', 'readwrite', (store) => requestToPromise(store.put(capture)));
}

export async function listCaptures() {
  return withStore('savedCaptures', 'readonly', (store) => requestToPromise(store.getAll()));
}

export async function deleteCapture(id) {
  return withStore('savedCaptures', 'readwrite', (store) => requestToPromise(store.delete(id)));
}

export async function deleteAllCaptures() {
  return withStore('savedCaptures', 'readwrite', (store) => requestToPromise(store.clear()));
}

export async function deleteAllLocalData() {
  const db = await openDatabase();
  db.close();
  await new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(DB_NAME);
    request.addEventListener('success', resolve, { once: true });
    request.addEventListener('error', () => reject(request.error || new Error('Could not delete local data.')), { once: true });
    request.addEventListener('blocked', () => reject(new Error('Local data deletion is blocked by another RequestCapsule page.')), { once: true });
  });
}
