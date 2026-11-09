import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { Db, DB_NAME, DB_VERSION, openDatabase, STORE } from "../src/storage/idb";
import { LOCAL_KEY, LocalStore } from "../src/storage/local";
import { MemoryDb } from "../src/storage/memory";
import { FakeStorage } from "./helpers/fake_platform";

/** Creates the database the way the v1 SDK and worker did: version 1, one store `cfg`. */
function createV1Database(factory: IDBFactory, row: Record<string, unknown>): Promise<void> {
  return new Promise((resolve, reject) => {
    const req = factory.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore("cfg");
    req.onsuccess = () => {
      const db = req.result;
      const tx = db.transaction("cfg", "readwrite");
      tx.objectStore("cfg").put(row, "cfg");
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    req.onerror = () => reject(req.error);
  });
}

describe("IndexedDB storage", () => {
  it("upgrades a v1 database to version 2 and keeps the v1 cfg row and its token", async () => {
    const factory = new IDBFactory();
    await createV1Database(factory, { app: "app-1", sdk: "k", server: "https://s", firebase: { projectId: "p" }, token: "fb-token-1" });

    const db = new Db(factory, () => true);
    const cfg = await db.readCfg();
    expect(cfg?.token).toBe("fb-token-1");
    expect(cfg?.firebase).toEqual({ projectId: "p" });

    const raw = await openDatabase(factory);
    expect(raw.version).toBe(DB_VERSION);
    expect([...raw.objectStoreNames].sort()).toEqual([STORE.cfg, STORE.clicks, STORE.queue, STORE.state].sort());
    raw.close();
  });

  it("merges cfg patches without dropping v1 fields", async () => {
    const factory = new IDBFactory();
    await createV1Database(factory, { token: "fb-token-1", sdk: "k" });
    const db = new Db(factory, () => true);
    await db.mergeCfg({ app: "app-1", publicKey: "BKEY" });
    expect(await db.readCfg()).toMatchObject({ token: "fb-token-1", sdk: "k", app: "app-1", publicKey: "BKEY" });
  });

  it("keeps queue rows in insertion order", async () => {
    const db = new Db(new IDBFactory(), () => true);
    const a = await db.add(STORE.queue, { kind: "a" });
    const b = await db.add(STORE.queue, { kind: "b" });
    expect(b).toBeGreaterThan(a);
    expect((await db.all<{ kind: string }>(STORE.queue)).map((r) => r.kind)).toEqual(["a", "b"]);
  });

  it("refuses writes while not writable (consent)", async () => {
    let allowed = false;
    const db = new Db(new IDBFactory(), () => allowed);
    await expect(db.mergeCfg({ app: "x" })).rejects.toMatchObject({ code: "consent_required" });
    allowed = true;
    await expect(db.mergeCfg({ app: "x" })).resolves.toMatchObject({ app: "x" });
  });

  it("memory storage behaves like IndexedDB for the SDK calls", async () => {
    const db = new MemoryDb();
    await db.mergeCfg({ app: "a", token: "t" });
    await db.mergeCfg({ token: undefined });
    expect(await db.readCfg()).toEqual({ app: "a" });
  });
});

describe("localStorage", () => {
  it("reads the v1 state and never writes the v1 key", () => {
    const storage = new FakeStorage();
    storage.map.set(LOCAL_KEY.v1, JSON.stringify({ token: "fb", subscriptionId: "sub-1", externalId: "" }));
    const local = new LocalStore(storage, () => true);
    expect(local.readV1()).toEqual({ token: "fb", subscriptionId: "sub-1" });
    expect(storage.setItem).not.toHaveBeenCalled();
  });

  it("skips writes without consent and survives a throwing storage", () => {
    const storage = new FakeStorage();
    let allowed = false;
    const local = new LocalStore(storage, () => allowed);
    expect(local.setString(LOCAL_KEY.debug, "trace")).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
    allowed = true;
    expect(local.setString(LOCAL_KEY.debug, "trace")).toBe(true);

    const broken = new LocalStore(
      {
        getItem: () => {
          throw new Error("denied");
        },
        setItem: () => {
          throw new Error("quota");
        },
        removeItem: () => undefined,
      },
      () => true,
    );
    expect(broken.getString(LOCAL_KEY.debug)).toBeUndefined();
    expect(broken.setString(LOCAL_KEY.debug, "x")).toBe(false);
  });
});
