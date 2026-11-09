/**
 * Compatibility layer: the call-shape fixture, events and their payloads, the
 * user id getter, init and the removed methods. The OpenPush side is a fake object of spies.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createCompat, runLegacy, type CompatSdk } from "../../src/compat/facade";
import { toCompatNotification } from "../../src/compat/notification";
import { REMOVED_METHODS } from "../../src/compat/removed";
import { CALL_SHAPES } from "./call_shapes";
import { fakeApi, notification, testLog, type FakeApi } from "./fake_api";

let fake: FakeApi;
let logs: ReturnType<typeof testLog>;
let sdk: CompatSdk;
let marked: ReturnType<typeof vi.fn<() => void>>;

beforeEach(() => {
  fake = fakeApi();
  logs = testLog();
  marked = vi.fn<() => void>();
  sdk = createCompat({ api: fake.api, log: logs.log, onPermissionPrompt: fake.onPermissionPrompt, markLinkContainers: marked });
});

const warnings = (): string[] => logs.lines.filter((l) => l.level === "warn").map((l) => l.message);

describe("call shapes", () => {
  for (const row of CALL_SHAPES) {
    it(row.ref, async () => {
      Object.assign(fake.state, {
        externalId: "user-7",
        id: "sub-1",
        token: "https://fcm.googleapis.com/fcm/send/x",
        optedIn: true,
        permission: true,
        permissionStatus: "granted",
      });
      const result = await row.call(sdk);
      row.check(fake, result);
    });
  }

  it("covers every member of the compat object's call surface", () => {
    const listed = new Set(CALL_SHAPES.map((r) => r.ref.split("(")[0]));
    for (const name of ["login", "logout", "setConsentRequired", "setConsentGiven"]) expect(listed.has(name)).toBe(true);
    for (const name of Object.keys(sdk.User).filter((k) => !["PushSubscription", "addEventListener", "removeEventListener", "onesignalId"].includes(k))) {
      expect(listed.has(`User.${name}`)).toBe(true);
    }
  });
});

describe("the user id getter", () => {
  it("is always null and warns once per page naming the OpenPush replacements", () => {
    fake.state.id = "sub-1";
    fake.state.externalId = "user-7";
    expect(sdk.User.onesignalId).toBeNull();
    expect(sdk.User.onesignalId).toBeNull();
    const lines = warnings().filter((m) => m.includes("onesignalId"));
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("OpenPush.User.externalId");
    expect(lines[0]).toContain("OpenPush.PushSubscription.id");
  });

  it("the User change event carries null in that field", () => {
    const seen: unknown[] = [];
    const listener = (change: unknown): void => void seen.push(change);
    sdk.User.addEventListener("change", listener);
    fake.fire("user", { previous: { externalId: null, subscriptionId: "sub-1" }, current: { externalId: "user-7", subscriptionId: "sub-1" } });
    expect(seen).toEqual([{ current: { onesignalId: null, externalId: "user-7" } }]);
    sdk.User.removeEventListener("change", listener);
    expect(fake.sets.user?.size).toBe(0);
  });
});

describe("events", () => {
  it("User.PushSubscription change: {previous, current} with id, token and optedIn", () => {
    const seen: unknown[] = [];
    const listener = (change: unknown): void => void seen.push(change);
    sdk.User.PushSubscription.addEventListener("change", listener);
    fake.fire("push", {
      previous: { id: null, token: null, optedIn: false, status: "not_asked" },
      current: { id: "sub-1", token: "t", optedIn: true, status: "subscribed" },
    });
    expect(seen).toEqual([{ previous: { id: null, token: null, optedIn: false }, current: { id: "sub-1", token: "t", optedIn: true } }]);
    sdk.User.PushSubscription.removeEventListener("change", listener);
    expect(fake.sets.push?.size).toBe(0);
  });

  it("click: {notification, result: {actionId, url}} with the reference's notification fields", () => {
    const seen: unknown[] = [];
    sdk.Notifications.addEventListener("click", (e: unknown) => void seen.push(e));
    fake.fire("click", { notification: notification(), result: { actionId: "shop", url: "https://play.example.com/shop" } });
    expect(seen).toEqual([{ notification: toCompatNotification(notification()), result: { actionId: "shop", url: "https://play.example.com/shop" } }]);
  });

  it("foregroundWillDisplay: preventDefault() and display() reach OpenPush", () => {
    const preventDefault = vi.fn();
    const display = vi.fn();
    sdk.Notifications.addEventListener("foregroundWillDisplay", (e: { preventDefault(): void; notification: { display?: () => void } }) => {
      e.preventDefault();
      e.notification.display?.();
    });
    fake.fire("foreground", { notification: notification(), preventDefault, display });
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(display).toHaveBeenCalledTimes(1);
  });

  it("dismiss: {notification}", () => {
    const seen: unknown[] = [];
    sdk.Notifications.addEventListener("dismiss", (e: unknown) => void seen.push(e));
    fake.fire("dismiss", { notification: notification() });
    expect(seen).toEqual([{ notification: toCompatNotification(notification()) }]);
  });

  it("permissionChange passes a boolean", () => {
    const seen: unknown[] = [];
    sdk.Notifications.addEventListener("permissionChange", (p: unknown) => void seen.push(p));
    fake.fire("permission", { permission: true, status: "granted" });
    fake.fire("permission", { permission: false, status: "denied" });
    expect(seen).toEqual([true, false]);
  });

  it("permissionPromptDisplay fires just before the browser prompt", () => {
    const listener = vi.fn();
    sdk.Notifications.addEventListener("permissionPromptDisplay", listener);
    fake.fire("permissionPrompt");
    expect(listener).toHaveBeenCalledTimes(1);
    sdk.Notifications.removeEventListener("permissionPromptDisplay", listener);
    fake.fire("permissionPrompt");
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("removeEventListener removes the OpenPush listener it added; adding twice adds once", () => {
    const listener = vi.fn();
    sdk.Notifications.addEventListener("click", listener);
    sdk.Notifications.addEventListener("click", listener);
    expect(fake.sets.click?.size).toBe(1);
    sdk.Notifications.removeEventListener("click", listener);
    expect(fake.sets.click?.size).toBe(0);
  });

  it("Slidedown slidedownShown → Prompts 'shown' for the slide-in and the email or phone prompt only", () => {
    const listener = vi.fn();
    sdk.Slidedown.addEventListener("slidedownShown", listener);
    fake.fire("prompt:shown", { type: "slide_in", promptId: "slide_in" });
    fake.fire("prompt:shown", { type: "email_phone", promptId: "email_phone" });
    fake.fire("prompt:shown", { type: "bell", promptId: "bell" });
    expect(listener).toHaveBeenCalledTimes(2);
    sdk.Slidedown.removeEventListener("slidedownShown", listener);
    expect(fake.sets["prompt:shown"]?.size).toBe(0);
  });

  it("an unknown event name warns once and adds nothing", () => {
    sdk.Notifications.addEventListener("subscriptionChange" as never, vi.fn());
    sdk.Notifications.addEventListener("subscriptionChange" as never, vi.fn());
    expect(warnings().filter((m) => m.includes("subscriptionChange"))).toHaveLength(1);
  });
});

describe("notification object for compat listeners", () => {
  it("uses the reference's field names", () => {
    expect(toCompatNotification(notification())).toEqual({
      notificationId: "msg_1",
      title: "Spring sale",
      body: "Everything 20% off",
      icon: "https://cdn.example.com/icon.png",
      image: "https://cdn.example.com/large.png",
      launchURL: "https://play.example.com/sale",
      additionalData: { campaign: "spring" },
      actionButtons: [
        { actionId: "shop", text: "Shop now", icon: "https://cdn.example.com/cart.png", launchURL: "https://play.example.com/shop" },
        { actionId: "b2", text: "Later", launchURL: "https://play.example.com/later" },
      ],
    });
  });

  it("leaves out icon and image when the push has none", () => {
    const n = toCompatNotification(notification({ icon: null, image: null, buttons: [] }));
    expect(n).not.toHaveProperty("icon");
    expect(n).not.toHaveProperty("image");
    expect(n.actionButtons).toEqual([]);
  });
});

describe("init", () => {
  it("maps the options and calls OpenPush.initialize", async () => {
    await sdk.init({ appId: "app-1", requiresUserPrivacyConsent: true, serviceWorkerPath: "push/worker.js" });
    expect(fake.api.initialize).toHaveBeenCalledWith(
      expect.objectContaining({ appId: "app-1", requiresConsent: true, serviceWorkerPath: "/push/worker.js" }),
    );
  });

  it("a second call warns in OpenPush words and does nothing", async () => {
    await sdk.init({ appId: "app-1" });
    await sdk.init({ appId: "app-1" });
    expect(fake.api.initialize).toHaveBeenCalledTimes(1);
    expect(warnings().some((m) => m.includes("already initialized"))).toBe(true);
  });

  it("logs unknown options once at warn, and safari_web_id once at info", async () => {
    await sdk.init({ appId: "app-1", safari_web_id: "web.x", subdomainName: "x", somethingElse: 1 });
    expect(warnings().filter((m) => m.includes("subdomainName") && m.includes("somethingElse"))).toHaveLength(1);
    expect(logs.lines.filter((l) => l.level === "info" && l.message.includes("safari_web_id"))).toHaveLength(1);
  });

  it("logs once that the email or phone prompt uses the default consent line", async () => {
    await sdk.init({ appId: "app-1", promptOptions: { slidedown: { prompts: [{ type: "email" }] } } });
    expect(warnings().filter((m) => m.includes("consent"))).toHaveLength(1);
  });

  it("evaluates notifyButton.displayPredicate once; false hides the bell", async () => {
    const predicate = vi.fn(async () => false);
    await sdk.init({ appId: "app-1", notifyButton: { enable: true, displayPredicate: predicate } });
    expect(predicate).toHaveBeenCalledTimes(1);
    const options = vi.mocked(fake.api.initialize).mock.calls[0]?.[0] as { prompts?: Array<{ type: string }> };
    expect((options.prompts ?? []).some((p) => p.type === "bell")).toBe(false);
  });

  it("keeps the bell when displayPredicate returns true or throws", async () => {
    await sdk.init({ appId: "app-1", notifyButton: { enable: true, displayPredicate: () => { throw new Error("x"); } } });
    const options = vi.mocked(fake.api.initialize).mock.calls[0]?.[0] as { prompts?: Array<{ type: string }> };
    expect(options.prompts?.some((p) => p.type === "bell")).toBe(true);
  });

  it("marks the reference's placed-link containers when customlink is on", async () => {
    await sdk.init({ appId: "app-1", promptOptions: { customlink: { enabled: true } } });
    expect(marked).toHaveBeenCalledTimes(1);
  });
});

describe("removed methods", () => {
  for (const [name, replacement] of Object.entries(REMOVED_METHODS)) {
    it(`${name}() warns once naming ${replacement} and does nothing`, async () => {
      const fn = sdk[name] as () => Promise<void>;
      await expect(fn()).resolves.toBeUndefined();
      await fn();
      const lines = warnings().filter((m) => m.startsWith(`${name}()`));
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain(replacement);
    });
  }

  it("the removed methods call nothing on OpenPush", async () => {
    await (sdk.sendTag as (k: string, v: string) => Promise<void>)("a", "1");
    await (sdk.setExternalUserId as (id: string) => Promise<void>)("user-7");
    expect(fake.api.User.addTag).not.toHaveBeenCalled();
    expect(fake.api.login).not.toHaveBeenCalled();
  });
});

describe("the previous array queue's items", () => {
  it("runs a function with the compat object, and [name, ...args] as a call", () => {
    const fn = vi.fn();
    runLegacy(sdk, fn, logs.log);
    expect(fn).toHaveBeenCalledWith(sdk);
    runLegacy(sdk, ["login", "user-7"], logs.log);
    expect(fake.api.login).toHaveBeenCalledWith("user-7");
  });

  it("warns for an unknown method name or a non-function", () => {
    runLegacy(sdk, ["noSuchMethod"], logs.log);
    runLegacy(sdk, 42, logs.log);
    expect(warnings()).toHaveLength(2);
  });
});
