/**
 * The user on this browser: login and logout, identity verification, user
 * observers, tags, aliases and language riding the next registration, and consent.
 */
import { describe, expect, it, vi } from "vitest";
import { mergeBodies } from "../src/net/queue";
import type { UserChange } from "../src/user/user";
import { LOCAL_KEY } from "../src/storage/local";
import { jsonResponse } from "./helpers/fake_platform";
import { ROW_ID, start, type Request } from "./helpers/sdk_harness";

const last = <T>(list: T[]): T | undefined => list[list.length - 1];

/** The error code a call throws, if any. */
function thrown(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as { code?: string }).code ?? "no code";
  }
  return undefined;
}

/** The server of an app with identity verification on: no valid hash, the identity is refused. */
function verifyingServer(valid = "good-hash") {
  return (req: Request): Response | undefined => {
    if (!req.path.endsWith("/subscriptions") || req.body.platform !== "web") return undefined;
    const claims = req.body.external_id || req.body.tags || req.body.aliases;
    if (claims && req.body.external_id_auth_hash !== valid) {
      return jsonResponse({ id: ROW_ID, app: "app-1", status: 1, identity_rejected: "identity_verification is ON for this app" });
    }
    return undefined;
  };
}

describe("login", () => {
  it("sets external_id and the hash on this browser's registration and resolves once accepted", async () => {
    const s = await start();
    s.reset();
    await s.api.login("player-1", "hash-abc");
    const body = last(s.registrations());
    expect(body).toMatchObject({ platform: "web", external_id: "player-1", external_id_auth_hash: "hash-abc", device_secret: "secret-row-abcdef123" });
    expect(s.api.User.externalId).toBe("player-1");
    const state = await s.state();
    expect(state?.externalId).toBe("player-1");
    expect(JSON.stringify(state)).not.toContain("hash-abc");
  });

  it("logging in again as the same user without a hash sends nothing", async () => {
    const s = await start();
    await s.api.login("player-1");
    s.reset();
    await s.api.login("player-1");
    expect(s.registrations()).toHaveLength(0);
  });

  it("logging in as someone else clears this browser's tags and aliases first", async () => {
    const s = await start();
    await s.api.login("a");
    s.api.User.addTag("level", "3");
    s.api.User.addAlias("crm", "c-1");
    await s.settle();
    s.reset();
    await s.api.login("b");
    const body = last(s.registrations());
    expect(body?.external_id).toBe("b");
    expect(body).not.toHaveProperty("tags");
    expect(body).not.toHaveProperty("aliases");
    expect(s.api.User.getTags()).toEqual({});
  });

  it("without a row, the identity is kept and rides the first registration", async () => {
    const s = await start({ subscribed: false });
    await s.api.login("player-2");
    expect(s.registrations()).toHaveLength(0);
    expect(s.api.User.externalId).toBe("player-2");
    await s.api.Notifications.requestPermission();
    await s.settle();
    expect(last(s.registrations())).toMatchObject({ external_id: "player-2" });
  });

  it("rejects an empty external ID with invalid_argument", async () => {
    const s = await start();
    await expect(s.api.login("")).rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("before initialize rejects with not_initialized", async () => {
    const s = await start({ init: false });
    await expect(s.api.login("x")).rejects.toMatchObject({ code: "not_initialized" });
  });
});

describe("logout", () => {
  it("sends external_id \"\" and clears the identity, tags and aliases", async () => {
    const s = await start();
    await s.api.login("player-1");
    s.api.User.addTags({ level: 3, vip: true });
    s.api.User.addAlias("crm", "c-1");
    await s.settle();
    s.reset();
    await s.api.logout();
    const body = last(s.registrations());
    expect(body?.external_id).toBe("");
    expect(body).not.toHaveProperty("tags");
    expect(body).not.toHaveProperty("aliases");
    expect(s.api.User.externalId).toBeNull();
    expect(s.api.User.getTags()).toEqual({});
    const state = await s.state();
    expect(state?.externalId).toBeNull();
    expect(state?.tags).toEqual({});
  });

  it("on a browser that was never identified, sends nothing but still clears tags", async () => {
    const s = await start();
    s.api.User.addTag("a", "1");
    await s.settle();
    s.reset();
    await s.api.logout();
    expect(s.registrations()).toHaveLength(0);
    expect(s.api.User.getTags()).toEqual({});
  });

  it("a second logout whose detach was delivered sends nothing", async () => {
    const s = await start();
    await s.api.login("p");
    await s.api.logout();
    s.reset();
    await s.api.logout();
    expect(s.registrations()).toHaveLength(0);
  });
});

describe("identity verification (identity_rejected)", () => {
  it("without a handler: login rejects with identity_rejected and the browser stays anonymous", async () => {
    const s = await start({ respond: verifyingServer() });
    await expect(s.api.login("player-1")).rejects.toMatchObject({ code: "identity_rejected" });
    expect(s.api.User.externalId).toBeNull();
    s.reset();
    s.api.User.addTag("a", "1");
    await s.settle();
    // Not "" either: an empty external_id would detach the row the server kept.
    for (const body of s.registrations()) expect(body).not.toHaveProperty("external_id");
    expect((await s.state())?.ivRequired).toBe(true);
  });

  it("with a handler: asks it for the hash, registers again with it, and login resolves", async () => {
    const s = await start({ respond: verifyingServer() });
    const handler = vi.fn(async () => "good-hash");
    s.api.onIdentityVerificationRequired(handler);
    await s.api.login("player-1");
    expect(handler).toHaveBeenCalledWith("player-1");
    expect(last(s.registrations())).toMatchObject({ external_id: "player-1", external_id_auth_hash: "good-hash" });
    expect(s.api.User.externalId).toBe("player-1");
  });

  it("a handler answering null keeps the browser anonymous and login rejects", async () => {
    const s = await start({ respond: verifyingServer() });
    s.api.onIdentityVerificationRequired(() => null);
    await expect(s.api.login("player-1")).rejects.toMatchObject({ code: "identity_rejected" });
    expect(s.api.User.externalId).toBeNull();
  });

  it("once the app is known to verify, a login without a hash asks the handler before sending", async () => {
    const s = await start({ respond: verifyingServer(), state: { ivRequired: true } });
    s.api.onIdentityVerificationRequired(async () => "good-hash");
    s.reset();
    await s.api.login("player-1");
    expect(s.registrations().every((b) => b.external_id_auth_hash === "good-hash")).toBe(true);
  });

  it("a verified identity restored without its hash is left out until the handler gives one", async () => {
    const s = await start({ state: { externalId: "player-1", verified: true, tags: { level: "3" } } });
    for (const body of s.registrations()) {
      expect(body).not.toHaveProperty("external_id");
      expect(body).not.toHaveProperty("tags");
    }
    s.reset();
    s.api.onIdentityVerificationRequired(async (id) => (id === "player-1" ? "good-hash" : null));
    await s.settle();
    expect(last(s.registrations())).toMatchObject({ external_id: "player-1", external_id_auth_hash: "good-hash", tags: { level: "3" } });
  });
});

describe("User observers", () => {
  it("fire on login and logout with previous and current", async () => {
    const s = await start();
    const seen: UserChange[] = [];
    s.api.User.addObserver((change) => seen.push(change));
    await s.api.login("p");
    await s.api.logout();
    expect(seen).toEqual([
      { previous: { externalId: null, subscriptionId: ROW_ID }, current: { externalId: "p", subscriptionId: ROW_ID } },
      { previous: { externalId: "p", subscriptionId: ROW_ID }, current: { externalId: null, subscriptionId: ROW_ID } },
    ]);
  });

  it("fire when the subscription id is assigned", async () => {
    const s = await start({ subscribed: false });
    const seen: UserChange[] = [];
    s.api.User.addObserver((change) => seen.push(change));
    await s.api.Notifications.requestPermission();
    await s.settle();
    expect(seen).toContainEqual({ previous: { externalId: null, subscriptionId: null }, current: { externalId: null, subscriptionId: ROW_ID } });
  });

  it("removeObserver stops them; a throwing observer is logged", async () => {
    const s = await start();
    const fn = vi.fn();
    s.api.User.addObserver(() => {
      throw new Error("site bug");
    });
    s.api.User.addObserver(fn);
    s.api.User.removeObserver(fn);
    await s.api.login("p");
    expect(fn).not.toHaveBeenCalled();
    expect(s.fake.sink.error.mock.calls.some((c) => String(c[0]).includes("site bug"))).toBe(true);
  });

  it("User.pushSubscription is OpenPush.PushSubscription", async () => {
    const s = await start();
    expect(s.api.User.pushSubscription).toBe(s.api.PushSubscription);
  });
});

describe("tags", () => {
  it("ride the next registration; several changes in the window go out together", async () => {
    const s = await start();
    s.reset();
    s.api.User.addTag("level", 3);
    s.api.User.addTags({ vip: true, team: "red" });
    await s.settle();
    expect(s.registrations()).toHaveLength(1);
    expect(s.registrations()[0]?.tags).toEqual({ level: "3", vip: "true", team: "red" });
    expect(s.api.User.getTags()).toEqual({ level: "3", vip: "true", team: "red" });
  });

  it("removeTag sends an empty value, getTags hides it, and it is dropped once accepted", async () => {
    const s = await start();
    s.api.User.addTags({ a: "1", b: "2" });
    await s.settle();
    s.reset();
    s.api.User.removeTag("a");
    expect(s.api.User.getTags()).toEqual({ b: "2" });
    await s.settle();
    expect(last(s.registrations())?.tags).toEqual({ a: "", b: "2" });
    expect((await s.state())?.tags).toEqual({ b: "2" });
  });

  it("keys and values follow the server rules (invalid_argument)", async () => {
    const s = await start();
    const bad = [
      () => s.api.User.addTag("", "x"),
      () => s.api.User.addTag("has space", "x"),
      () => s.api.User.addTag("k".repeat(61), "x"),
      () => s.api.User.addTag("ok", "v".repeat(301)),
      () => s.api.User.addTag("ok", { nested: true } as unknown as string),
      () => s.api.User.addTags(null as unknown as Record<string, string>),
      () => s.api.User.removeTag("no/slash"),
    ];
    for (const call of bad) expect(thrown(call)).toBe("invalid_argument");
    expect(thrown(() => s.api.User.addTags({ "a_b-c.d": "v".repeat(300), ["k".repeat(60)]: 1 }))).toBeUndefined();
  });

  it("a bad key in addTags changes nothing", async () => {
    const s = await start();
    expect(thrown(() => s.api.User.addTags({ good: "1", "bad key": "2" }))).toBe("invalid_argument");
    expect(s.api.User.getTags()).toEqual({});
  });

  it("tags set before initialize ride the first registration", async () => {
    const s = await start({ before: (api) => api.User.addTag("source", "ad") });
    expect(s.registrations()[0]?.tags).toEqual({ source: "ad" });
  });

  it("getTags refreshes from the tags a registration answer carries", async () => {
    // The server sends the user's tags only to a browser that proved its row with the device secret.
    const serverTags: Record<string, unknown> = { level: "9", from_api: "yes", score: 12, gone: "" };
    const s = await start({
      respond: (req) => {
        if (!req.path.endsWith("/subscriptions") || !req.body.device_secret) return undefined;
        return jsonResponse({ id: ROW_ID, app: "app-1", status: 1, tags: serverTags });
      },
    });
    s.api.User.addTag("level", "9");
    await s.settle();
    expect(s.api.User.getTags()).toEqual({ level: "9", from_api: "yes", score: "12" });
    expect((await s.state())?.tags).toEqual({ level: "9", from_api: "yes", score: "12" });
    // In sync with the server: nothing more is sent.
    s.reset();
    await s.settle();
    expect(s.registrations()).toHaveLength(0);
  });

  it("a tag changed while the registration was out is not overwritten by the answer's tags", async () => {
    let release: () => void = () => undefined;
    const held = new Promise<void>((resolve) => (release = resolve));
    let first = true;
    const s = await start({
      respond: async (req) => {
        if (!req.path.endsWith("/subscriptions") || !req.body.tags) return undefined;
        if (first) {
          first = false;
          await held;
        }
        return jsonResponse({ id: ROW_ID, app: "app-1", status: 1, tags: { ...(req.body.tags as Record<string, string>) } });
      },
    });
    s.api.User.addTag("a", "1");
    const sending = s.settle();
    await vi.waitFor(() => expect(s.registrations()).toHaveLength(1));
    s.api.User.addTag("b", "2");
    release();
    await sending;
    await s.settle();
    expect(s.api.User.getTags()).toEqual({ a: "1", b: "2" });
    expect(last(s.registrations())?.tags).toEqual({ a: "1", b: "2" });
  });

  it("are kept for the next page load", async () => {
    const s = await start();
    s.api.User.addTag("a", "1");
    await s.settle();
    expect((await s.state())?.tags).toEqual({ a: "1" });
  });
});

describe("queue merge of user fields", () => {
  it("tags and aliases merge within one identity", () => {
    expect(mergeBodies({ external_id: "a", tags: { x: "1" }, aliases: { crm: "1" } }, { external_id: "a", tags: { y: "2" } })).toEqual({
      external_id: "a",
      tags: { x: "1", y: "2" },
      aliases: { crm: "1" },
    });
  });

  it("after a logout or a login as someone else, the earlier user's maps and hash are not carried", () => {
    expect(mergeBodies({ external_id: "a", external_id_auth_hash: "h", tags: { x: "1" }, aliases: { crm: "1" } }, { external_id: "" })).toEqual({
      external_id: "",
    });
    expect(mergeBodies({ external_id: "a", tags: { x: "1" } }, { external_id: "b", tags: { y: "2" } })).toEqual({ external_id: "b", tags: { y: "2" } });
  });
});

describe("aliases", () => {
  it("ride the next registration; removeAlias sends an empty id", async () => {
    const s = await start();
    s.api.User.addAliases({ crm: "c-1", steam: "765" });
    await s.settle();
    s.reset();
    s.api.User.removeAlias("steam");
    await s.settle();
    expect(last(s.registrations())?.aliases).toEqual({ crm: "c-1", steam: "" });
  });

  it("external_id is not an alias label; empty labels and ids are refused", async () => {
    const s = await start();
    expect(thrown(() => s.api.User.addAlias("external_id", "x"))).toBe("invalid_argument");
    expect(thrown(() => s.api.User.addAlias("", "x"))).toBe("invalid_argument");
    expect(thrown(() => s.api.User.addAlias("crm", ""))).toBe("invalid_argument");
  });
});

describe("language", () => {
  it("getLanguage is the browser's until setLanguage overrides it on the row", async () => {
    const s = await start();
    expect(s.api.User.getLanguage()).toBe("en-GB");
    s.reset();
    s.api.User.setLanguage("fr-CA");
    await s.settle();
    expect(s.api.User.getLanguage()).toBe("fr-CA");
    expect(last(s.registrations())).toMatchObject({ language: "fr", country: "CA" });
    expect((await s.state())?.language).toBe("fr-CA");
  });

  it("rejects what is not a language code", async () => {
    const s = await start();
    expect(thrown(() => s.api.User.setLanguage("french!"))).toBe("invalid_argument");
  });
});

describe("consent gating", () => {
  it("before consent: user calls change nothing outside memory, and no request is made", async () => {
    const s = await start({
      init: false,
      before: (api) => api.setConsentRequired(true),
    });
    // The harness itself stored the browser's row; only the SDK's own access counts here.
    s.fake.openSpy.mockClear();
    s.fake.storage.setItem.mockClear();
    const initializing = s.api.initialize({ appId: "app-1" });
    s.api.User.addTag("a", "1");
    s.api.trackEvent("opened");
    await new Promise((r) => setTimeout(r, 20));
    expect(s.fake.fetch).not.toHaveBeenCalled();
    expect(s.fake.storage.setItem).not.toHaveBeenCalled();
    expect(s.fake.openSpy).not.toHaveBeenCalled();
    s.api.setConsentGiven(true);
    await initializing;
    await s.settle();
    expect(s.registrations()[0]?.tags).toEqual({ a: "1" });
    // The event tracked before consent was not kept.
    expect(s.sent("/events")).toHaveLength(0);
  });

  it("after consent is withdrawn, sessions are not written", async () => {
    const s = await start({ before: (api) => api.setConsentRequired(true), init: false });
    s.api.setConsentGiven(true);
    await s.api.initialize({ appId: "app-1" });
    await s.settle();
    s.api.setConsentGiven(false);
    s.fake.storage.setItem.mockClear();
    s.fake.becomeVisible();
    expect(s.fake.storage.setItem.mock.calls.some((c) => c[0] === LOCAL_KEY.session)).toBe(false);
  });
});
