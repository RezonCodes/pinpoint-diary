// db.js - local storage using IndexedDB (supported on iOS Safari and Android Chrome).
//
// Stores:
//   users   - { email, salt, hash, keySalt, createdAt }       (no plain-text password)
//   moments - { id, userEmail, createdAt, enc, thumbEnc }     (enc = AES-GCM encrypted details)
//   photos  - { id, userEmail, enc }                          (full-size photo, loaded only when opened)
//
// Full photos are kept in a separate store so the timeline only loads small thumbnails.

const DB_NAME = 'pinpoint-diary';
const DB_VERSION = 1;
let dbPromise = null;

function promisify(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('users')) db.createObjectStore('users', { keyPath: 'email' });
      if (!db.objectStoreNames.contains('moments')) {
        const s = db.createObjectStore('moments', { keyPath: 'id' });
        s.createIndex('byUser', 'userEmail');
      }
      if (!db.objectStoreNames.contains('photos')) {
        const p = db.createObjectStore('photos', { keyPath: 'id' });
        p.createIndex('byUser', 'userEmail');
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('Database is open in another tab. Please close it.'));
  });
  return dbPromise;
}

async function store(name, mode = 'readonly') {
  const db = await openDB();
  return db.transaction(name, mode).objectStore(name);
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
  });
}

// ---------- users ----------
export async function getUser(email) {
  return promisify((await store('users')).get(email));
}

export async function addUser(user) {
  // add() (not put()) fails if the email already exists.
  return promisify((await store('users', 'readwrite')).add(user));
}

// ---------- moments ----------
export async function saveMoment(record, photoRecord) {
  const db = await openDB();
  const names = photoRecord !== undefined ? ['moments', 'photos'] : ['moments'];
  const tx = db.transaction(names, 'readwrite');
  tx.objectStore('moments').put(record);
  if (photoRecord) tx.objectStore('photos').put(photoRecord);
  else if (photoRecord === null) tx.objectStore('photos').delete(record.id);
  return done(tx);
}

export async function getMoment(id) {
  return promisify((await store('moments')).get(id));
}

export async function getMomentsForUser(email) {
  const s = await store('moments');
  return promisify(s.index('byUser').getAll(email));
}

export async function getPhoto(id) {
  return promisify((await store('photos')).get(id));
}

export async function deleteMoment(id) {
  const db = await openDB();
  const tx = db.transaction(['moments', 'photos'], 'readwrite');
  tx.objectStore('moments').delete(id);
  tx.objectStore('photos').delete(id);
  return done(tx);
}

/** Removes the account and every diary entry and photo that belongs to it. */
export async function deleteUserAndData(email) {
  const db = await openDB();
  const tx = db.transaction(['users', 'moments', 'photos'], 'readwrite');
  tx.objectStore('users').delete(email);
  for (const name of ['moments', 'photos']) {
    const idx = tx.objectStore(name).index('byUser');
    idx.openKeyCursor(IDBKeyRange.only(email)).onsuccess = (e) => {
      const cursor = e.target.result;
      if (cursor) {
        tx.objectStore(name).delete(cursor.primaryKey);
        cursor.continue();
      }
    };
  }
  return done(tx);
}
