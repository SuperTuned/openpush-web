import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../src/log/logger";
import type { QueuedWrite } from "../src/net/queue";
import { MemoryDb } from "../src/storage/memory";
import { WORKER_TO_PAGE } from "../src/worker/channel";
import { detectStandalone, isOpenPushFile } from "../src/worker/mode";
import { MAX_QUEUED_RECEIPTS, RECEIPT_KIND, Receipts, receiptEvent, type ReceiptEvent } from "../src/worker/receipts";
import { remember, RECENT_MAX, RECENT_TTL_MS, seenRecently } from "../src/worker/recent";
import { installWorker } from "../src/worker/worker";
import { jsonResponse, SITE } from "./helpers/fake_platform";
import { BASE_CFG, FakeScope, FakeWindow, opPush, pushData, SAFARI_UA, FIREFOX_UA, seedCfg, type FakePort } from "./helpers/fake_worker";

const ALL_EVENTS = ["install", "activate", "push", "notificationclick", "notificationclose", "pushsubscriptionchange", "message"];

function ingestEvents(scope: FakeScope): ReceiptEvent[][] {
  return scope.requests("/v1/ingest").map((r) => r.body.events as ReceiptEvent[]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete (globalThis as { __openpushImported?: unknown }).__openpushImported;
});

describe("top-level listeners (cold start)", () => {
  it("installWorker adds every listener synchronously", () => {
    const scope = new FakeScope();
    installWorker(scope);
    // No await between the call and this check.
    expect(scope.addEventListener.mock.calls.map((c) => c[0]).sort()).toEqual([...ALL_EVENTS].sort());
  });

  it("evaluating openpush-sw.js adds every listener before the module finishes", async () => {
    const types: string[] = [];
    const scope = new FakeScope();
    vi.stubGlobal("location", scope.location);
    vi.stubGlobal("registration", scope.registration);
    vi.stubGlobal("clients", scope.clients);
    vi.stubGlobal("skipWaiting", scope.skipWaiting);
    vi.stubGlobal("addEventListener", (type: string) => types.push(type));
    vi.resetModules();
    await import("../src/worker/entry");
    expect(types.sort()).toEqual([...ALL_EVENTS].sort());
    expect((globalThis as { __openpushImported?: unknown }).__openpushImported).toEqual({ scriptURL: `${SITE}/openpush-sw.js`, standalone: true });
    expect((globalThis as { OpenPushWorkerVersion?: string }).OpenPushWorkerVersion).toMatch(/\d/);
  });

  it("install skips waiting and activate claims clients", async () => {
    const scope = new FakeScope();
    installWorker(scope);
    await scope.dispatch("install", {});
    await scope.dispatch("activate", {});
    expect(scope.skipWaiting).toHaveBeenCalledOnce();
    expect(scope.clients.claim).toHaveBeenCalledOnce();
  });

  it("a second import in the same worker adds nothing", () => {
    const scope = new FakeScope();
    expect(installWorker(scope)).toBeDefined();
    expect(installWorker(scope)).toBeUndefined();
    expect(scope.addEventListener).toHaveBeenCalledTimes(ALL_EVENTS.length);
  });
});

describe("__openpushImported and worker modes", () => {
  it("is set from the script URL; the file name alone decides before cfg is read", () => {
    const standalone = new FakeScope("/openpush-sw.js");
    installWorker(standalone);
    expect(standalone.__openpushImported).toEqual({ scriptURL: `${SITE}/openpush-sw.js`, standalone: true });
    const combined = new FakeScope("/sw.js");
    installWorker(combined);
    expect(combined.__openpushImported).toEqual({ scriptURL: `${SITE}/sw.js`, standalone: false });
  });

  it("standalone needs the SDK to have registered that file at the configured path", () => {
    const url = `${SITE}/openpush/openpush-sw.js`;
    expect(isOpenPushFile(url)).toBe(true);
    expect(isOpenPushFile(`${SITE}/sw.js?v=openpush-sw.js`)).toBe(false);
    expect(detectStandalone(url, undefined)).toBe(true);
    expect(detectStandalone(url, { workerPath: "/openpush/openpush-sw.js", workerState: "ok" })).toBe(true);
    expect(detectStandalone(url, { workerPath: "/openpush-sw.js", workerState: "ok" })).toBe(false);
    expect(detectStandalone(url, { workerPath: "/openpush/openpush-sw.js", workerState: "taken" })).toBe(false);
    expect(detectStandalone(`${SITE}/app-sw.js`, { workerPath: "/app-sw.js", workerState: "ok" })).toBe(false);
  });

  it("is refined once cfg is read", async () => {
    const scope = new FakeScope("/openpush-sw.js");
    await seedCfg(scope, { ...BASE_CFG, workerPath: "/other/openpush-sw.js" });
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush()));
    expect(scope.__openpushImported?.standalone).toBe(false);
  });

  const unreadable: [string, unknown][] = [
    ["raw", '"just a string"'],
    ["empty", undefined],
    ["malformed", "{not json"],
    ["a map without op_v or a message id", { title: "Site's own push", body: "x" }],
  ];

  for (const [name, value] of unreadable) {
    it(`standalone: ${name} data gets a notification with the site name and no body`, async () => {
      const scope = new FakeScope("/openpush-sw.js");
      await seedCfg(scope);
      installWorker(scope);
      await scope.dispatch("push", pushData(value));
      expect(scope.shown).toHaveLength(1);
      expect(scope.shown[0]?.title).toBe("Example Play");
      expect(scope.shown[0]?.options.body).toBeUndefined();
      expect(scope.requests("/v1/ingest")).toHaveLength(0);
    });

    it(`combined: ${name} data is left to the site's own handlers`, async () => {
      const scope = new FakeScope("/sw.js");
      await seedCfg(scope, { ...BASE_CFG, workerPath: "/sw.js" });
      installWorker(scope);
      await scope.dispatch("push", pushData(value));
      expect(scope.shown).toHaveLength(0);
      expect(scope.fetch).not.toHaveBeenCalled();
    });
  }

  for (const path of ["/openpush-sw.js", "/sw.js"]) {
    it(`a valid OpenPush push is shown in ${path === "/sw.js" ? "combined" : "standalone"} mode`, async () => {
      const scope = new FakeScope(path);
      await seedCfg(scope, { ...BASE_CFG, workerPath: path });
      installWorker(scope);
      await scope.dispatch("push", pushData(opPush()));
      expect(scope.shown).toHaveLength(1);
      expect(scope.shown[0]?.title).toBe("Spring sale");
    });
  }
});

describe("push: receipts, display and page messages", () => {
  it("posts received, shows, posts confirmed, then tells every window", async () => {
    const scope = new FakeScope();
    await seedCfg(scope);
    const win = new FakeWindow("w1", `${SITE}/`);
    scope.windows = [win];
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush()));

    const calls = scope.requests("/v1/ingest");
    expect(calls.map((c) => (c.body.events as ReceiptEvent[]).map((e) => e.type))).toEqual([["received"], ["confirmed"]]);
    expect(calls[0]?.url).toBe("https://api.example.com/v1/ingest");
    expect((calls[0]?.init.headers as Record<string, string>)["X-OP-SDK-Key"]).toBe(BASE_CFG.sdkKey);
    expect(calls[0]?.body.events).toEqual([
      { type: "received", app: "app-1", message_id: "msg_1", token: BASE_CFG.token, subscription_id: "sub-1" },
    ]);
    expect(scope.shown).toHaveLength(1);
    const received = win.messages(WORKER_TO_PAGE.received);
    expect(received).toHaveLength(1);
    expect((received[0]?.payload as { notification: { id: string } }).notification.id).toBe("msg_1");
  });

  it("falls back to plain options when the browser refuses the full set", async () => {
    const scope = new FakeScope();
    scope.refuseOptions = true;
    await seedCfg(scope);
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush({ op_web_buttons: [{ label: "Go" }] })));
    expect(scope.shown).toHaveLength(1);
    expect(scope.shown[0]?.options.actions).toBeUndefined();
  });

  it("remembers the last received push for unique outcomes", async () => {
    const scope = new FakeScope();
    const db = await seedCfg(scope);
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush()));
    expect((await db.readCfg())?.lastPush).toMatchObject({ messageId: "msg_1", kind: "received" });
  });
});

describe("duplicate guard", () => {
  it("does not show a repeat that is still on screen, and never posts its receipts twice", async () => {
    const scope = new FakeScope();
    const db = await seedCfg(scope);
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush()));
    expect(scope.shown).toHaveLength(1);
    scope.onScreen = [{ title: "Spring sale", data: scope.shown[0]?.options.data, close: vi.fn() }];

    await scope.dispatch("push", pushData(opPush()));
    expect(scope.shown).toHaveLength(1);

    scope.onScreen = [];
    await scope.dispatch("push", pushData(opPush()));
    expect(scope.shown).toHaveLength(2);
    expect(ingestEvents(scope).flat().map((e) => e.type)).toEqual(["received", "confirmed"]);
    expect((await db.readCfg())?.recent?.map((r) => r.id)).toEqual(["msg_1"]);
  });

  it("keeps the last 50 ids for 24 hours", () => {
    let recent = remember(undefined, "a", 0);
    expect(seenRecently(recent, "a", RECENT_TTL_MS - 1)).toBe(true);
    expect(seenRecently(recent, "a", RECENT_TTL_MS)).toBe(false);
    for (let i = 0; i < 60; i++) recent = remember(recent, `m${i}`, 10);
    expect(recent).toHaveLength(RECENT_MAX);
    expect(recent[0]?.id).toBe("m10");
    expect(remember(recent, "late", RECENT_TTL_MS + 20).map((r) => r.id)).toEqual(["late"]);
  });
});

describe("foreground handshake", () => {
  function focusedSdkWindow(answer: boolean | undefined): FakeWindow {
    const win = new FakeWindow("w1", `${SITE}/play`, true);
    win.postMessage.mockImplementation((msg: unknown, transfer?: unknown[]) => {
      const m = msg as { type: string };
      if (m.type !== WORKER_TO_PAGE.foreground || answer === undefined) return;
      (transfer?.[0] as FakePort).postMessage({ op: "openpush", v: 2, type: "openpush:foreground-answer", payload: { display: answer } });
    });
    return win;
  }

  async function run(answer: boolean | undefined, userAgent?: string) {
    const scope = new FakeScope();
    if (userAgent) scope.navigator = { userAgent };
    await seedCfg(scope, { ...BASE_CFG, sdkClients: ["w1"], webhooks: { displayed: "https://hooks.example.com/d", clicked: null, dismissed: null, cors: false } });
    const win = focusedSdkWindow(answer);
    scope.windows = [win];
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush()));
    return { scope, win };
  }

  it("skips display on Chromium when the page answers false; received still posts, confirmed and the webhook do not", async () => {
    const { scope, win } = await run(false);
    expect(win.messages(WORKER_TO_PAGE.foreground)).toHaveLength(1);
    expect(scope.shown).toHaveLength(0);
    expect(ingestEvents(scope).flat().map((e) => e.type)).toEqual(["received"]);
    expect(scope.requests("hooks.example.com")).toHaveLength(0);
    expect(win.messages(WORKER_TO_PAGE.received)).toHaveLength(1);
  });

  it("skips display on Firefox too", async () => {
    const { scope } = await run(false, FIREFOX_UA);
    expect(scope.shown).toHaveLength(0);
  });

  it("Safari always displays", async () => {
    const { scope } = await run(false, SAFARI_UA);
    expect(scope.shown).toHaveLength(1);
  });

  it("displays when the page answers true", async () => {
    const { scope } = await run(true);
    expect(scope.shown).toHaveLength(1);
  });

  it("displays when the page does not answer within 1,000 ms", async () => {
    const started = Date.now();
    const { scope } = await run(undefined);
    expect(scope.shown).toHaveLength(1);
    expect(Date.now() - started).toBeGreaterThanOrEqual(900);
  });

  it("does not ask a focused window that does not run the SDK", async () => {
    const scope = new FakeScope();
    await seedCfg(scope, { ...BASE_CFG, sdkClients: ["other"] });
    const win = new FakeWindow("w1", `${SITE}/`, true);
    scope.windows = [win];
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush()));
    expect(win.messages(WORKER_TO_PAGE.foreground)).toHaveLength(0);
    expect(scope.shown).toHaveLength(1);
  });
});

describe("receipts queue", () => {
  const log = () => new Logger(undefined, () => 0, "none");

  it("keeps failed receipts and sends them first, in order, with the next receipt", async () => {
    const scope = new FakeScope();
    await seedCfg(scope);
    installWorker(scope);
    scope.fetch.mockRejectedValue(new TypeError("offline"));
    await scope.dispatch("push", pushData(opPush({ op_message_id: "m1" })));
    scope.fetch.mockReset();
    scope.fetch.mockImplementation(async () => jsonResponse({ accepted: 3 }));
    await scope.dispatch("push", pushData(opPush({ op_message_id: "m2" })));

    const batches = ingestEvents(scope);
    expect(batches[0]?.map((e) => `${e.type}:${e.message_id}`)).toEqual(["received:m1", "confirmed:m1", "received:m2"]);
    expect(batches[1]?.map((e) => `${e.type}:${e.message_id}`)).toEqual(["confirmed:m2"]);
  });

  it("stores rows the page's write queue can send on the next load", async () => {
    const db = new MemoryDb();
    const receipts = new Receipts({ db, fetch: async () => Promise.reject(new TypeError("offline")), log: log(), now: () => 7 });
    await receipts.post(receiptEvent("received", BASE_CFG, "m1"), BASE_CFG);
    const rows = await db.all<QueuedWrite>("queue");
    expect(rows).toEqual([
      {
        seq: 1,
        kind: RECEIPT_KIND,
        method: "POST",
        path: "/v1/ingest",
        body: { events: [{ type: "received", app: "app-1", message_id: "m1", token: BASE_CFG.token, subscription_id: "sub-1" }] },
        coalesce: "append",
        createdAt: 7,
      },
    ]);
  });

  it("keeps at most 100 receipts, dropping the oldest", async () => {
    const db = new MemoryDb();
    const receipts = new Receipts({ db, fetch: async () => Promise.reject(new TypeError("offline")), log: log(), now: () => 0 });
    for (let i = 0; i < 105; i++) await receipts.post(receiptEvent("received", BASE_CFG, `m${i}`), BASE_CFG);
    const rows = await db.all<QueuedWrite>("queue");
    expect(rows).toHaveLength(MAX_QUEUED_RECEIPTS);
    expect((rows[0]?.body?.events as ReceiptEvent[])[0]?.message_id).toBe("m5");
  });

  it("retries on 5xx and 429, drops on another 4xx", async () => {
    for (const [status, kept] of [
      [503, 1],
      [429, 1],
      [401, 0],
    ] as const) {
      const db = new MemoryDb();
      const receipts = new Receipts({ db, fetch: async () => jsonResponse({}, status), log: log(), now: () => 0 });
      await receipts.post(receiptEvent("confirmed", BASE_CFG, "m1"), BASE_CFG);
      expect(await db.all("queue")).toHaveLength(kept);
    }
  });

  it("stores the receipt when the server is not known yet", async () => {
    const db = new MemoryDb();
    const fetch = vi.fn();
    const receipts = new Receipts({ db, fetch, log: log(), now: () => 0 });
    await receipts.post(receiptEvent("received", { app: "app-1" }, "m1"), { app: "app-1" });
    expect(fetch).not.toHaveBeenCalled();
    expect(await db.all("queue")).toHaveLength(1);
  });

  it("clicked receipts carry action_id; nothing is built without an app", () => {
    expect(receiptEvent("clicked", BASE_CFG, "m1", "b1")).toMatchObject({ type: "clicked", action_id: "b1" });
    expect(receiptEvent("clicked", BASE_CFG, "m1")).toMatchObject({ action_id: "" });
    expect(receiptEvent("received", undefined, "m1")).toBeUndefined();
    expect(receiptEvent("received", BASE_CFG, "")).toBeUndefined();
  });
});
