const DB_NAME = 'drawrelay-db';
const DB_VERSION = 1;
const KIT_STORE = 'kits';
const PACK_STORE = 'packs';

function openDb() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) {
      reject(new Error('IndexedDB is unavailable.'));
      return;
    }
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(KIT_STORE)) db.createObjectStore(KIT_STORE, { keyPath: 'id' });
      if (!db.objectStoreNames.contains(PACK_STORE)) db.createObjectStore(PACK_STORE, { keyPath: 'id' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Could not open local storage.'));
  });
}

async function withStore(storeName, mode, action) {
  const db = await openDb();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = action(store);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('Local storage operation failed.'));
    tx.oncomplete = () => db.close();
  });
}

export const storage = {
  getPreferences() {
    try {
      return JSON.parse(localStorage.getItem('drawrelay:preferences') || '{}');
    } catch {
      return {};
    }
  },
  savePreferences(value) {
    localStorage.setItem('drawrelay:preferences', JSON.stringify(value));
  },
  getDeviceId() {
    let id = localStorage.getItem('drawrelay:deviceId');
    if (!id) {
      id = crypto.randomUUID?.() || `device-${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem('drawrelay:deviceId', id);
    }
    return id;
  },
  getLicense() {
    try {
      return JSON.parse(localStorage.getItem('drawrelay:license') || 'null');
    } catch {
      return null;
    }
  },
  saveLicense(value) {
    localStorage.setItem('drawrelay:license', JSON.stringify(value));
  },
  clearLicense() {
    localStorage.removeItem('drawrelay:license');
  },
  getReconnect(roomCode) {
    try {
      return JSON.parse(sessionStorage.getItem(`drawrelay:reconnect:${roomCode}`) || 'null');
    } catch {
      return null;
    }
  },
  saveReconnect(roomCode, value) {
    sessionStorage.setItem(`drawrelay:reconnect:${roomCode}`, JSON.stringify(value));
  },
  getHostSession(roomCode) {
    try {
      return JSON.parse(sessionStorage.getItem(`drawrelay:host:${roomCode}`) || 'null');
    } catch {
      return null;
    }
  },
  saveHostSession(roomCode, value) {
    sessionStorage.setItem(`drawrelay:host:${roomCode}`, JSON.stringify(value));
  },
  clearHostSession(roomCode) {
    sessionStorage.removeItem(`drawrelay:host:${roomCode}`);
  },
  listKits: () => withStore(KIT_STORE, 'readonly', (store) => store.getAll()),
  getKit: (id) => withStore(KIT_STORE, 'readonly', (store) => store.get(id)),
  saveKit: (kit) => withStore(KIT_STORE, 'readwrite', (store) => store.put(kit)),
  deleteKit: (id) => withStore(KIT_STORE, 'readwrite', (store) => store.delete(id)),
  listPacks: () => withStore(PACK_STORE, 'readonly', (store) => store.getAll()),
  savePack: (pack) => withStore(PACK_STORE, 'readwrite', (store) => store.put(pack)),
  deletePack: (id) => withStore(PACK_STORE, 'readwrite', (store) => store.delete(id)),
};

function bytesToBase64(bytes) {
  let binary = '';
  bytes.forEach((byte) => { binary += String.fromCharCode(byte); });
  return btoa(binary);
}

function base64ToBytes(value) {
  const binary = atob(value);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

async function deriveKey(passphrase, salt) {
  const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(passphrase), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: 150000, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function encryptKit(kit, passphrase) {
  if (!passphrase || passphrase.length < 6) throw new Error('Use a passphrase with at least 6 characters.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(JSON.stringify(kit)));
  return {
    format: 'drawrelay-kit',
    version: 1,
    cipher: 'AES-GCM',
    kdf: 'PBKDF2-SHA256-150000',
    salt: bytesToBase64(salt),
    iv: bytesToBase64(iv),
    data: bytesToBase64(new Uint8Array(ciphertext)),
  };
}

export async function decryptKit(fileData, passphrase) {
  if (fileData?.format !== 'drawrelay-kit' || fileData?.version !== 1) throw new Error('This is not a supported DrawRelay kit.');
  const salt = base64ToBytes(fileData.salt);
  const iv = base64ToBytes(fileData.iv);
  const key = await deriveKey(passphrase, salt);
  try {
    const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, base64ToBytes(fileData.data));
    return JSON.parse(new TextDecoder().decode(plaintext));
  } catch {
    throw new Error('The passphrase is incorrect or the kit file is damaged.');
  }
}
