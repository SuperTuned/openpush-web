/**
 * Push subscription lifecycle on the page, driven through
 * the public API with a fake browser, a fake push manager and a fake server.
 */
import { describe, expect, it, vi } from "vitest";
import { createOpenPush, type OpenPushApi, type Runtime } from "../src/core/sdk";
import type { LogLevel } from "../src/log/levels";
import type { PermissionValue } from "../src/platform/types";
import type { PushSubscriptionChange } from "../src/push/state";
import { Db } from "../src/storage/idb";
import { LOCAL_KEY } from "../src/storage/local";
import type { CfgRow, StateRow } from "../src/storage/types";
import { PAGE_TO_WORKER } from "../src/worker/channel";
import { WORKER_REGISTRATION_KIND } from "../src/worker/subscription_change";
import { bootstrapBody, fakePlatform, flush, jsonResponse, type Fake } from "./helpers/fake_platform";
import { ACTIVE_KEY, AUTH, endpoint, FakePushManager, FIREBASE_KEY, firebaseToken, OLD_KEY, P256DH } from "./helpers/fake_push";

type Body = Record<string, unknown>;

/** A small stand-in for `POST /v1/apps/{app}/subscriptions`. */
function server(options: { status?: number; moveFailedStatus?: number; conflictOnMove?: boolean } = {}) {
  let issued = 0;
  return async (body: Body): Promise<Response> => {
    if (body.move_failed) return jsonResponse({ id: "sub-7", app: "app-1", status: options.moveFailedStatus ?? 1, move_pending: true });
    if (options.conflictOnMove && body.previous_token) return jsonResponse({ detail: "No proof" }, 409);
    const out: Body = {
      id: typeof body.subscription_id === "string" ? body.subscription_id : "sub-1",
      app: "app-1",
      status: options.status ?? (typeof body.status === "number" ? body.status : 1),
    };
    if (body.subscription && !body.device_secret) out.device_secret = `secret-${++issued}-abcdefghijkl`;
    if (body.previous_token) out.moved = true;
    return jsonResponse(out);
  };
}

interface Load {
  fake: Fake;
  api: OpenPushApi;
  runtime: Runtime;
  manager: FakePushManager;
  idb: IDBFactory;
  db: Db;
  posts(): Body[];
  settle(): Promise<void>;
  cfg(): Promise<CfgRow | undefined>;
  state(): Promise<StateRow | undefined>;
}

interface LoadOptions {
  permission?: PermissionValue;
  promptAnswer?: PermissionValue;
  pushApi?: boolean;
  boot?: Body;
  cfg?: Partial<CfgRow>;
  state?: Partial<StateRow>;
  v1?: Body;
  queue?: Body[];
  respond?: (body: Body) => Promise<Response>;
  manager?: FakePushManager;
  /** The next page load in the same browser. */
  from?: Load;
  /** Instant timers that record each delay asked for. */
  delays?: number[];
  before?: (api: OpenPushApi) => void;
  logLevel?: LogLevel;
}

async function load(o: LoadOptions = {}): Promise<Load> {
  const respond = o.respond ?? server();
  const fake = fakePlatform({
    permission: o.permission ?? o.from?.fake.permission.value ?? "granted",
    promptAnswer: o.promptAnswer,
    pushApi: o.pushApi,
    fetch: async (url: string, init?: RequestInit) => {
      if (url.includes("/webpush-config")) {
        const body = bootstrapBody({ web_push: { public_key: ACTIVE_KEY, key_id: "k2" }, move: { from_firebase: true }, ...o.boot });
        return jsonResponse(body, 200, { ETag: '"e1"' });
      }
      if (url.includes("/subscriptions")) return respond(JSON.parse(String(init?.body)) as Body);
      return jsonResponse({}, 404);
    },
  });
  const idb = o.from?.idb ?? fake.idb;
  const storage = o.from?.fake.storage ?? fake.storage;
  fake.platform.indexedDB = () => idb;
  fake.platform.localStorage = () => storage;
  const db = new Db(idb, () => true);
  if (o.cfg) await db.mergeCfg({ app: "app-1", ...o.cfg });
  if (o.state) await db.mergeState(o.state);
  for (const body of o.queue ?? []) {
    await db.add("queue", { kind: WORKER_REGISTRATION_KIND, method: "POST", path: "/v1/apps/app-1/subscriptions", body, coalesce: "append", createdAt: 1 });
  }
  if (o.v1) storage.map.set(LOCAL_KEY.v1, JSON.stringify(o.v1));
  const manager = o.manager ?? o.from?.manager ?? new FakePushManager();
  fake.container.pushManager = manager;
  const delays = o.delays;
  if (delays) {
    fake.platform.timers = {
      setTimeout: (fn, ms) => {
        delays.push(ms);
        return setTimeout(fn, 0);
      },
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    };
  }
  const { api, runtime } = createOpenPush({ platform: fake.platform });
  o.before?.(api);
  await api.initialize(o.logLevel ? { appId: "app-1", logLevel: o.logLevel } : { appId: "app-1" });
  const posts = (): Body[] =>
    fake.fetch.mock.calls
      .filter((c) => String(c[0]).includes("/subscriptions"))
      .map((c) => JSON.parse(String((c[1] as RequestInit).body)) as Body);
  const queueEmpty = async (): Promise<void> => {
    await vi.waitFor(async () => expect(await runtime.context?.queue.size()).toBe(0));
  };
  const settle = async (): Promise<void> => {
    for (let round = 0; round < 3; round++) {
      await runtime.push.whenIdle();
      await flush(20);
      await queueEmpty();
      await flush(20);
    }
  };
  await settle();
  return { fake, api, runtime, manager, idb, db, posts, settle, cfg: () => db.readCfg(), state: () => db.readState() };
}

const registrations = (l: Load): Body[] => l.posts().filter((b) => !b.move_failed);
const moveFailures = (l: Load): Body[] => l.posts().filter((b) => !!b.move_failed);
const last = <T>(list: T[]): T | undefined => list[list.length - 1];

/** A browser with a direct row for this app, subscribed with the active key. */
function directRow(token: string, extra: Partial<CfgRow> = {}): Partial<CfgRow> {
  return { token, subscriptionId: "sub-1", deviceSecret: "secret-row-abcdef123", subPublicKey: ACTIVE_KEY, subKeyId: "k2", ...extra };
}

describe("opt_in rules", () => {
  it("requestPermission that moves permission from default to granted sends opt_in: true", async () => {
    const l = await load({ permission: "default" });
    expect(l.posts()).toHaveLength(0);
    await expect(l.api.Notifications.requestPermission()).resolves.toBe(true);
    await l.settle();
    expect(l.fake.requestPermission).toHaveBeenCalledTimes(1);
    const [body] = registrations(l);
    expect(body).toMatchObject({ platform: "web", status: 1, opt_in: true, vapid_key_id: "k2" });
    expect(body?.subscription).toMatchObject({ keys: { p256dh: P256DH, auth: AUTH } });
    expect(body).not.toHaveProperty("previous_token");
  });

  it("requestPermission when permission was already granted sends no opt_in", async () => {
    const ep = endpoint();
    const manager = new FakePushManager();
    manager.have(ep, ACTIVE_KEY);
    const l = await load({ manager, cfg: directRow(ep), state: { lastStatus: 1 } });
    const before = l.posts().length;
    await expect(l.api.Notifications.requestPermission()).resolves.toBe(true);
    await l.settle();
    expect(l.fake.requestPermission).not.toHaveBeenCalled();
    const sent = l.posts().slice(before);
    expect(sent.length).toBeGreaterThan(0);
    for (const body of sent) expect(body).not.toHaveProperty("opt_in");
  });

  it("optIn() clears the opt-out and sends status 1 with opt_in: true and the device secret", async () => {
    const ep = endpoint();
    const manager = new FakePushManager();
    manager.have(ep, ACTIVE_KEY);
    const l = await load({ manager, cfg: directRow(ep), state: { optedOut: true, lastStatus: -2 } });
    // Page load asked for -2 (opted out) and no opt_in.
    for (const body of l.posts()) {
      expect(body).not.toHaveProperty("opt_in");
      expect(body.status).toBe(-2);
    }
    await l.api.PushSubscription.optIn();
    await l.settle();
    expect(last(registrations(l))).toMatchObject({ status: 1, opt_in: true, device_secret: "secret-row-abcdef123" });
    expect((await l.state())?.optedOut).toBe(false);
    expect(l.api.PushSubscription.status).toBe("subscribed");
  });

  it("a tap on an OpenPush prompt (subscribeFromGesture with optIn) sends opt_in: true", async () => {
    const l = await load({ permission: "default" });
    await l.runtime.push.subscribeFromGesture({ optIn: true });
    await l.settle();
    expect(last(registrations(l))).toMatchObject({ status: 1, opt_in: true });
  });

  it("the auto browser prompt (subscribeFromGesture({optIn: false})) granted sends no opt_in", async () => {
    // A timer-fired browser prompt is not the person's gesture: a -2 the server holds stays.
    const l = await load({ permission: "default" });
    await expect(l.runtime.push.subscribeFromGesture({ optIn: false })).resolves.toMatchObject({ permission: "granted", subscribed: true });
    await l.settle();
    expect(registrations(l).length).toBeGreaterThan(0);
    for (const body of registrations(l)) expect(body).not.toHaveProperty("opt_in");
  });

  it("an opted-out tap on Allow keeps the opt-out when the browser prompt is dismissed", async () => {
    const ep = endpoint();
    const manager = new FakePushManager();
    manager.have(ep, ACTIVE_KEY);
    const l = await load({ permission: "default", promptAnswer: "default", manager, cfg: directRow(ep), state: { optedOut: true, lastStatus: -2 } });
    const pending = l.api.PushSubscription.optIn();
    // Before the browser answers, the opt-out still holds.
    expect(l.runtime.push.optedOutLocally).toBe(true);
    await pending;
    await l.settle();
    expect(l.runtime.push.optedOutLocally).toBe(true);
    expect((await l.state())?.optedOut).toBe(true);
    for (const body of registrations(l)) expect(body).not.toHaveProperty("opt_in");
  });

  it("an opted-out tap on Allow clears the opt-out once the browser grants permission", async () => {
    const l = await load({ permission: "default", state: { optedOut: true, lastStatus: -2 } });
    expect(l.runtime.push.optedOutLocally).toBe(true);
    await l.api.PushSubscription.optIn();
    await l.settle();
    expect(l.runtime.push.optedOutLocally).toBe(false);
    expect(last(registrations(l))).toMatchObject({ status: 1, opt_in: true });
  });

  it("page-load reconciliation never sends opt_in, and registers only when something changed", async () => {
    const ep = endpoint();
    const manager = new FakePushManager();
    manager.have(ep, ACTIVE_KEY);
    const first = await load({ manager, cfg: directRow(ep), state: { lastStatus: 1 } });
    expect(registrations(first)).toHaveLength(1);
    expect(registrations(first)[0]).not.toHaveProperty("opt_in");
    expect(registrations(first)[0]).toMatchObject({ status: 1, device_secret: "secret-row-abcdef123" });
    const second = await load({ from: first });
    expect(second.posts()).toHaveLength(0);
  });

  it("auto resubscribe (cleared site data) sends no opt_in", async () => {
    const l = await load();
    expect(l.manager.subscribe).toHaveBeenCalledTimes(1);
    const [body] = registrations(l);
    expect(body).toMatchObject({ status: 1 });
    expect(body).not.toHaveProperty("opt_in");
    expect(body).not.toHaveProperty("previous_token");
  });

  it("a -2 in a registration response sets the local opt-out", async () => {
    const l = await load({ respond: server({ status: -2 }) });
    expect((await l.state())?.optedOut).toBe(true);
    expect(l.api.PushSubscription.status).toBe("opted_out");
    expect(l.api.PushSubscription.optedIn).toBe(false);
  });

  it("another negative status is logged, not adopted", async () => {
    const l = await load({ respond: server({ status: -10 }) });
    expect((await l.state())?.optedOut).not.toBe(true);
    expect(l.fake.sink.warn.mock.calls.some((c) => String(c[0]).includes("-10"))).toBe(true);
  });

  it("optOut() sends status -2 by token, with no opt_in, and keeps the browser subscription", async () => {
    const ep = endpoint();
    const manager = new FakePushManager();
    const sub = manager.have(ep, ACTIVE_KEY);
    const l = await load({ manager, cfg: directRow(ep), state: { lastStatus: 1 } });
    await l.api.PushSubscription.optOut();
    await l.settle();
    expect(last(registrations(l))).toMatchObject({ platform: "web", token: ep, status: -2, device_secret: "secret-row-abcdef123" });
    expect(last(registrations(l))).not.toHaveProperty("opt_in");
    expect(sub.unsubscribe).not.toHaveBeenCalled();
    expect(l.api.PushSubscription.status).toBe("opted_out");
  });
});

describe("auto resubscribe", () => {
  it("never clears an opt-out", async () => {
    const ep = endpoint();
    const l = await load({ cfg: directRow(ep), state: { optedOut: true, lastStatus: -2 } });
    expect(l.manager.subscribe).not.toHaveBeenCalled();
    expect(l.posts()).toHaveLength(0);
    expect(l.api.PushSubscription.status).toBe("opted_out");
  });

  it("is off: a browser without a subscription is left alone", async () => {
    const l = await load({ boot: { auto_resubscribe: false }, cfg: directRow(endpoint()) });
    expect(l.manager.subscribe).not.toHaveBeenCalled();
  });

  it("a lost subscription is made again on the same row (old endpoint and device secret, no opt_in)", async () => {
    const ep = endpoint();
    const l = await load({ cfg: directRow(ep), state: { lastStatus: 1 } });
    const [body] = registrations(l);
    expect(body).toMatchObject({ previous_token: ep, device_secret: "secret-row-abcdef123", status: 1 });
    expect(body).not.toHaveProperty("opt_in");
  });
});

describe("new_registrations: false", () => {
  const off = { direct: { new_registrations: false }, move: { from_firebase: false } };

  it("makes no new subscription and shows no browser prompt", async () => {
    const l = await load({ boot: off });
    expect(l.manager.subscribe).not.toHaveBeenCalled();
    expect(l.posts()).toHaveLength(0);
    const quiet = await load({ boot: off, permission: "default" });
    await expect(quiet.api.Notifications.requestPermission()).resolves.toBe(false);
    expect(quiet.fake.requestPermission).not.toHaveBeenCalled();
  });

  it("makes no move", async () => {
    const fb = firebaseToken();
    const manager = new FakePushManager();
    const old = manager.have(endpoint("firebase"), FIREBASE_KEY);
    const l = await load({ boot: off, manager, cfg: { token: fb }, v1: { token: fb, subscriptionId: "sub-7" } });
    expect(old.unsubscribe).not.toHaveBeenCalled();
    expect(l.manager.subscribe).not.toHaveBeenCalled();
    expect(l.posts()).toHaveLength(0);
  });

  it("keeps an existing direct subscription current", async () => {
    const ep = endpoint();
    const l = await load({ boot: off, cfg: directRow(ep), state: { lastStatus: 1 } });
    expect(l.manager.subscribe).toHaveBeenCalledTimes(1);
    expect(registrations(l)[0]).toMatchObject({ previous_token: ep, device_secret: "secret-row-abcdef123" });
  });
});

describe("silent move from Firebase", () => {
  const fb = firebaseToken();
  const v1 = { token: fb, subscriptionId: "sub-7", externalId: "player-9" };

  function firebaseBrowser(): FakePushManager {
    const manager = new FakePushManager();
    manager.have(endpoint("firebase"), FIREBASE_KEY);
    return manager;
  }

  it("unsubscribes, subscribes with the app key, registers with previous_token and subscription_id, no opt_in", async () => {
    const manager = firebaseBrowser();
    const old = manager.current;
    const l = await load({ manager, cfg: { token: fb, firebase: { projectId: "p" } }, v1 });
    expect(old?.unsubscribe).toHaveBeenCalledTimes(1);
    expect(old?.unsubscribe.mock.invocationCallOrder[0]).toBeLessThan(manager.subscribe.mock.invocationCallOrder[0] ?? 0);
    expect(manager.keysUsed).toEqual([ACTIVE_KEY]);
    const [body] = registrations(l);
    expect(body).toMatchObject({ previous_token: fb, subscription_id: "sub-7", vapid_key_id: "k2", status: 1 });
    expect(body).not.toHaveProperty("opt_in");
    expect(body).not.toHaveProperty("device_secret");

    const cfg = await l.cfg();
    expect(cfg?.token).toBe(manager.current?.endpoint);
    expect(cfg?.subscriptionId).toBe("sub-7");
    expect(cfg?.deviceSecret).toBe("secret-1-abcdefghijkl");
    expect(cfg?.move).toBeUndefined();
    expect(cfg?.firebase).toBeUndefined();
    expect((await l.state())?.externalId).toBe("player-9");
    expect(l.api.PushSubscription.id).toBe("sub-7");
    // v1's localStorage state is removed once the browser has moved.
    expect(l.fake.storage.map.has(LOCAL_KEY.v1)).toBe(false);
  });

  it("keeps v1's localStorage state while the move has not finished", async () => {
    const manager = firebaseBrowser();
    manager.failNext = 4;
    const l = await load({ manager, cfg: { token: fb, firebase: { projectId: "p" } }, v1, delays: [] });
    expect(moveFailures(l)).toHaveLength(1);
    expect(l.fake.storage.map.has(LOCAL_KEY.v1)).toBe(true);
  });

  it("without a stored subscription id, registers as a new row", async () => {
    const l = await load({ manager: firebaseBrowser(), cfg: { token: fb }, v1: { token: fb } });
    const [body] = registrations(l);
    expect(body).not.toHaveProperty("previous_token");
    expect(body).not.toHaveProperty("subscription_id");
    expect(l.fake.storage.map.has(LOCAL_KEY.v1)).toBe(false);
  });

  it("retries subscribe() after 1 s, 4 s and 15 s in the same visit", async () => {
    const manager = firebaseBrowser();
    manager.failNext = 3;
    const delays: number[] = [];
    const l = await load({ manager, cfg: { token: fb }, v1, delays });
    expect(manager.subscribe).toHaveBeenCalledTimes(4);
    expect(delays.slice(0, 3)).toEqual([1_000, 4_000, 15_000]);
    expect(registrations(l)[0]).toMatchObject({ previous_token: fb, subscription_id: "sub-7" });
    expect(moveFailures(l)).toHaveLength(0);
  });

  it("still failing: sends move_failed with the proof, keeps previous_token, and moves on the next load", async () => {
    const manager = firebaseBrowser();
    manager.failNext = 4;
    const first = await load({ manager, cfg: { token: fb }, v1, delays: [] });
    expect(manager.subscribe).toHaveBeenCalledTimes(4);
    expect(registrations(first)).toHaveLength(0);
    expect(moveFailures(first)).toEqual([
      { platform: "web", previous_token: fb, subscription_id: "sub-7", move_failed: { error: "AbortError" }, sdk_version: expect.stringMatching(/^web\//) },
    ]);
    expect((await first.cfg())?.move).toEqual({ kind: "firebase", previousToken: fb, subscriptionId: "sub-7" });

    const next = await load({ from: first });
    expect(registrations(next)[0]).toMatchObject({ previous_token: fb, subscription_id: "sub-7" });
    expect((await next.cfg())?.move).toBeUndefined();
  });

  it("a -2 in the move_failed response sets the local opt-out", async () => {
    const manager = firebaseBrowser();
    manager.failNext = 4;
    const l = await load({ manager, cfg: { token: fb }, v1, delays: [], respond: server({ moveFailedStatus: -2 }) });
    expect((await l.state())?.optedOut).toBe(true);
  });

  it("409: drops previous_token, registers once as a new row, logs move_refused once", async () => {
    const l = await load({ manager: firebaseBrowser(), cfg: { token: fb }, v1, respond: server({ conflictOnMove: true }) });
    const regs = registrations(l);
    expect(regs).toHaveLength(2);
    expect(regs[0]).toMatchObject({ previous_token: fb, subscription_id: "sub-7" });
    expect(regs[1]).not.toHaveProperty("previous_token");
    expect(regs[1]).not.toHaveProperty("subscription_id");
    expect(regs[1]).not.toHaveProperty("device_secret");
    const refused = l.fake.sink.warn.mock.calls.filter((c) => String(c[0]).includes("move_refused"));
    expect(refused).toHaveLength(1);
    const cfg = await l.cfg();
    expect(cfg?.move).toBeUndefined();
    expect(cfg?.deviceSecret).toBe("secret-1-abcdefghijkl");
  });
});

describe("move between OpenPush keys", () => {
  function rotated(): { manager: FakePushManager; old: string; cfg: Partial<CfgRow> } {
    const old = endpoint("oldkey");
    const manager = new FakePushManager();
    manager.have(old, OLD_KEY);
    return { manager, old, cfg: directRow(old, { subPublicKey: OLD_KEY, subKeyId: "k1", publicKey: OLD_KEY, keyId: "k1" }) };
  }

  it("unsubscribes, subscribes with the new key, registers with the old endpoint and device secret", async () => {
    const { manager, old, cfg } = rotated();
    const l = await load({ manager, cfg, state: { lastStatus: 1 } });
    expect(manager.keysUsed).toEqual([ACTIVE_KEY]);
    const [body] = registrations(l);
    expect(body).toMatchObject({ previous_token: old, device_secret: "secret-row-abcdef123", vapid_key_id: "k2", status: 1 });
    expect(body).not.toHaveProperty("opt_in");
    expect(body).not.toHaveProperty("subscription_id");
    expect((await l.cfg())?.subKeyId).toBe("k2");
  });

  it("every try fails: subscribes again with the old key, a normal update with the old key id, plus move_failed", async () => {
    const { manager, old, cfg } = rotated();
    manager.failingKeys.add(ACTIVE_KEY);
    const l = await load({ manager, cfg, state: { lastStatus: 1 }, delays: [] });
    expect(manager.keysUsed).toEqual([ACTIVE_KEY, ACTIVE_KEY, ACTIVE_KEY, ACTIVE_KEY, OLD_KEY]);
    const [update] = registrations(l);
    expect(update).toMatchObject({ vapid_key_id: "k1", previous_token: old, device_secret: "secret-row-abcdef123" });
    expect(update).not.toHaveProperty("opt_in");
    expect(moveFailures(l)).toEqual([
      expect.objectContaining({ previous_token: old, device_secret: "secret-row-abcdef123", move_failed: { error: "AbortError" } }),
    ]);
    const stored = await l.cfg();
    expect(stored?.token).toBe(manager.current?.endpoint);
    expect(stored?.subKeyId).toBe("k1");
  });
});

describe("imported endpoint", () => {
  it("previous_token is the current endpoint, with no subscription id or secret", async () => {
    const imported = endpoint("imported");
    const manager = new FakePushManager();
    manager.have(imported, OLD_KEY);
    const l = await load({ manager });
    const [body] = registrations(l);
    expect(body).toMatchObject({ previous_token: imported });
    expect(body).not.toHaveProperty("subscription_id");
    expect(body).not.toHaveProperty("device_secret");
  });
});

describe("token change", () => {
  it("registers with previous_token = old endpoint and the device secret from an earlier response, no opt_in", async () => {
    const first = await load();
    const secret = (await first.cfg())?.deviceSecret;
    expect(secret).toBe("secret-1-abcdefghijkl");
    const oldEndpoint = (await first.cfg())?.token;
    const fresh = endpoint("rotated");
    first.manager.have(fresh, ACTIVE_KEY);
    const next = await load({ from: first });
    const [body] = registrations(next);
    expect(body).toMatchObject({ previous_token: oldEndpoint, device_secret: secret });
    expect((body?.subscription as Body).endpoint).toBe(fresh);
    expect(body).not.toHaveProperty("opt_in");
  });
});

describe("another app on the same site", () => {
  it("warns once naming both apps, then subscribes for this app as a new row", async () => {
    const other = endpoint("other");
    const manager = new FakePushManager();
    manager.have(other, OLD_KEY);
    const l = await load({ manager, cfg: { app: "app-0", token: other, subscriptionId: "sub-0", deviceSecret: "other-secret-123" } });
    const warnings = l.fake.sink.warn.mock.calls.map((c) => String(c[0])).filter((w) => w.includes("other_app_subscription"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("app-0");
    expect(warnings[0]).toContain("app-1");
    const [body] = registrations(l);
    expect(body).not.toHaveProperty("previous_token");
    expect(body).not.toHaveProperty("device_secret");
    expect(body).not.toHaveProperty("subscription_id");
    expect((await l.cfg())?.subscriptionId).toBe("sub-1");
  });
});

describe("permission", () => {
  it("permission lost with a subscribed row: status 0 by token, and the observers fire", async () => {
    const ep = endpoint();
    const permissions: unknown[] = [];
    const changes: PushSubscriptionChange[] = [];
    const l = await load({
      permission: "denied",
      cfg: directRow(ep),
      state: { lastStatus: 1, lastPermission: "granted" },
      before: (api) => {
        api.Notifications.addPermissionObserver((c) => permissions.push(c));
        api.PushSubscription.addObserver((c) => changes.push(c));
      },
    });
    const [body] = registrations(l);
    expect(body).toMatchObject({ platform: "web", token: ep, status: 0 });
    expect(body).not.toHaveProperty("subscription");
    expect(body).not.toHaveProperty("opt_in");
    expect(permissions).toEqual([{ permission: false, status: "denied" }]);
    expect(last(changes)?.previous.status).toBe("subscribed");
    expect(last(changes)?.current.status).toBe("denied");
  });

  it("a dismissed browser prompt resolves false and registers nothing", async () => {
    const l = await load({ permission: "default", promptAnswer: "default" });
    await expect(l.api.Notifications.requestPermission()).resolves.toBe(false);
    await l.settle();
    expect(l.posts()).toHaveLength(0);
    expect(l.api.Notifications.canRequestPermission).toBe(true);
  });

  it("reports the raw permission and whether it can still be asked", async () => {
    const l = await load({ permission: "default" });
    expect(l.api.Notifications.permission).toBe(false);
    expect(l.api.Notifications.permissionStatus).toBe("default");
    expect(l.api.Notifications.canRequestPermission).toBe(true);
    expect(l.api.Notifications.isPushSupported()).toBe(true);
    expect(l.api.PushSubscription.status).toBe("not_asked");
    l.fake.permission.value = "denied";
    expect(l.api.Notifications.canRequestPermission).toBe(false);
    expect(l.api.PushSubscription.status).toBe("denied");
  });

  it("a change made in browser settings is found when the page becomes visible", async () => {
    const ep = endpoint();
    const manager = new FakePushManager();
    manager.have(ep, ACTIVE_KEY);
    const permissions: unknown[] = [];
    const l = await load({ manager, cfg: directRow(ep), state: { lastStatus: 1, lastPermission: "granted" } });
    l.api.Notifications.addPermissionObserver((c) => permissions.push(c));
    l.fake.permission.value = "denied";
    l.fake.becomeVisible();
    await l.settle();
    expect(permissions).toEqual([{ permission: false, status: "denied" }]);
    expect(last(registrations(l))).toMatchObject({ token: ep, status: 0 });
  });
});

describe("status model and observers", () => {
  it("fires on the id being assigned and the token; the snapshot matches", async () => {
    const changes: PushSubscriptionChange[] = [];
    const l = await load({ permission: "default", before: (api) => api.PushSubscription.addChangeObserver((c) => changes.push(c)) });
    await l.api.Notifications.requestPermission();
    await l.settle();
    const current = last(changes)?.current;
    expect(current).toMatchObject({ id: "sub-1", optedIn: true, status: "subscribed" });
    expect(current?.token).toBe(l.manager.current?.endpoint);
    expect(l.api.PushSubscription.snapshot()).toEqual(current);
    expect(changes.some((c) => c.current.status === "pending")).toBe(true);
  });

  it("removeObserver stops both observer kinds", async () => {
    const seen: unknown[] = [];
    const fn = (c: PushSubscriptionChange) => seen.push(c);
    const l = await load({ permission: "default" });
    l.api.PushSubscription.addObserver(fn);
    l.api.PushSubscription.removeObserver(fn);
    await l.api.Notifications.requestPermission();
    await l.settle();
    expect(seen).toHaveLength(0);
  });

  it("unsupported browsers say so and do not prompt", async () => {
    const l = await load({ pushApi: false });
    expect(l.api.PushSubscription.status).toBe("unsupported");
    expect(l.api.Notifications.isPushSupported()).toBe(false);
    expect(l.api.Notifications.canRequestPermission).toBe(false);
    await expect(l.api.Notifications.requestPermission()).rejects.toMatchObject({ code: "not_supported", detail: { reason: "no_push_api" } });
  });

  it("calls before initialize reject with not_initialized", async () => {
    const fake = fakePlatform();
    const { api } = createOpenPush({ platform: fake.platform });
    await expect(api.PushSubscription.optOut()).rejects.toMatchObject({ code: "not_initialized" });
    await expect(api.Notifications.requestPermission()).rejects.toMatchObject({ code: "not_initialized" });
    expect(api.PushSubscription.id).toBeNull();
  });
});

describe("private windows", () => {
  it("a subscribe() failure reports not_supported with private_mode, is not retried, and is not asked again", async () => {
    const manager = new FakePushManager();
    manager.failingKeys.add(ACTIVE_KEY);
    manager.failWith = Object.assign(new Error("Registration failed - push is not available in incognito"), { name: "AbortError" });
    const l = await load({ permission: "default", manager });
    await expect(l.api.Notifications.requestPermission()).rejects.toMatchObject({ code: "not_supported", detail: { reason: "private_mode" } });
    expect(manager.subscribe).toHaveBeenCalledTimes(1);
    expect(l.runtime.push.privateMode).toBe(true);
    expect(l.api.Notifications.isPushSupported()).toBe(false);
    expect(l.api.PushSubscription.status).toBe("unsupported");
    await expect(l.api.Notifications.requestPermission()).rejects.toMatchObject({ code: "not_supported" });
    expect(l.fake.requestPermission).toHaveBeenCalledTimes(1);
  });
});

describe("queue and responses", () => {
  it("sends a registration the worker queued but does not adopt its response", async () => {
    const l = await load({
      permission: "default",
      queue: [{ platform: "web", subscription: { endpoint: endpoint("worker"), keys: { p256dh: P256DH, auth: AUTH } } }],
    });
    expect(l.posts()).toHaveLength(1);
    const cfg = await l.cfg();
    expect(cfg?.deviceSecret).toBeUndefined();
    expect(cfg?.subscriptionId).toBeUndefined();
  });
});

describe("Notifications defaults and closing", () => {
  it("setDefaultUrl and setDefaultTitle reach cfg and the worker, also when set before initialize", async () => {
    const l = await load({ permission: "default", before: (api) => api.Notifications.setDefaultTitle("Hello") });
    l.api.Notifications.setDefaultUrl("https://play.example.com/home");
    await vi.waitFor(async () => expect((await l.cfg())?.defaultUrl).toBe("https://play.example.com/home"));
    const cfg = await l.cfg();
    expect(cfg?.defaultTitle).toBe("Hello");
    const post = l.runtime.context?.registration?.active?.postMessage as ReturnType<typeof vi.fn>;
    const msg = last(post.mock.calls)?.[0] as { type: string; payload: CfgRow };
    expect(msg).toMatchObject({ type: PAGE_TO_WORKER.config, payload: { defaultUrl: "https://play.example.com/home", defaultTitle: "Hello" } });
    expect(() => l.api.Notifications.setDefaultUrl(3 as never)).toThrow(expect.objectContaining({ code: "invalid_argument" }));
  });

  it("remove(tag) closes notifications with that tag or topic; clearAll closes all", async () => {
    const l = await load({ permission: "default" });
    const shown = [
      { tag: "t1", data: {}, close: vi.fn() },
      { tag: "m2", data: { topic: "t1" }, close: vi.fn() },
      { tag: "x", data: {}, close: vi.fn() },
    ];
    const reg = l.runtime.context?.registration;
    if (!reg) throw new Error("no registration");
    reg.getNotifications = vi.fn(async () => shown);
    await l.api.Notifications.remove("t1");
    expect(shown.map((s) => s.close.mock.calls.length)).toEqual([1, 1, 0]);
    await l.api.Notifications.clearAll();
    expect(shown.map((s) => s.close.mock.calls.length)).toEqual([2, 2, 1]);
  });
});

describe("logs", () => {
  it("never contain a full endpoint or the device secret", async () => {
    const old = endpoint("oldkey");
    const manager = new FakePushManager();
    manager.have(old, OLD_KEY);
    const lines: string[] = [];
    const l = await load({
      manager,
      logLevel: "trace",
      cfg: directRow(old, { subPublicKey: OLD_KEY, subKeyId: "k1", publicKey: OLD_KEY, keyId: "k1" }),
      before: (api) => api.Debug.addLogListener((e) => lines.push(e.message)),
    });
    await l.settle();
    const text = [...lines, ...l.fake.sink.debug.mock.calls.map((c) => String(c[0]))].join("\n");
    expect(lines.some((line) => line.includes("fcm.googleapis.com/…"))).toBe(true);
    expect(text).not.toContain(old);
    expect(text).not.toContain(String(manager.current?.endpoint));
    expect(text).not.toContain("secret-row-abcdef123");
    expect(text).not.toContain(P256DH);
  });
});
