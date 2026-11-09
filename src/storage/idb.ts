import { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";
import { MemoryDb, type SdkDb } from "./memory";
import type { CfgRow, StateRow } from "./types";

export const DB_NAME = "openpush-web-sdk";
/** v1 used version 1 with the single store `cfg`. */
export const DB_VERSION = 2;

export const STORE = {
  cfg: "cfg",
  state: "state",
  queue: "queue",
  clicks: "clicks",
} as const;

/** Row keys in the out-of-line stores. */
export const ROW = { cfg: "cfg", state: "state", lastClick: "last" } as const;

type StoreName = (typeof STORE)[keyof typeof STORE];

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** How long an open may wait on an old connection before the SDK goes on without storage. */
export const BLOCKED_TIMEOUT_MS = 3_000;

export interface OpenOptions {
  log?: Logger;
  /** Called when the browser closes the connection (another version wants the database). */
  onClose?: () => void;
  /** Default `BLOCKED_TIMEOUT_MS`. */
  blockedTimeoutMs?: number;
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
}

/** The open waited on an older connection (a v1 worker or tab) for too long. */
export class StorageBlockedError extends Error {
  constructor() {
    super("Storage is held open by an older version of the SDK");
    this.name = "StorageBlockedError";
  }
}

/**
 * Opens `openpush-web-sdk` at version 2. The upgrade from version 1 only adds stores, so the v1
 * `cfg` row (and its `token`) stays as it was.
 *
 * Version risk: a v1 worker or tab keeps a version 1 connection open and never closes it, which
 * blocks the upgrade. When the open is still blocked after `blockedTimeoutMs`, it rejects with
 * `StorageBlockedError` so the caller goes on without storage. If the upgrade completes later
 * (the old worker stopped), that late connection is closed at once; the next load uses it.
 * Every connection this returns closes itself on `versionchange`.
 */
export function openDatabase(factory: IDBFactory, options: OpenOptions = {}): Promise<IDBDatabase> {
  const setTimer = options.setTimeout ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
  const clearTimer = options.clearTimeout ?? ((handle: unknown) => clearTimeout(handle as ReturnType<typeof setTimeout>));
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer: unknown;
    const req = factory.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE.cfg)) db.createObjectStore(STORE.cfg);
      if (!db.objectStoreNames.contains(STORE.state)) db.createObjectStore(STORE.state);
      if (!db.objectStoreNames.contains(STORE.queue)) db.createObjectStore(STORE.queue, { keyPath: "seq", autoIncrement: true });
      if (!db.objectStoreNames.contains(STORE.clicks)) db.createObjectStore(STORE.clicks);
    };
    req.onblocked = () => {
      if (timer !== undefined || settled) return;
      timer = setTimer(() => {
        if (settled) return;
        settled = true;
        options.log?.once("storage-blocked", "warn", "Storage is held open by an older version of the SDK; this page goes on without it");
        reject(new StorageBlockedError());
      }, options.blockedTimeoutMs ?? BLOCKED_TIMEOUT_MS);
    };
    req.onsuccess = () => {
      const db = req.result;
      if (timer !== undefined) clearTimer(timer);
      // Let a later version (or another tab's upgrade) proceed.
      db.onversionchange = () => {
        db.close();
        options.onClose?.();
      };
      db.onclose = () => options.onClose?.();
      if (settled) {
        db.close();
        return;
      }
      settled = true;
      resolve(db);
    };
    req.onerror = () => {
      if (timer !== undefined) clearTimer(timer);
      if (settled) return;
      settled = true;
      reject(req.error);
    };
  });
}

/**
 * Small typed access to the SDK database. Writes are refused while `writable()` is false (consent
 * required and not given).
 *
 * The connection is reopened after the browser closes it (`versionchange`). When the open stays
 * blocked by an old connection (see `openDatabase`), this page or worker run goes on with
 * memory storage, which keeps nothing after it ends.
 */
export class Db implements SdkDb {
  private dbPromise: Promise<IDBDatabase> | undefined;
  private memory: MemoryDb | undefined;

  constructor(
    private readonly factory: IDBFactory,
    private readonly writable: () => boolean,
    private readonly log?: Logger,
    private readonly openOptions: Omit<OpenOptions, "log" | "onClose"> = {},
  ) {}

  /** True after the open was blocked and this run uses memory storage. */
  get degraded(): boolean {
    return this.memory !== undefined;
  }

  private db(): Promise<IDBDatabase> {
    if (!this.dbPromise) {
      const opening = openDatabase(this.factory, {
        ...this.openOptions,
        log: this.log,
        onClose: () => {
          if (this.dbPromise === opening) this.dbPromise = undefined;
        },
      });
      this.dbPromise = opening;
      opening.catch(() => {
        if (this.dbPromise === opening) this.dbPromise = undefined;
      });
    }
    return this.dbPromise;
  }

  /** Runs `idb` on the database, or `mem` on the memory fallback once the open was blocked. */
  private async use<T>(idb: (db: IDBDatabase) => Promise<T>, mem: (m: MemoryDb) => Promise<T>): Promise<T> {
    if (this.memory) return mem(this.memory);
    let db: IDBDatabase;
    try {
      db = await this.db();
    } catch (error) {
      if (!(error instanceof StorageBlockedError)) throw error;
      this.memory ??= new MemoryDb(this.writable);
      return mem(this.memory);
    }
    return idb(db);
  }

  /**
   * Runs a write only while storage is allowed. Refuses with a rejected promise, never a thrown
   * error, so callers' `.catch()` sees it (a write before consent must not throw out of an SDK call).
   */
  private writing<T>(write: () => Promise<T>): Promise<T> {
    if (!this.writable()) return Promise.reject(new OpenPushError("consent_required", "Storage is off until consent is given"));
    return write();
  }

  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return this.use(
      async (db) => (await request(db.transaction(store, "readonly").objectStore(store).get(key))) as T | undefined,
      (m) => m.get<T>(store, key),
    );
  }

  put(store: StoreName, key: IDBValidKey, value: unknown): Promise<void> {
    return this.writing(() =>
      this.use(
        async (db) => {
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).put(value, key);
          await done(tx);
        },
        (m) => m.put(store, key, value),
      ),
    );
  }

  delete(store: StoreName, key: IDBValidKey): Promise<void> {
    return this.writing(() =>
      this.use(
        async (db) => {
          const tx = db.transaction(store, "readwrite");
          tx.objectStore(store).delete(key);
          await done(tx);
        },
        (m) => m.delete(store, key),
      ),
    );
  }

  /** Read-modify-write in one transaction. `patch` fields set to undefined are removed. */
  merge<T extends object>(store: StoreName, key: IDBValidKey, patch: Partial<T>): Promise<T> {
    return this.writing(() =>
      this.use(
        async (db) => {
          const tx = db.transaction(store, "readwrite");
          const os = tx.objectStore(store);
          const current = ((await request(os.get(key))) ?? {}) as Record<string, unknown>;
          const next: Record<string, unknown> = { ...current };
          for (const [k, v] of Object.entries(patch)) {
            if (v === undefined) delete next[k];
            else next[k] = v;
          }
          os.put(next, key);
          await done(tx);
          return next as T;
        },
        (m) => m.merge<T>(store, key, patch),
      ),
    );
  }

  readCfg(): Promise<CfgRow | undefined> {
    return this.get<CfgRow>(STORE.cfg, ROW.cfg);
  }

  mergeCfg(patch: Partial<CfgRow>): Promise<CfgRow> {
    return this.merge<CfgRow>(STORE.cfg, ROW.cfg, patch);
  }

  readState(): Promise<StateRow | undefined> {
    return this.get<StateRow>(STORE.state, ROW.state);
  }

  mergeState(patch: Partial<StateRow>): Promise<StateRow> {
    return this.merge<StateRow>(STORE.state, ROW.state, patch);
  }

  /** All rows of an auto-increment store, in key order. */
  all<T>(store: StoreName): Promise<T[]> {
    return this.use(
      async (db) => (await request(db.transaction(store, "readonly").objectStore(store).getAll())) as T[],
      (m) => m.all<T>(store),
    );
  }

  /** Adds a row to an auto-increment store and returns its key. */
  add(store: StoreName, value: unknown): Promise<number> {
    return this.writing(() =>
      this.use(
        async (db) => {
          const tx = db.transaction(store, "readwrite");
          const key = await request(tx.objectStore(store).add(value));
          await done(tx);
          return key as number;
        },
        (m) => m.add(store, value),
      ),
    );
  }

  async close(): Promise<void> {
    if (!this.dbPromise) return;
    try {
      (await this.dbPromise).close();
    } catch {
      // Never opened.
    }
    this.dbPromise = undefined;
  }
}
