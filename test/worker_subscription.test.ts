import { describe, expect, it } from "vitest";
import type { QueuedWrite } from "../src/net/queue";
import { base64urlToBytes, bytesToBase64url } from "../src/util/base64url";
import { WORKER_REGISTRATION_KIND } from "../src/worker/subscription_change";
import { installWorker } from "../src/worker/worker";
import { jsonResponse } from "./helpers/fake_platform";
import { BASE_CFG, FakeScope, fakeSubscription, FakeWindow, seedCfg } from "./helpers/fake_worker";

const PATH = "/v1/apps/app-1/subscriptions";
const NEW = "https://fcm.googleapis.com/fcm/send/new-endpoint-12345678";
const OLD = "https://fcm.googleapis.com/fcm/send/browser-old-11112222";
const KEY = new Uint8Array([4, 10, 20, 30, 40]);

async function setup(cfg = BASE_CFG) {
  const scope = new FakeScope();
  const db = await seedCfg(scope, cfg);
  installWorker(scope);
  scope.fetch.mockImplementation(async () => jsonResponse({ id: "sub-1", status: 1 }));
  return { scope, db };
}

describe("pushsubscriptionchange", () => {
  it("registers the browser's new subscription on the same row, without opt_in or status", async () => {
    const { scope, db } = await setup();
    await scope.dispatch("pushsubscriptionchange", { oldSubscription: fakeSubscription(OLD), newSubscription: fakeSubscription(NEW) });
    const [req] = scope.requests(PATH);
    expect(req?.url).toBe(`https://api.example.com${PATH}`);
    expect((req?.init.headers as Record<string, string>)["X-OP-SDK-Key"]).toBe(BASE_CFG.sdkKey);
    expect(req?.body).toEqual({
      platform: "web",
      subscription: { endpoint: NEW, expirationTime: null, keys: { p256dh: "BP256DH", auth: "AUTH" } },
      previous_token: OLD,
      subscription_id: "sub-1",
      device_secret: BASE_CFG.deviceSecret,
      sdk_version: expect.stringMatching(/^web\//),
    });
    expect(req?.body).not.toHaveProperty("opt_in");
    expect(req?.body).not.toHaveProperty("status");
    expect((await db.readCfg())?.token).toBe(NEW);
  });

  it("subscribes with the stored key when the browser gives no new subscription; previous_token is cfg.token", async () => {
    const { scope } = await setup();
    await scope.dispatch("pushsubscriptionchange", {});
    const call = scope.registration.pushManager.subscribe.mock.calls[0] as unknown as [{ userVisibleOnly: boolean; applicationServerKey: Uint8Array }];
    expect(call[0].userVisibleOnly).toBe(true);
    expect([...call[0].applicationServerKey]).toEqual([...base64urlToBytes(BASE_CFG.publicKey as string)]);
    expect(scope.requests(PATH)[0]?.body.previous_token).toBe(BASE_CFG.token);
  });

  it("names the key id only when the subscription was made with the stored key", async () => {
    const { scope } = await setup({ ...BASE_CFG, publicKey: bytesToBase64url(KEY) });
    await scope.dispatch("pushsubscriptionchange", { newSubscription: fakeSubscription(NEW, KEY.buffer) });
    expect(scope.requests(PATH)[0]?.body.vapid_key_id).toBe("k1");

    const other = await setup({ ...BASE_CFG, publicKey: bytesToBase64url(KEY) });
    await other.scope.dispatch("pushsubscriptionchange", { newSubscription: fakeSubscription(NEW, new Uint8Array([9, 9]).buffer) });
    expect(other.scope.requests(PATH)[0]?.body).not.toHaveProperty("vapid_key_id");
  });

  it("reports status 0 when permission is gone", async () => {
    const { scope } = await setup();
    scope.Notification = { permission: "denied" };
    scope.registration.pushManager.subscribe.mockRejectedValueOnce(Object.assign(new Error("denied"), { name: "NotAllowedError" }));
    await scope.dispatch("pushsubscriptionchange", {});
    expect(scope.requests(PATH)[0]?.body).toEqual({
      platform: "web",
      token: BASE_CFG.token,
      status: 0,
      previous_token: BASE_CFG.token,
      subscription_id: "sub-1",
      device_secret: BASE_CFG.deviceSecret,
      sdk_version: expect.stringMatching(/^web\//),
    });
  });

  it("queues the registration for the next page load when the POST fails", async () => {
    const { scope, db } = await setup();
    scope.fetch.mockRejectedValue(new TypeError("offline"));
    await scope.dispatch("pushsubscriptionchange", { newSubscription: fakeSubscription(NEW) });
    const rows = (await db.all<QueuedWrite>("queue")).filter((w) => w.kind === WORKER_REGISTRATION_KIND);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ method: "POST", path: PATH, coalesce: "append" });
    expect(rows[0]?.body).toMatchObject({ subscription: { endpoint: NEW }, previous_token: BASE_CFG.token });
    expect(rows[0]?.body).not.toHaveProperty("opt_in");
    expect((await db.readCfg())?.token).toBe(NEW);
  });

  it("queues on 5xx too, but not on a 4xx", async () => {
    const failing = await setup();
    failing.scope.fetch.mockImplementation(async () => jsonResponse({}, 503));
    await failing.scope.dispatch("pushsubscriptionchange", { newSubscription: fakeSubscription(NEW) });
    expect(await failing.db.all("queue")).toHaveLength(1);

    const refused = await setup();
    refused.scope.fetch.mockImplementation(async () => jsonResponse({ detail: "no" }, 409));
    await refused.scope.dispatch("pushsubscriptionchange", { newSubscription: fakeSubscription(NEW) });
    expect(await refused.db.all("queue")).toHaveLength(0);
  });

  it("adopts a server opt-out and a newly issued device secret", async () => {
    const { scope, db } = await setup({ ...BASE_CFG, deviceSecret: undefined });
    scope.fetch.mockImplementation(async () => jsonResponse({ id: "sub-1", status: -2, device_secret: "new-secret-123456" }));
    await scope.dispatch("pushsubscriptionchange", { newSubscription: fakeSubscription(NEW) });
    expect((await db.readCfg())?.deviceSecret).toBe("new-secret-123456");
    expect((await db.readState())?.optedOut).toBe(true);
  });

  it("does nothing before the SDK stored its config", async () => {
    const scope = new FakeScope();
    installWorker(scope);
    await scope.dispatch("pushsubscriptionchange", { newSubscription: fakeSubscription(NEW) });
    expect(scope.fetch).not.toHaveBeenCalled();
  });
});

describe("messages from the page", () => {
  function msg(type: string, payload: unknown) {
    return { op: "openpush", v: 2, type, payload };
  }

  it("stores the posted config without overwriting worker-owned fields, and records the SDK page", async () => {
    const scope = new FakeScope();
    const db = await seedCfg(scope, { ...BASE_CFG, recent: [{ id: "m1", at: 1 }] });
    installWorker(scope);
    scope.windows = [new FakeWindow("w1", "https://play.example.com/")];
    await scope.dispatch("message", {
      data: msg("openpush:config", { ...BASE_CFG, defaultTitle: "New title", recent: [], sdkClients: ["forged"], bootstrap: { app: "x" }, keyId: undefined }),
      source: { id: "w1" },
    });
    const cfg = await db.readCfg();
    expect(cfg?.defaultTitle).toBe("New title");
    expect(cfg?.recent).toEqual([{ id: "m1", at: 1 }]);
    expect(cfg?.sdkClients).toEqual(["w1"]);
    expect(cfg?.keyId).toBe("k1");
    expect(cfg).not.toHaveProperty("bootstrap");
  });

  it("stores the log level", async () => {
    const scope = new FakeScope();
    const db = await seedCfg(scope);
    installWorker(scope);
    await scope.dispatch("message", { data: msg("openpush:log-level", { level: "trace" }) });
    expect((await db.readCfg())?.logLevel).toBe("trace");
    await scope.dispatch("message", { data: msg("openpush:log-level", { level: "loud" }) });
    expect((await db.readCfg())?.logLevel).toBe("trace");
  });

  it("ignores messages outside the protocol", async () => {
    const scope = new FakeScope();
    const db = await seedCfg(scope);
    installWorker(scope);
    await scope.dispatch("message", { data: { op: "openpush:config", cfg: { app: "evil" } } });
    await scope.dispatch("message", { data: { op: "openpush", v: 1, type: "openpush:config", payload: { app: "evil" } } });
    expect((await db.readCfg())?.app).toBe("app-1");
  });
});
