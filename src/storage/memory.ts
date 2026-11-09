import type { CfgRow, StateRow } from "./types";
import type { STORE } from "./idb";

type StoreName = (typeof STORE)[keyof typeof STORE];

/** The storage calls the SDK makes; IndexedDB in browsers, memory where it is missing. */
export interface SdkDb {
  get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined>;
  put(store: StoreName, key: IDBValidKey, value: unknown): Promise<void>;
  delete(store: StoreName, key: IDBValidKey): Promise<void>;
  merge<T extends object>(store: StoreName, key: IDBValidKey, patch: Partial<T>): Promise<T>;
  all<T>(store: StoreName): Promise<T[]>;
  add(store: StoreName, value: unknown): Promise<number>;
  readCfg(): Promise<CfgRow | undefined>;
  mergeCfg(patch: Partial<CfgRow>): Promise<CfgRow>;
  readState(): Promise<StateRow | undefined>;
  mergeState(patch: Partial<StateRow>): Promise<StateRow>;
}

const clone = <T>(value: T): T => (value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T));

/** Page-lifetime storage for browsers without IndexedDB. Nothing survives a reload. */
export class MemoryDb implements SdkDb {
  private readonly stores = new Map<string, Map<IDBValidKey, unknown>>();
  private seq = 1;

  constructor(private readonly writable: () => boolean = () => true) {}

  private store(name: StoreName): Map<IDBValidKey, unknown> {
    let s = this.stores.get(name);
    if (!s) {
      s = new Map();
      this.stores.set(name, s);
    }
    return s;
  }

  private check(): void {
    if (!this.writable()) throw new Error("Storage is off until consent is given");
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return clone(this.store(store).get(key) as T | undefined);
  }

  async put(store: StoreName, key: IDBValidKey, value: unknown): Promise<void> {
    this.check();
    this.store(store).set(key, clone(value));
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    this.check();
    this.store(store).delete(key);
  }

  async merge<T extends object>(store: StoreName, key: IDBValidKey, patch: Partial<T>): Promise<T> {
    this.check();
    const next: Record<string, unknown> = { ...((this.store(store).get(key) as object | undefined) ?? {}) };
    for (const [k, v] of Object.entries(patch)) {
      if (v === undefined) delete next[k];
      else next[k] = clone(v);
    }
    this.store(store).set(key, next);
    return clone(next) as T;
  }

  async all<T>(store: StoreName): Promise<T[]> {
    return [...this.store(store).values()].map((v) => clone(v) as T);
  }

  async add(store: StoreName, value: unknown): Promise<number> {
    this.check();
    const seq = this.seq++;
    this.store(store).set(seq, { ...(clone(value) as object), seq });
    return seq;
  }

  readCfg(): Promise<CfgRow | undefined> {
    return this.get<CfgRow>("cfg", "cfg");
  }

  mergeCfg(patch: Partial<CfgRow>): Promise<CfgRow> {
    return this.merge<CfgRow>("cfg", "cfg", patch);
  }

  readState(): Promise<StateRow | undefined> {
    return this.get<StateRow>("state", "state");
  }

  mergeState(patch: Partial<StateRow>): Promise<StateRow> {
    return this.merge<StateRow>("state", "state", patch);
  }
}
