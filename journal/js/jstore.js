// 本機資料庫（IndexedDB）：練習日誌（含照片）與下載過的示範，存在學生自己的裝置上
// 和「我的羽球教練」分開存放，互不影響
const DB_NAME = 'swing-journal';
const VERSION = 1;
let dbPromise = null;

function open() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('templates')) db.createObjectStore('templates', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

async function run(store, mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, mode);
    const req = fn(tx.objectStore(store));
    tx.oncomplete = () => resolve(req ? req.result : undefined);
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export const put = (store, obj) => run(store, 'readwrite', (s) => s.put(obj));
export const get = (store, id) => run(store, 'readonly', (s) => s.get(id));
export const all = (store) => run(store, 'readonly', (s) => s.getAll());
export const del = (store, id) => run(store, 'readwrite', (s) => s.delete(id));
export const clear = (store) => run(store, 'readwrite', (s) => s.clear());
export const uid = () => Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
