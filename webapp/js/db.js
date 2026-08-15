// ====== Lapisan penyimpanan IndexedDB ======
// photos    : (mode web) { id, name, type, blob, addedAt, takenAt, status: 'inbox'|'kept'|'trash', albumId }
// albums    : { id, name, createdAt }  — album buatan pengguna (mode web & nama album baru mode native)
// decisions : (mode native) { key, action: 'keep'|'trash'|'move', album, monthKey, name, takenAt }
// faces     : cache hasil deteksi wajah { key, faces, scannedAt } — foto yang sudah
//             ada di sini TIDAK pernah dipindai ulang
// scans     : sesi pemindaian { id, target, done, found, status:'paused'|'done', createdAt, updatedAt }
// phototags : tag per foto { key, tags:[nama], movedTo, updatedAt } — foto ber-tag
//             tidak diikutkan pemindaian berikutnya
// tagdefs   : daftar tag yang pernah dibuat { name, createdAt }

const DB_NAME = 'swipesort';
const DB_VERSION = 5;

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('photos')) {
        const store = db.createObjectStore('photos', { keyPath: 'id' });
        store.createIndex('status', 'status');
        store.createIndex('albumId', 'albumId');
      }
      if (!db.objectStoreNames.contains('albums')) {
        db.createObjectStore('albums', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('decisions')) {
        db.createObjectStore('decisions', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('faces')) {
        db.createObjectStore('faces', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('scans')) {
        db.createObjectStore('scans', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('phototags')) {
        db.createObjectStore('phototags', { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains('tagdefs')) {
        db.createObjectStore('tagdefs', { keyPath: 'name' });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function tx(storeName, mode, fn) {
  return openDB().then(
    (db) =>
      new Promise((resolve, reject) => {
        const t = db.transaction(storeName, mode);
        const store = t.objectStore(storeName);
        const result = fn(store);
        t.oncomplete = () => resolve(result && result.result !== undefined ? result.result : result);
        t.onerror = () => reject(t.error);
        t.onabort = () => reject(t.error);
      })
  );
}

function reqToPromise(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getAll(storeName) {
  const database = await openDB();
  const store = database.transaction(storeName).objectStore(storeName);
  return reqToPromise(store.getAll());
}

export const db = {
  addPhotos: (photos) => tx('photos', 'readwrite', (s) => photos.forEach((p) => s.put(p))),
  putPhoto: (photo) => tx('photos', 'readwrite', (s) => s.put(photo)),
  deletePhotos: (ids) => tx('photos', 'readwrite', (s) => ids.forEach((id) => s.delete(id))),
  getAllPhotos: () => getAll('photos'),

  putAlbum: (album) => tx('albums', 'readwrite', (s) => s.put(album)),
  deleteAlbum: (id) => tx('albums', 'readwrite', (s) => s.delete(id)),
  getAllAlbums: () => getAll('albums'),

  putDecision: (d) => tx('decisions', 'readwrite', (s) => s.put(d)),
  deleteDecision: (key) => tx('decisions', 'readwrite', (s) => s.delete(key)),
  deleteDecisions: (keys) => tx('decisions', 'readwrite', (s) => keys.forEach((k) => s.delete(k))),
  getAllDecisions: () => getAll('decisions'),

  putFaces: (records) => tx('faces', 'readwrite', (s) => records.forEach((r) => s.put(r))),
  deleteFaces: (keys) => tx('faces', 'readwrite', (s) => keys.forEach((k) => s.delete(k))),
  getAllFaces: () => getAll('faces'),
  clearFaces: () => tx('faces', 'readwrite', (s) => s.clear()),

  putScan: (scan) => tx('scans', 'readwrite', (s) => s.put(scan)),
  deleteScan: (id) => tx('scans', 'readwrite', (s) => s.delete(id)),
  getAllScans: () => getAll('scans'),

  putPhotoTags: (records) => tx('phototags', 'readwrite', (s) => records.forEach((r) => s.put(r))),
  deletePhotoTags: (keys) => tx('phototags', 'readwrite', (s) => keys.forEach((k) => s.delete(k))),
  getAllPhotoTags: () => getAll('phototags'),

  putTagDef: (def) => tx('tagdefs', 'readwrite', (s) => s.put(def)),
  getAllTagDefs: () => getAll('tagdefs'),
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
