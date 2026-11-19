const DB_NAME = "spatial-creator";
const DB_VERSION = 1;

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("kv")) db.createObjectStore("kv");
      if (!db.objectStoreNames.contains("assets")) db.createObjectStore("assets");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

async function tx<T>(store: string, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await open();
  return new Promise<T>((resolve, reject) => {
    const t = db.transaction(store, mode);
    const req = fn(t.objectStore(store));
    t.oncomplete = () => resolve(req.result as T);
    t.onerror = () => reject(t.error || req.error);
    t.onabort = () => reject(t.error || new Error("本地存储事务已中断"));
  });
}

export const idb = {
  get: <T>(key: string) => tx<T>("kv", "readonly", (s) => s.get(key)),
  set: (key: string, value: unknown) => tx<void>("kv", "readwrite", (s) => s.put(value, key)),
  del: (key: string) => tx<void>("kv", "readwrite", (s) => s.delete(key)),
  getAsset: (id: string) => tx<Blob | undefined>("assets", "readonly", (s) => s.get(id)),
  putAsset: (id: string, blob: Blob) => tx<void>("assets", "readwrite", (s) => s.put(blob, id)),
  delAsset: (id: string) => tx<void>("assets", "readwrite", (s) => s.delete(id)),
  listAssetKeys: () => tx<IDBValidKey[]>("assets", "readonly", (s) => s.getAllKeys()),
  saveProject: async (project: unknown) => {
    const db = await open();
    return new Promise<void>((resolve, reject) => {
      const t = db.transaction("kv", "readwrite");
      const s = t.objectStore("kv");
      const old = s.get("project");
      old.onsuccess = () => {
        if (old.result) s.put(old.result, "project:backup");
        s.put(project, "project");
      };
      t.oncomplete = () => resolve();
      t.onerror = t.onabort = () => reject(t.error || new Error("保存事务中断，旧快照仍保留"));
    });
  },
};
