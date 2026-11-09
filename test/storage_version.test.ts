import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it, vi } from "vitest";
import { Logger } from "../src/log/logger";
import { Db, DB_NAME, DB_VERSION, openDatabase, StorageBlockedError, STORE } from "../src/storage/idb";

/** Opens the database the way the v1 worker does: version 1, never closed, no versionchange handler. */
function holdV1Connection(factory: IDBFactory): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("cfg");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

describe("IndexedDB version handling (v1 worker beside a v2 page)", () => {
  it("an upgrade blocked by an old connection gives up after the timeout, logs once and goes on without storage", async () => {
    const factory = new IDBFactory();
    const v1 = await holdV1Connection(factory);
    const sink = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const db = new Db(factory, () => true, new Logger(sink, () => 0), { blockedTimeoutMs: 30 });

    expect(await db.readCfg()).toBeUndefined();
    expect(db.degraded).toBe(true);
    // Memory storage keeps working for the rest of this page.
    await db.mergeCfg({ app: "app-1" });
    expect(await db.readCfg()).toEqual({ app: "app-1" });
    await db.readState();
    expect(sink.warn).toHaveBeenCalledTimes(1);
    v1.close();
  });

  it("rejects with StorageBlockedError, and closes the late connection once the old one goes", async () => {
    const factory = new IDBFactory();
    const v1 = await holdV1Connection(factory);
    await expect(openDatabase(factory, { blockedTimeoutMs: 20 })).rejects.toBeInstanceOf(StorageBlockedError);
    v1.close();
    // The pending upgrade completes and its connection closes itself, so this open is not blocked.
    const next = await openDatabase(factory, { blockedTimeoutMs: 1_000 });
    expect(next.version).toBe(DB_VERSION);
    expect([...next.objectStoreNames]).toContain(STORE.queue);
    next.close();
  });

  it("the v2 worker opens at version 2 and creates the stores when it is first", async () => {
    const factory = new IDBFactory();
    const db = new Db(factory, () => true);
    await db.mergeCfg({ recent: [] });
    const raw = await openDatabase(factory);
    expect(raw.version).toBe(2);
    expect([...raw.objectStoreNames].sort()).toEqual([STORE.cfg, STORE.clicks, STORE.queue, STORE.state].sort());
    raw.close();
  });

  it("closes on versionchange so a newer version is not blocked, and reopens for the next call", async () => {
    const factory = new IDBFactory();
    const onClose = vi.fn();
    const first = await openDatabase(factory, { onClose });
    const newer = await new Promise<IDBDatabase>((resolve, reject) => {
      const req = factory.open(DB_NAME, 3);
      req.onblocked = () => reject(new Error("blocked"));
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    expect(onClose).toHaveBeenCalled();
    expect(newer.version).toBe(3);
    newer.close();
    void first;
  });

  it("Db reconnects after the browser closed its connection", async () => {
    const factory = new IDBFactory();
    const db = new Db(factory, () => true);
    await db.mergeCfg({ app: "a" });
    // The connection is gone (as after versionchange); the next call opens a new one.
    await db.close();
    expect(await db.readCfg()).toEqual({ app: "a" });
  });
});
