import { afterEach, describe, expect, it, vi } from "vitest";
import { OpenPushError } from "../src/errors";
import { Logger } from "../src/log/logger";
import { HttpClient } from "../src/net/http";
import { cleanHeaders, HEADERS_TIMEOUT_MS, RequestHeaders, storedHeaders } from "../src/net/request_headers";
import { ROW, STORE } from "../src/storage/idb";
import { MemoryDb } from "../src/storage/memory";
import { installWorker } from "../src/worker/worker";
import { jsonResponse } from "./helpers/fake_platform";
import { BASE_CFG, FakeScope, fakeSubscription, opPush, pushData, seedCfg } from "./helpers/fake_worker";
import { start, type Started } from "./helpers/sdk_harness";

const DEVICE_KEY = "site-token-0123456789";

function logger(): { log: Logger; lines: string[] } {
  const lines: string[] = [];
  const sink = { error: vi.fn(), warn: vi.fn((l: string) => lines.push(l)), info: vi.fn(), debug: vi.fn() };
  return { log: new Logger(sink, () => 0), lines };
}

/** Every line the page SDK wrote to the console. */
function consoleText(run: Started): string {
  const sink = run.fake.sink;
  return [sink.error, sink.warn, sink.info, sink.debug].flatMap((m) => m.mock.calls.map((c) => String(c[0]))).join("\n");
}

async function storedRow(run: Started): Promise<unknown> {
  return run.db.get(STORE.cfg, ROW.headers);
}

afterEach(() => {
  delete (globalThis as { __openpushImported?: unknown }).__openpushImported;
});

describe("cleanHeaders", () => {
  it("keeps text headers and hides their values in logs", () => {
    const { log } = logger();
    const listener = vi.fn();
    log.addListener(listener);
    expect(cleanHeaders({ "X-Site-Token": DEVICE_KEY, "X-Site": "abc" }, log)).toEqual({ "X-Site-Token": DEVICE_KEY, "X-Site": "abc" });
    log.warn(`value ${DEVICE_KEY}`);
    expect(listener.mock.calls[0]?.[0].message).not.toContain(DEVICE_KEY);
  });

  it("refuses reserved headers with a warning that names the header, never the value", () => {
    const { log, lines } = logger();
    const raw = {
      "Content-Type": "text/plain-secret-1",
      authorization: "Bearer secret-2",
      Cookie: "a=secret-3",
      Host: "secret-4.example.com",
      Origin: "https://secret-5.example.com",
      "X-OP-SDK-Key": "secret-6",
      "x-op-api-key": "secret-7",
      "Sec-Fetch-Mode": "secret-8",
      "Proxy-Authorization": "secret-9",
      "X-Kept": "fine",
    };
    expect(cleanHeaders(raw, log)).toEqual({ "X-Kept": "fine" });
    expect(lines).toHaveLength(9);
    for (const name of Object.keys(raw).slice(0, 9)) expect(lines.join("\n")).toContain(`"${name}" was not sent`);
    expect(lines.join("\n")).not.toMatch(/secret-/);
  });

  it("refuses bad names, non-text values and values with line breaks", () => {
    const { log, lines } = logger();
    const raw = { "Bad Name": "x", "X-Number": 5, "X-Null": null, "X-Break": "a\r\nInjected: yes", "X-Tab": "a\tb" } as unknown;
    expect(cleanHeaders(raw, log)).toEqual({ "X-Tab": "a\tb" });
    expect(lines).toHaveLength(4);
    expect(lines.join("\n")).not.toContain("Injected");
  });

  it("refuses anything but an object, once", () => {
    const { log, lines } = logger();
    expect(cleanHeaders(["X-A", "b"], log)).toEqual({});
    expect(cleanHeaders("X-A: b", log)).toEqual({});
    expect(lines).toHaveLength(1);
    expect(cleanHeaders(undefined, log)).toEqual({});
  });

  it("keeps one header per name, the last one given", () => {
    const { log } = logger();
    expect(cleanHeaders({ "x-site": "a", "X-Site": "b" }, log)).toEqual({ "X-Site": "b" });
  });

  it("warns once per header and reason across requests", () => {
    const { log, lines } = logger();
    cleanHeaders({ Cookie: "a" }, log);
    cleanHeaders({ Cookie: "b" }, log);
    expect(lines).toHaveLength(1);
  });
});

describe("HttpClient with extra headers", () => {
  it("adds them to authenticated requests; the SDK's own headers win", async () => {
    const fetch = vi.fn(async () => jsonResponse({}));
    const http = new HttpClient({
      fetch,
      serverUrl: () => "https://api.example.com",
      sdkKey: () => "sdk_key_real",
      log: logger().log,
      allowed: () => true,
      extraHeaders: async () => ({ "X-OP-SDK-Key": "forged", "Content-Type": "text/plain", "X-Site-Token": DEVICE_KEY }),
    });
    await http.send({ method: "POST", path: "/v1/ingest", body: {} });
    await http.send({ method: "GET", path: "/v1/apps/a/webpush-config", auth: false });
    const calls = fetch.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]?.[1].headers).toEqual({ "X-OP-SDK-Key": "sdk_key_real", "Content-Type": "application/json", "X-Site-Token": DEVICE_KEY });
    expect(calls[1]?.[1].headers).toEqual({});
  });
});

describe("RequestHeaders (page)", () => {
  const timers = { setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms), clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>) };

  it("stores a copy only when the headers change, and removes it when they are empty", async () => {
    const db = new MemoryDb();
    const put = vi.spyOn(db, "put");
    let value: Record<string, string> = { "X-A": "one" };
    const headers = new RequestHeaders({ option: () => value, db, log: logger().log, timers });
    await headers.sync();
    await headers.resolve();
    await headers.sync();
    expect(put).toHaveBeenCalledTimes(1);
    value = { "X-A": "two" };
    await headers.sync();
    expect(await db.get(STORE.cfg, ROW.headers)).toEqual({ "X-A": "two" });
    value = {};
    await headers.sync();
    expect(await db.get(STORE.cfg, ROW.headers)).toBeUndefined();
  });

  it("goes without the extra headers when the function never answers", async () => {
    vi.useFakeTimers();
    try {
      const { log, lines } = logger();
      const headers = new RequestHeaders({ option: () => new Promise<Record<string, string>>(() => undefined), db: new MemoryDb(), log, timers });
      const result = headers.resolve();
      await vi.advanceTimersByTimeAsync(HEADERS_TIMEOUT_MS);
      expect(await result).toEqual({});
      expect(lines.join("\n")).toContain("did not answer within 5 seconds");
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps working when storage refuses the copy (consent not given)", async () => {
    const db = new MemoryDb(() => false);
    const headers = new RequestHeaders({ option: { "X-A": "one" }, db, log: logger().log, timers });
    await headers.sync();
    expect(await headers.resolve()).toEqual({ "X-A": "one" });
  });
});

describe("requestHeaders on the page", () => {
  it("object form: on the registration, not on the public config request", async () => {
    const run = await start({ options: { requestHeaders: { "X-Site-Token": DEVICE_KEY } } });
    const regs = run.requests().filter((r) => r.path.endsWith("/subscriptions"));
    expect(regs.length).toBeGreaterThan(0);
    for (const r of regs) {
      expect(r.headers["X-Site-Token"]).toBe(DEVICE_KEY);
      expect(r.headers["X-OP-SDK-Key"]).toBe("sdk_key_abcdef123456");
    }
    expect(run.configHeaders().length).toBeGreaterThan(0);
    for (const h of run.configHeaders()) expect(h["X-Site-Token"]).toBeUndefined();
    expect(consoleText(run)).not.toContain(DEVICE_KEY);
  });

  it("function form: called before each request, so a new value is sent", async () => {
    let key = "site-token-first-000";
    const fn = vi.fn(() => ({ "X-Site-Token": key }));
    const run = await start({ options: { requestHeaders: fn } });
    expect(run.registrations().length).toBeGreaterThan(0);
    run.reset();
    key = "site-token-second-111";
    await run.api.PushSubscription.optOut();
    await run.settle();
    const regs = run.requests().filter((r) => r.path.endsWith("/subscriptions"));
    expect(regs.length).toBeGreaterThan(0);
    expect(regs.every((r) => r.headers["X-Site-Token"] === key)).toBe(true);
    expect(fn.mock.calls.length).toBeGreaterThan(1);
  });

  it("async function form, on user calls and opt-in too", async () => {
    const run = await start({ options: { requestHeaders: async () => ({ "X-Site-Token": DEVICE_KEY }) } });
    run.reset();
    await run.api.login("player-1");
    await run.api.PushSubscription.optOut();
    await run.api.PushSubscription.optIn();
    await run.settle();
    const sent = run.requests();
    expect(sent.length).toBeGreaterThan(0);
    for (const r of sent) expect(r.headers["X-Site-Token"]).toBe(DEVICE_KEY);
  });

  it("reserved headers are left out with a warning; the request still goes", async () => {
    const run = await start({ options: { requestHeaders: { Authorization: "Bearer hidden-value-1", "X-Site-Token": DEVICE_KEY } } });
    const reg = run.registrations()[0];
    expect(reg).toBeDefined();
    const r = run.requests().find((x) => x.path.endsWith("/subscriptions"));
    expect(r?.headers.Authorization).toBeUndefined();
    expect(r?.headers["X-Site-Token"]).toBe(DEVICE_KEY);
    const text = consoleText(run);
    expect(text).toContain('"Authorization" was not sent');
    expect(text).not.toContain("hidden-value-1");
  });

  it("a function that throws sends the request without the extra headers", async () => {
    const run = await start({
      options: {
        requestHeaders: () => {
          throw new Error("boom");
        },
      },
    });
    const regs = run.requests().filter((r) => r.path.endsWith("/subscriptions"));
    expect(regs.length).toBeGreaterThan(0);
    expect(regs[0]?.headers["X-Site-Token"]).toBeUndefined();
    expect(consoleText(run)).toContain("requestHeaders: the function failed");
  });

  it("initialize refuses a value that is neither an object nor a function", async () => {
    const run = await start({ init: false });
    await expect(run.api.initialize({ appId: "app-1", requestHeaders: "X-A: b" as never })).rejects.toBeInstanceOf(OpenPushError);
  });

  it("stores the headers for the worker, and removes them when the option is removed", async () => {
    const first = await start({ options: { requestHeaders: { "X-Site-Token": DEVICE_KEY } } });
    expect(await storedRow(first)).toEqual({ "X-Site-Token": DEVICE_KEY });
    const second = await start({ idb: first.fake.idb });
    expect(second.runtime.context).toBeDefined();
    expect(await storedRow(second)).toBeUndefined();
  });

  it("logout removes the stored copy; the next request stores what the option gives then", async () => {
    let key: string | undefined = DEVICE_KEY;
    const run = await start({ options: { requestHeaders: (): Record<string, string> => (key ? { "X-Site-Token": key } : {}) } });
    expect(await storedRow(run)).toEqual({ "X-Site-Token": DEVICE_KEY });
    await run.api.logout();
    await run.settle();
    expect(await storedRow(run)).toBeUndefined();
    key = "site-token-after-logout-222";
    await run.api.login("player-2");
    await run.settle();
    expect(await storedRow(run)).toEqual({ "X-Site-Token": "site-token-after-logout-222" });
    key = undefined;
    await run.api.logout();
    await run.settle();
    expect(await storedRow(run)).toBeUndefined();
  });

  it("logout after login leaves no copy, though the detach request carries the headers", async () => {
    const run = await start({ options: { requestHeaders: { "X-Site-Token": DEVICE_KEY } } });
    await run.api.login("player-1");
    await run.settle();
    expect(await storedRow(run)).toEqual({ "X-Site-Token": DEVICE_KEY });
    await run.api.logout();
    await run.settle();
    expect(await storedRow(run)).toBeUndefined();
  });
});

describe("requestHeaders in the service worker", () => {
  it("receipts carry the headers the page stored, read before each receipt", async () => {
    const scope = new FakeScope();
    const db = await seedCfg(scope);
    await db.put(STORE.cfg, ROW.headers, { "X-Site-Token": DEVICE_KEY });
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush()));
    const first = scope.requests("/v1/ingest");
    expect(first.length).toBeGreaterThan(0);
    for (const c of first) {
      const headers = c.init.headers as Record<string, string>;
      expect(headers["X-Site-Token"]).toBe(DEVICE_KEY);
      expect(headers["X-OP-SDK-Key"]).toBe(BASE_CFG.sdkKey);
    }

    await db.delete(STORE.cfg, ROW.headers);
    scope.fetch.mockClear();
    await scope.dispatch("push", pushData(opPush({ op_message_id: "msg_2" })));
    const after = scope.requests("/v1/ingest");
    expect(after.length).toBeGreaterThan(0);
    for (const c of after) expect((c.init.headers as Record<string, string>)["X-Site-Token"]).toBeUndefined();
  });

  it("clicked receipts carry them too", async () => {
    const scope = new FakeScope();
    const db = await seedCfg(scope);
    await db.put(STORE.cfg, ROW.headers, { "X-Site-Token": DEVICE_KEY });
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush()));
    const shown = scope.shown[0];
    expect(shown).toBeDefined();
    scope.fetch.mockClear();
    await scope.dispatch("notificationclick", { notification: { ...shown!.options, title: shown!.title, close: vi.fn() }, action: "" } as never);
    const clicked = scope.requests("/v1/ingest").filter((c) => (c.body.events as { type: string }[]).some((e) => e.type === "clicked"));
    expect(clicked).toHaveLength(1);
    expect((clicked[0]?.init.headers as Record<string, string>)["X-Site-Token"]).toBe(DEVICE_KEY);
  });

  it("a stored copy is checked again: reserved headers never leave the worker", async () => {
    const scope = new FakeScope();
    const db = await seedCfg(scope);
    await db.put(STORE.cfg, ROW.headers, { Cookie: "a=b", "X-Site-Token": DEVICE_KEY });
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush()));
    const headers = scope.requests("/v1/ingest")[0]?.init.headers as Record<string, string>;
    expect(headers.Cookie).toBeUndefined();
    expect(headers["X-Site-Token"]).toBe(DEVICE_KEY);
  });

  it("the subscription-change registration carries them", async () => {
    const scope = new FakeScope();
    const db = await seedCfg(scope);
    await db.put(STORE.cfg, ROW.headers, { "X-Site-Token": DEVICE_KEY });
    scope.fetch.mockImplementation(async () => jsonResponse({ id: "sub-1", status: 1 }));
    installWorker(scope);
    await scope.dispatch("pushsubscriptionchange", { newSubscription: fakeSubscription("https://fcm.googleapis.com/fcm/send/next-endpoint-1234") } as never);
    const regs = scope.requests("/subscriptions");
    expect(regs).toHaveLength(1);
    expect((regs[0]?.init.headers as Record<string, string>)["X-Site-Token"]).toBe(DEVICE_KEY);
  });

  it("storedHeaders reads nothing when there is no copy", async () => {
    expect(await storedHeaders(new MemoryDb(), logger().log)).toEqual({});
  });
});
