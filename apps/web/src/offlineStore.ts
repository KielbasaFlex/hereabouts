import type { RoutePack } from "@hereabouts/contracts";

/**
 * IndexedDB-backed storage for downloaded route packs (PLAN.md §11 step 5,
 * Milestone 5): what makes a pack actually available once the app is
 * loaded with the network gone. `factory` is injected (defaulting to the
 * real browser `window.indexedDB`) purely so this is unit-testable in
 * Node against `fake-indexeddb`, the same dependency-injection pattern
 * used for `fetch`/the Anthropic client elsewhere in this codebase.
 */

const DB_NAME = "hereabouts-offline";
const DB_VERSION = 1;
const STORE_NAME = "route-packs";

function openDb(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = factory.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "packId" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function runTransaction<T>(
  db: IDBDatabase,
  mode: IDBTransactionMode,
  work: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const request = work(tx.objectStore(STORE_NAME));
    tx.onerror = () => reject(tx.error);
    tx.oncomplete = () => resolve(request.result);
  });
}

export async function saveRoutePack(pack: RoutePack, factory: IDBFactory = window.indexedDB): Promise<void> {
  const db = await openDb(factory);
  try {
    await runTransaction(db, "readwrite", (store) => store.put(pack));
  } finally {
    db.close();
  }
}

export async function loadRoutePack(packId: string, factory: IDBFactory = window.indexedDB): Promise<RoutePack | undefined> {
  const db = await openDb(factory);
  try {
    return await runTransaction<RoutePack | undefined>(db, "readonly", (store) => store.get(packId));
  } finally {
    db.close();
  }
}

export async function listRoutePacks(factory: IDBFactory = window.indexedDB): Promise<RoutePack[]> {
  const db = await openDb(factory);
  try {
    return await runTransaction<RoutePack[]>(db, "readonly", (store) => store.getAll());
  } finally {
    db.close();
  }
}

export async function deleteRoutePack(packId: string, factory: IDBFactory = window.indexedDB): Promise<void> {
  const db = await openDb(factory);
  try {
    await runTransaction(db, "readwrite", (store) => store.delete(packId));
  } finally {
    db.close();
  }
}
