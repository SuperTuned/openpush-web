/** The v1 public API on v2 and the `openpush:initialized` event. */
import { describe, expect, it, vi } from "vitest";
import { INITIALIZED_EVENT } from "../src/core/sdk";
import type { OpenPushNotification } from "../src/notification";
import { bootstrapBody, jsonResponse } from "./helpers/fake_platform";
import { ROW_ID, start } from "./helpers/sdk_harness";

const notification: OpenPushNotification = {
  id: "msg-1",
  title: "Hi",
  body: "There",
  icon: null,
  image: null,
  badge: null,
  url: "https://play.example.com/shop",
  buttons: [],
  topic: null,
  data: {},
  receivedAt: 1,
};

describe("v1 aliases", () => {
  it("init initializes and resolves with {needsLinkCode, permission}", async () => {
    const s = await start({ init: false });
    await expect(s.api.init({ appId: "app-1" })).resolves.toEqual({ needsLinkCode: false, permission: "granted" });
    await expect(s.api.init({ appId: "app-1" })).resolves.toEqual({ needsLinkCode: false, permission: "granted" });
  });

  it("init reads needs_link_code from the config", async () => {
    const s = await start({ init: false });
    s.fake.fetch.mockImplementation(async (url: string) =>
      url.includes("/webpush-config") ? jsonResponse(bootstrapBody({ needs_link_code: true })) : jsonResponse({}, 404),
    );
    await expect(s.api.init({ appId: "app-1" })).resolves.toMatchObject({ needsLinkCode: true });
  });

  it("init rejects as initialize does", async () => {
    const s = await start({ init: false });
    await expect(s.api.init({ appId: "" })).rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("requestPermission resolves with {permission, subscriptionId} once the server gave an id", async () => {
    // Real timers: the wait for the id must not end at once.
    const s = await start({ subscribed: false, instantTimers: false });
    await expect(s.api.requestPermission()).resolves.toEqual({ permission: "granted", subscriptionId: ROW_ID });
  });

  it("requestPermission when the person blocks: {permission: denied, subscriptionId: \"\"}", async () => {
    const s = await start({ subscribed: false });
    s.fake.permission.promptAnswer = "denied";
    await expect(s.api.requestPermission()).resolves.toEqual({ permission: "denied", subscriptionId: "" });
  });

  it("getSubscriptionId is PushSubscription.id, or \"\"", async () => {
    const s = await start();
    await expect(s.api.getSubscriptionId()).resolves.toBe(ROW_ID);
    const t = await start({ subscribed: false });
    await expect(t.api.getSubscriptionId()).resolves.toBe("");
  });

  it("onClick gets the v1 payload {op, message_id, action_id, url}", async () => {
    const s = await start();
    const fn = vi.fn();
    s.api.onClick(fn);
    s.runtime.notificationEvents.emitClick({ notification, result: { actionId: "buy", url: "https://play.example.com/buy" } });
    expect(fn).toHaveBeenCalledWith({ op: "openpush:click", message_id: "msg-1", action_id: "buy", url: "https://play.example.com/buy" });
  });

  it("onBackground is kept, never fires, and logs once", async () => {
    const s = await start();
    s.runtime.log.setLevel("info");
    s.fake.sink.info.mockClear();
    const fn = vi.fn();
    s.api.onBackground(fn);
    s.api.onBackground(fn);
    expect(fn).not.toHaveBeenCalled();
    expect(s.fake.sink.info.mock.calls.filter((c) => String(c[0]).includes("onBackground"))).toHaveLength(1);
  });

  it("v1 permission is \"unsupported\" without a Notification API", async () => {
    const s = await start({ init: false, subscribed: false });
    s.fake.platform.notificationPermission = () => undefined;
    await expect(s.api.init({ appId: "app-1" })).resolves.toMatchObject({ permission: "unsupported" });
  });
});

describe("openpush:initialized", () => {
  it("fires once per page with {version, subscriptionId}, even when initialize is called again", async () => {
    const s = await start({ dataLayer: [] });
    await s.api.initialize({ appId: "app-1" });
    const events = s.fake.window.dispatchEvent.mock.calls.map((c) => c[0] as unknown as { type: string; detail: unknown });
    const fired = events.filter((e) => e.type === INITIALIZED_EVENT);
    expect(fired).toHaveLength(1);
    expect(fired[0]?.detail).toEqual({ version: s.api.version, subscriptionId: ROW_ID });
    expect(s.fake.window.dataLayer).toEqual([{ event: "openpush.initialized" }]);
  });

  it("pushes to the data layer only when the page has one", async () => {
    const s = await start();
    expect(s.fake.window.dataLayer).toBeUndefined();
  });
});
