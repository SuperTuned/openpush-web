import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IDBFactory } from "fake-indexeddb";
import { Logger } from "../src/log/logger";
import type { HttpResponse } from "../src/net/http";
import { IdbQueueStorage, MemoryQueueStorage, mergeBodies, WriteQueue, type QueueStorage } from "../src/net/queue";
import { parseRetryAfter, retryDelay } from "../src/net/retry";
import { Db } from "../src/storage/idb";

function res(status: number, headers: Record<string, string> = {}, body: unknown = {}): HttpResponse {
  return { status, ok: status >= 200 && status < 300, header: (name) => headers[name] ?? null, body };
}

function makeQueue(storage: QueueStorage, answers: HttpResponse[] | ((call: number) => HttpResponse | Error)) {
  const send = vi.fn(async () => {
    const n = send.mock.calls.length;
    const answer = typeof answers === "function" ? answers(n) : (answers[n - 1] ?? res(200));
    if (answer instanceof Error) throw answer;
    return answer;
  });
  const log = new Logger(undefined, () => Date.now(), "trace");
  const queue = new WriteQueue({
    storage,
    http: { send },
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    now: () => Date.now(),
    log,
    canSend: () => true,
    canWrite: () => true,
  });
  return { queue, send, log };
}

describe("retry helpers", () => {
  it("retries after 2 s, 8 s, then every 30 s", () => {
    expect([1, 2, 3, 4, 10].map(retryDelay)).toEqual([2000, 8000, 30000, 30000, 30000]);
  });

  it("reads Retry-After as seconds or an HTTP date", () => {
    const now = Date.parse("2026-11-08T10:00:00Z");
    expect(parseRetryAfter("20", now)).toBe(20_000);
    expect(parseRetryAfter("Sun, 08 Nov 2026 10:01:00 GMT", now)).toBe(60_000);
    expect(parseRetryAfter("soon", now)).toBeUndefined();
    expect(parseRetryAfter(null, now)).toBeUndefined();
  });

  it("merges tags and aliases when coalescing", () => {
    expect(mergeBodies({ status: 1, tags: { a: "1", b: "1" } }, { status: 0, tags: { b: "2" }, aliases: { x: "y" } })).toEqual({
      status: 0,
      tags: { a: "1", b: "2" },
      aliases: { x: "y" },
    });
  });
});

describe("WriteQueue", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends writes in call order", async () => {
    const { queue, send } = makeQueue(new MemoryQueueStorage(), []);
    const a = queue.enqueue({ kind: "register", method: "POST", path: "/a", body: { n: 1 }, coalesce: "replace" });
    const b = queue.enqueue({ kind: "event", method: "POST", path: "/b", body: { n: 2 }, coalesce: "append" });
    queue.start();
    await Promise.all([a, b]);
    expect(send.mock.calls.map((c) => (c as unknown as [{ path: string }])[0].path)).toEqual(["/a", "/b"]);
  });

  it("replaces a waiting write of the same kind and resolves both callers", async () => {
    const storage = new MemoryQueueStorage();
    const { queue, send } = makeQueue(storage, []);
    const first = queue.enqueue({ kind: "register", method: "POST", path: "/s", body: { status: 1, tags: { a: "1" } }, coalesce: "merge" });
    const event = queue.enqueue({ kind: "event", method: "POST", path: "/e", body: {}, coalesce: "append" });
    const second = queue.enqueue({ kind: "register", method: "POST", path: "/s", body: { status: 0, tags: { b: "2" } }, coalesce: "merge" });
    await vi.advanceTimersByTimeAsync(0);
    const rows = await storage.all();
    expect(rows.map((r) => r.kind)).toEqual(["event", "register"]);
    expect(rows[1]?.body).toEqual({ status: 0, tags: { a: "1", b: "2" } });

    queue.start();
    await Promise.all([first, event, second]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("retries after 2 s, 8 s, then 30 s on 5xx and transport failure", async () => {
    const answers = [res(503), new Error("offline"), res(500), res(200)];
    const { queue, send } = makeQueue(new MemoryQueueStorage(), (n) => answers[n - 1] ?? res(200));
    const done = queue.enqueue({ kind: "register", method: "POST", path: "/s", coalesce: "replace" });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(7_999);
    expect(send).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(29_999);
    expect(send).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(4);
    await expect(done).resolves.toMatchObject({ status: 200 });
  });

  it("never retries sooner than Retry-After", async () => {
    const { queue, send } = makeQueue(new MemoryQueueStorage(), [res(429, { "Retry-After": "20" }), res(200)]);
    const done = queue.enqueue({ kind: "register", method: "POST", path: "/s", coalesce: "replace" });
    queue.start();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(17_999);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(send).toHaveBeenCalledTimes(2);
    await done;
  });

  it("keeps later writes behind a write that is waiting to retry", async () => {
    const { queue, send } = makeQueue(new MemoryQueueStorage(), [res(503), res(200), res(200)]);
    const a = queue.enqueue({ kind: "register", method: "POST", path: "/a", coalesce: "replace" });
    queue.start();
    await vi.advanceTimersByTimeAsync(0);
    const b = queue.enqueue({ kind: "event", method: "POST", path: "/b", coalesce: "append" });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(send).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1_000);
    await Promise.all([a, b]);
    expect(send.mock.calls.map((c) => (c as unknown as [{ path: string }])[0].path)).toEqual(["/a", "/a", "/b"]);
  });

  it("drops a write the server refuses with a 4xx, logs it, and continues", async () => {
    const storage = new MemoryQueueStorage();
    const { queue, send, log } = makeQueue(storage, [res(400), res(200)]);
    const lines: string[] = [];
    log.addListener((e) => lines.push(e.message));
    const bad = queue.enqueue({ kind: "tags", method: "POST", path: "/bad", coalesce: "replace" });
    const good = queue.enqueue({ kind: "event", method: "POST", path: "/good", coalesce: "append" });
    queue.start();
    await expect(bad).rejects.toMatchObject({ code: "network", detail: { status: 400 } });
    await expect(good).resolves.toMatchObject({ status: 200 });
    expect(send).toHaveBeenCalledTimes(2);
    expect(lines.some((l) => l.includes("Dropped a tags write") && l.includes("400"))).toBe(true);
    expect(await storage.all()).toEqual([]);
  });

  it("does not send before start and stores writes without consent refusal", async () => {
    const { queue, send } = makeQueue(new MemoryQueueStorage(), []);
    void queue.enqueue({ kind: "register", method: "POST", path: "/s", coalesce: "replace" });
    await vi.advanceTimersByTimeAsync(10);
    expect(send).not.toHaveBeenCalled();
    expect(await queue.size()).toBe(1);
  });

  it("refuses new writes while consent is not given", async () => {
    const queue = new WriteQueue({
      storage: new MemoryQueueStorage(),
      http: { send: vi.fn() },
      timers: { setTimeout, clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
      now: () => Date.now(),
      log: new Logger(undefined, () => 0),
      canSend: () => false,
      canWrite: () => false,
    });
    await expect(queue.enqueue({ kind: "x", method: "POST", path: "/x", coalesce: "replace" })).rejects.toMatchObject({
      code: "consent_required",
    });
  });
});

describe("WriteQueue persistence", () => {
  it("drains writes left in IndexedDB by an earlier page and calls the response handler", async () => {
    const factory = new IDBFactory();
    const db = new Db(factory, () => true);
    const first = new IdbQueueStorage(db);
    await first.add({ kind: "register", method: "POST", path: "/s", body: { a: 1 }, coalesce: "replace", createdAt: 1 });
    await first.add({ kind: "event", method: "POST", path: "/e", coalesce: "append", createdAt: 2 });

    // Next page load.
    const storage = new IdbQueueStorage(new Db(factory, () => true));
    const { queue, send } = makeQueue(storage, []);
    const handled: string[] = [];
    queue.onResponse("register", (w) => {
      handled.push(w.path);
    });
    queue.start();
    await vi.waitFor(async () => expect(await storage.all()).toEqual([]));
    expect(send.mock.calls.map((c) => (c as unknown as [{ path: string }])[0].path)).toEqual(["/s", "/e"]);
    expect(handled).toEqual(["/s"]);
  });
});
