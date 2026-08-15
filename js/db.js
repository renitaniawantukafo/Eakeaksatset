// ====== Lapisan penyimpanan IndexedDB ======
// photos : { id, name, type, blob, addedAt, status: 'inbox'|'kept'|'trash', albumId, sortedAt }
// albums : { id, name, createdAt }

const DB_NAME = 'swipesort';
const DB_VERSION = 1;

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

export const db = {
  async addPhotos(photos) {
    return tx('photos', 'readwrite', (store) => {
      photos.forEach((p) => store.put(p));
    });
  },

  async putPhoto(photo) {
    return tx('photos', 'readwrite', (store) => store.put(photo));
  },

  async deletePhotos(ids) {
    return tx('photos', 'readwrite', (store) => {
      ids.forEach((id) => store.delete(id));
    });
  },

  async getAllPhotos() {
    const database = await openDB();
    const store = database.transaction('photos').objectStore('photos');
    return reqToPromise(store.getAll());
  },

  async putAlbum(album) {
    return tx('albums', 'readwrite', (store) => store.put(album));
  },

  async deleteAlbum(id) {
    return tx('albums', 'readwrite', (store) => store.delete(id));
  },

  async getAllAlbums() {
    const database = await openDB();
    const store = database.transaction('albums').objectStore('albums');
    return reqToPromise(store.getAll());
  },
};

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 9);
}
