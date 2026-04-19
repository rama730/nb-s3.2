/**
 * IDB-backed tracker for files the user has opened in a local IDE from a Task
 * panel. The server doesn't know the file left the browser, so we store the
 * pre-open state here and consult it when the user drags the edited file
 * back to the Files tab.
 *
 * Lifecycle
 *   1. User clicks "Open in Cursor" on a task-attached file.
 *      → we compute SHA-256, save the blob to ~/Downloads/NB-Workspace/…,
 *        `recordOpenSession({ nodeId, filename, originalHash, localPath, ide })`,
 *        then launch the IDE protocol handler.
 *   2. User edits and drops the file back onto the task.
 *      → `findSessionByFilename(filename)` resolves the stored record,
 *        we compute the new SHA-256, and:
 *          • hashes equal → toast "no changes".
 *          • hashes differ → "save as a new version of <node>?" dialog,
 *            pre-selecting `replaceNodeWithNewVersion` targeted at nodeId.
 *   3. Session is cleared after consumption (or on explicit cancel).
 *
 * We deliberately key by filename because some browsers rename the file
 * during drop (no reliable File.path). If the user has two tasks that each
 * opened a file with the same name, we keep the most recent session and
 * dedupe older ones to avoid phantom matches. Sessions older than 7 days
 * are GC'd on next touch.
 *
 * The IDB store is per-origin; no project scoping is needed because every
 * record carries `nodeId` which already encodes project ownership.
 */

const DB_NAME = "nb-task-file-sessions";
const STORE_NAME = "sessions";
const DB_VERSION = 1;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

export type IdeKind = "cursor" | "vscode" | "workspace";

export type OpenFileSession = {
  /** Stable primary key: `${nodeId}::${filename}` so reopening replaces. */
  id: string;
  nodeId: string;
  taskId: string;
  projectId: string;
  filename: string;
  /** Lowercase hex SHA-256 of the bytes streamed at open time. */
  originalHash: string | null;
  /** Absolute local path (OS-specific) where the file was saved. */
  localPath: string;
  ide: IdeKind;
  openedAt: number;
};

function isIdbAvailable(): boolean {
  return typeof indexedDB !== "undefined";
}

function sessionKey(nodeId: string, filename: string): string {
  return `${nodeId}::${filename}`;
}

async function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        const store = db.createObjectStore(STORE_NAME, { keyPath: "id" });
        store.createIndex("filename", "filename", { unique: false });
        store.createIndex("openedAt", "openedAt", { unique: false });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => Promise<T> | T,
): Promise<T | null> {
  if (!isIdbAvailable()) return null;
  try {
    const db = await openDb();
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const result = await fn(store);
    await new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
    db.close();
    return result;
  } catch {
    return null;
  }
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

export async function recordOpenSession(
  session: Omit<OpenFileSession, "id" | "openedAt"> & { openedAt?: number },
): Promise<OpenFileSession | null> {
  const payload: OpenFileSession = {
    id: sessionKey(session.nodeId, session.filename),
    nodeId: session.nodeId,
    taskId: session.taskId,
    projectId: session.projectId,
    filename: session.filename,
    originalHash: session.originalHash,
    localPath: session.localPath,
    ide: session.ide,
    openedAt: session.openedAt ?? Date.now(),
  };
  const written = await withStore("readwrite", async (store) => {
    await requestToPromise(store.put(payload));
    return payload;
  });
  return written;
}

/**
 * Look up a session by the filename a dropped file carries. If multiple
 * sessions share the filename (distinct node IDs), we prefer the most
 * recent one — the common case where a user opened the same filename from
 * two different tasks in sequence.
 */
export async function findSessionByFilename(
  filename: string,
): Promise<OpenFileSession | null> {
  return (
    (await withStore("readonly", async (store) => {
      const index = store.index("filename");
      const matches = await requestToPromise(
        index.getAll(IDBKeyRange.only(filename)) as IDBRequest<OpenFileSession[]>,
      );
      if (!matches || matches.length === 0) return null;
      matches.sort((a, b) => b.openedAt - a.openedAt);
      return matches[0];
    })) ?? null
  );
}

export async function findSessionByNodeId(
  nodeId: string,
): Promise<OpenFileSession | null> {
  return (
    (await withStore("readonly", async (store) => {
      const all = await requestToPromise(store.getAll() as IDBRequest<OpenFileSession[]>);
      if (!all) return null;
      const forNode = all.filter((s) => s.nodeId === nodeId);
      if (forNode.length === 0) return null;
      forNode.sort((a, b) => b.openedAt - a.openedAt);
      return forNode[0];
    })) ?? null
  );
}

export async function clearSession(id: string): Promise<void> {
  await withStore("readwrite", async (store) => {
    await requestToPromise(store.delete(id));
  });
}

/**
 * Remove sessions older than SESSION_TTL_MS. Called opportunistically from
 * `recordOpenSession` and on page load by the Files tab.
 */
export async function pruneStaleSessions(now: number = Date.now()): Promise<number> {
  const removed = await withStore("readwrite", async (store) => {
    const cutoff = now - SESSION_TTL_MS;
    const index = store.index("openedAt");
    const range = IDBKeyRange.upperBound(cutoff);
    const stale = await requestToPromise(
      index.getAllKeys(range) as IDBRequest<IDBValidKey[]>,
    );
    if (!stale || stale.length === 0) return 0;
    for (const key of stale) {
      await requestToPromise(store.delete(key as IDBValidKey));
    }
    return stale.length;
  });
  return removed ?? 0;
}
