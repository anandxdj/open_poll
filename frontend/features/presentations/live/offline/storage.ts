import type { AnswerQueueStorage, QueuedAnswer } from "./types";

/** IndexedDB names. Bump `DB_VERSION` (with an upgrade step) when the store's shape changes. */
export const ANSWER_DB_NAME = "openpoll-live";
export const ANSWER_DB_VERSION = 1;
export const ANSWER_STORE = "answers";
const BY_PRESENTATION = "byPresentation";

/** A queue that lives as long as the page: tests, and browsers without IndexedDB. */
export function createMemoryAnswerStorage(): AnswerQueueStorage {
  const entries = new Map<string, QueuedAnswer>();
  return {
    put: async (entry) => void entries.set(entry.clientAnswerId, structuredClone(entry)),
    remove: async (clientAnswerId) => void entries.delete(clientAnswerId),
    list: async (presentationId) =>
      [...entries.values()].filter((entry) => entry.presentationId === presentationId).map((entry) => structuredClone(entry)),
  };
}

/**
 * The queue in IndexedDB (database `openpoll-live`, store `answers`, keyPath
 * `clientAnswerId`, index on `presentationId`), so a queued answer survives a
 * reload or a closed tab. The connection opens on first use and reopens after
 * the browser closed it.
 */
export function createIndexedDbAnswerStorage(factory: IDBFactory): AnswerQueueStorage {
  let opening: Promise<IDBDatabase> | null = null;

  const open = () =>
    (opening ??= new Promise<IDBDatabase>((resolve, reject) => {
      const request = factory.open(ANSWER_DB_NAME, ANSWER_DB_VERSION);
      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(ANSWER_STORE)) {
          db.createObjectStore(ANSWER_STORE, { keyPath: "clientAnswerId" }).createIndex(BY_PRESENTATION, "presentationId");
        }
      };
      request.onsuccess = () => {
        const db = request.result;
        // Another tab upgrading, or the browser clearing storage: open afresh next time.
        db.onversionchange = () => {
          db.close();
          opening = null;
        };
        db.onclose = () => {
          opening = null;
        };
        resolve(db);
      };
      request.onerror = () => reject(request.error ?? new Error("IndexedDB open failed"));
      request.onblocked = () => reject(new Error("IndexedDB open blocked"));
    }).catch((err: unknown) => {
      opening = null;
      throw err;
    }));

  const run = async <T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T> | void) => {
    const db = await open();
    return new Promise<T | undefined>((resolve, reject) => {
      const tx = db.transaction(ANSWER_STORE, mode);
      let result: T | undefined;
      const request = work(tx.objectStore(ANSWER_STORE));
      if (request) request.onsuccess = () => (result = request.result);
      tx.oncomplete = () => resolve(result);
      tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
      tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
    });
  };

  return {
    put: async (entry) => {
      await run("readwrite", (store) => store.put(entry));
    },
    remove: async (clientAnswerId) => {
      await run("readwrite", (store) => store.delete(clientAnswerId));
    },
    list: async (presentationId) =>
      ((await run<QueuedAnswer[]>("readonly", (store) => store.index(BY_PRESENTATION).getAll(presentationId))) ?? []),
  };
}

/**
 * `primary` with a memory copy for whatever it cannot store (private modes
 * and quota errors make IndexedDB throw): the answer is still retried while
 * the page lives, it just would not survive a reload.
 */
export function withMemoryFallback(primary: AnswerQueueStorage): AnswerQueueStorage {
  const memory = createMemoryAnswerStorage();
  return {
    put: async (entry) => {
      try {
        await primary.put(entry);
        await memory.remove(entry.clientAnswerId);
      } catch {
        await memory.put(entry);
      }
    },
    remove: async (clientAnswerId) => {
      await memory.remove(clientAnswerId);
      await primary.remove(clientAnswerId).catch(() => {});
    },
    list: async (presentationId) => {
      const [stored, held] = await Promise.all([primary.list(presentationId).catch(() => []), memory.list(presentationId)]);
      const byId = new Map(stored.map((entry) => [entry.clientAnswerId, entry]));
      for (const entry of held) byId.set(entry.clientAnswerId, entry);
      return [...byId.values()];
    },
  };
}

let shared: AnswerQueueStorage | null = null;

/** The page's queue: IndexedDB (with the memory fallback) where the browser has it, else memory only. */
export function defaultAnswerQueueStorage(): AnswerQueueStorage {
  if (shared) return shared;
  const factory = typeof indexedDB === "undefined" ? null : indexedDB;
  shared = factory ? withMemoryFallback(createIndexedDbAnswerStorage(factory)) : createMemoryAnswerStorage();
  return shared;
}
