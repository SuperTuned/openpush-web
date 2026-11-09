import { describe, expect, it, vi } from "vitest";
import { Logger } from "../src/log/logger";
import { Db, ROW, STORE } from "../src/storage/idb";
import type { ClickBehavior } from "../src/storage/types";
import { WORKER_TO_PAGE, type ClickPayload } from "../src/worker/channel";
import { clickBehavior, openTarget } from "../src/worker/click";
import { opensNothing, resolveUrl, routableUrl } from "../src/worker/urls";
import { installWorker, type StoredClick } from "../src/worker/worker";
import { SITE } from "./helpers/fake_platform";
import { BASE_CFG, FakeScope, FakeWindow, opPush, pushData, SAFARI_UA, seedCfg, shownNotification } from "./helpers/fake_worker";

const log = () => new Logger(undefined, () => 0, "none");
const TARGET = `${SITE}/sale`;

describe("click URL", () => {
  it("routes only https, http://localhost and /path", () => {
    expect(routableUrl("https://example.com/a", SITE)).toBe("https://example.com/a");
    expect(routableUrl("http://localhost:8080/x", SITE)).toBe("http://localhost:8080/x");
    expect(routableUrl("http://127.0.0.1/x", SITE)).toBe("http://127.0.0.1/x");
    expect(routableUrl("/path?q=1", SITE)).toBe(`${SITE}/path?q=1`);
    for (const bad of ["http://example.com/", "myapp://open", "javascript:alert(1)", "//evil.example/", "", "  ", 42]) {
      expect(routableUrl(bad, SITE)).toBeNull();
    }
  });

  it("falls through button url → deep link → default URL → site origin", () => {
    expect(resolveUrl(["/button", "/deep", "/default"], SITE)).toBe(`${SITE}/button`);
    expect(resolveUrl(["myapp://x", "/deep", "/default"], SITE)).toBe(`${SITE}/deep`);
    expect(resolveUrl([undefined, "", "/default"], SITE)).toBe(`${SITE}/default`);
    expect(resolveUrl([undefined, "tel:123"], SITE)).toBe(`${SITE}/`);
  });

  it("op_open=0 opens nothing", () => {
    expect(opensNothing(`${SITE}/vote?choice=a&op_open=0`)).toBe(true);
    expect(opensNothing(`${SITE}/vote?op_open=1`)).toBe(false);
    expect(opensNothing(`${SITE}/`)).toBe(false);
  });

  it("click behaviour defaults to exact + navigate", () => {
    expect(clickBehavior(undefined)).toEqual({ match: "exact", action: "navigate" });
    expect(clickBehavior({ match: "origin", action: "focus" })).toEqual({ match: "origin", action: "focus" });
  });
});

describe("click matching table", () => {
  function clients(windows: FakeWindow[]) {
    const scope = new FakeScope();
    scope.windows = windows;
    return scope;
  }

  async function click(behavior: ClickBehavior, windows: FakeWindow[], target = TARGET) {
    const scope = clients(windows);
    const result = await openTarget(scope.clients, target, behavior, SITE, log());
    return { scope, result };
  }

  it("exact + navigate: focuses and navigates the window showing the target, else opens one", async () => {
    const same = new FakeWindow("a", TARGET);
    const hit = await click({ match: "exact", action: "navigate" }, [new FakeWindow("b", `${SITE}/other`), same]);
    expect(hit.result).toBe("navigated");
    expect(same.focus).toHaveBeenCalled();
    expect(same.navigate).toHaveBeenCalledWith(TARGET);
    expect(hit.scope.clients.openWindow).not.toHaveBeenCalled();

    const miss = await click({ match: "exact", action: "navigate" }, [new FakeWindow("b", `${SITE}/sale/`)]);
    expect(miss.result).toBe("opened");
    expect(miss.scope.clients.openWindow).toHaveBeenCalledWith(TARGET);
  });

  it("origin + navigate: any window on the site is focused and navigated", async () => {
    const other = new FakeWindow("b", `${SITE}/other`);
    const { result, scope } = await click({ match: "origin", action: "navigate" }, [other]);
    expect(result).toBe("navigated");
    expect(other.focus).toHaveBeenCalled();
    expect(other.navigate).toHaveBeenCalledWith(TARGET);
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
  });

  it("exact + focus: the matching window is focused, not reloaded", async () => {
    const same = new FakeWindow("a", TARGET);
    const { result } = await click({ match: "exact", action: "focus" }, [same]);
    expect(result).toBe("focused");
    expect(same.focus).toHaveBeenCalled();
    expect(same.navigate).not.toHaveBeenCalled();
  });

  it("origin + focus: any window on the site is focused, not reloaded; none → new window", async () => {
    const other = new FakeWindow("b", `${SITE}/other`);
    const hit = await click({ match: "origin", action: "focus" }, [other]);
    expect(hit.result).toBe("focused");
    expect(other.navigate).not.toHaveBeenCalled();
    const miss = await click({ match: "origin", action: "focus" }, [new FakeWindow("x", "https://elsewhere.example/")]);
    expect(miss.result).toBe("opened");
  });

  it("prefers the focused window among several matches", async () => {
    const a = new FakeWindow("a", `${SITE}/a`);
    const b = new FakeWindow("b", `${SITE}/b`, true);
    await click({ match: "origin", action: "focus" }, [a, b]);
    expect(b.focus).toHaveBeenCalled();
    expect(a.focus).not.toHaveBeenCalled();
  });

  it("a cross-origin target always opens a new window", async () => {
    const other = new FakeWindow("b", `${SITE}/other`);
    const { result, scope } = await click({ match: "origin", action: "navigate" }, [other], "https://partner.example/offer");
    expect(result).toBe("opened");
    expect(other.navigate).not.toHaveBeenCalled();
    expect(scope.clients.openWindow).toHaveBeenCalledWith("https://partner.example/offer");
  });

  it("a window the worker does not control: exact stays focused, origin opens a new window", async () => {
    const exact = await click({ match: "exact", action: "navigate" }, [new FakeWindow("a", TARGET, false, false)]);
    expect(exact.result).toBe("focused");
    expect(exact.scope.clients.openWindow).not.toHaveBeenCalled();
    const origin = await click({ match: "origin", action: "navigate" }, [new FakeWindow("a", `${SITE}/x`, false, false)]);
    expect(origin.result).toBe("opened");
  });
});

describe("notificationclick", () => {
  async function shown(over: Record<string, unknown> = {}, cfgOver: Record<string, unknown> = {}, userAgent?: string) {
    const scope = new FakeScope();
    if (userAgent) scope.navigator = { userAgent };
    const db = await seedCfg(scope, { ...BASE_CFG, ...cfgOver });
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush(over)));
    scope.fetch.mockClear();
    const notification = shownNotification(scope.shown[0]!);
    return { scope, db, notification };
  }

  it("closes, posts clicked, opens the deep link, tells every window and keeps the click 60 s for the new page", async () => {
    const { scope, db, notification } = await shown({}, { webhooks: { displayed: null, clicked: "https://hooks.example.com/c", dismissed: null, cors: false } });
    const existing = new FakeWindow("w0", "https://elsewhere.example/");
    scope.windows = [existing];
    await scope.dispatch("notificationclick", { notification, action: "" });

    expect(notification.close).toHaveBeenCalled();
    expect(scope.requests("/v1/ingest")[0]?.body.events).toEqual([
      { type: "clicked", app: "app-1", message_id: "msg_1", token: BASE_CFG.token, subscription_id: "sub-1", action_id: "" },
    ]);
    expect(scope.clients.openWindow).toHaveBeenCalledWith(TARGET);
    const posted = existing.messages(WORKER_TO_PAGE.click)[0]?.payload as ClickPayload;
    expect(posted.result).toEqual({ actionId: "", url: TARGET });
    expect(posted.notification.id).toBe("msg_1");

    const stored = await db.get<StoredClick>(STORE.clicks, ROW.lastClick);
    expect(stored?.payload.clickId).toBe(posted.clickId);
    expect((await db.readCfg())?.lastPush).toMatchObject({ messageId: "msg_1", kind: "clicked" });

    const hook = scope.requests("hooks.example.com/c")[0];
    expect(hook?.body).toMatchObject({ event: "notification.clicked", message_id: "msg_1", url: TARGET, action_id: "" });
  });

  it("a button click goes to the button's link and reports its id", async () => {
    const { scope, notification } = await shown({ op_web_buttons: JSON.stringify([{ id: "shop", label: "Shop", url: "/shop" }]) });
    await scope.dispatch("notificationclick", { notification, action: "shop" });
    expect(scope.clients.openWindow).toHaveBeenCalledWith(`${SITE}/shop`);
    expect((scope.requests("/v1/ingest")[0]?.body.events as { action_id: string }[])[0]?.action_id).toBe("shop");
  });

  it("op_open=0 records the click and opens nothing", async () => {
    const { scope, db, notification } = await shown({ op_web_buttons: [{ id: "a", label: "A", url: "/vote?op_open=0" }] });
    const win = new FakeWindow("w1", `${SITE}/`);
    scope.windows = [win];
    await scope.dispatch("notificationclick", { notification, action: "a" });
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
    expect(win.focus).not.toHaveBeenCalled();
    expect(scope.requests("/v1/ingest")).toHaveLength(1);
    expect(win.messages(WORKER_TO_PAGE.click)).toHaveLength(1);
    expect(await db.get(STORE.clicks, ROW.lastClick)).toBeUndefined();
  });

  it("Safari always opens, even with op_open=0", async () => {
    const { scope, notification } = await shown({ op_web_buttons: [{ id: "a", label: "A", url: "/vote?op_open=0" }] }, {}, SAFARI_UA);
    await scope.dispatch("notificationclick", { notification, action: "a" });
    expect(scope.clients.openWindow).toHaveBeenCalledWith(`${SITE}/vote?op_open=0`);
  });

  it("does not keep the click when it only focused an open window", async () => {
    const { scope, db, notification } = await shown({}, { click: { match: "origin", action: "focus" } });
    scope.windows = [new FakeWindow("w1", `${SITE}/`)];
    await scope.dispatch("notificationclick", { notification, action: "" });
    expect(await db.get(STORE.clicks, ROW.lastClick)).toBeUndefined();
  });

  it("the site-name notification opens the site and sends nothing", async () => {
    const scope = new FakeScope("/openpush-sw.js");
    await seedCfg(scope);
    installWorker(scope);
    await scope.dispatch("push", pushData(undefined));
    scope.fetch.mockClear();
    await scope.dispatch("notificationclick", { notification: shownNotification(scope.shown[0]!), action: "" });
    expect(scope.clients.openWindow).toHaveBeenCalledWith(`${SITE}/`);
    expect(scope.fetch).not.toHaveBeenCalled();
  });

  it("leaves the site's own notifications alone", async () => {
    const scope = new FakeScope("/sw.js");
    installWorker(scope);
    const close = vi.fn();
    const event = await scope.dispatch("notificationclick", { notification: { title: "Site", data: { mine: true }, close }, action: "" });
    expect(close).not.toHaveBeenCalled();
    expect(scope.clients.openWindow).not.toHaveBeenCalled();
    void event;
  });
});

describe("notificationclose", () => {
  async function dismissed(userAgent?: string) {
    const scope = new FakeScope();
    if (userAgent) scope.navigator = { userAgent };
    await seedCfg(scope, { ...BASE_CFG, webhooks: { displayed: null, clicked: null, dismissed: "https://hooks.example.com/x", cors: false } });
    installWorker(scope);
    await scope.dispatch("push", pushData(opPush()));
    scope.fetch.mockClear();
    const win = new FakeWindow("w1", `${SITE}/`);
    scope.windows = [win];
    await scope.dispatch("notificationclose", { notification: shownNotification(scope.shown[0]!) });
    return { scope, win };
  }

  it("posts dismissed, tells every window and fires the dismissed webhook", async () => {
    const { scope, win } = await dismissed();
    expect((scope.requests("/v1/ingest")[0]?.body.events as { type: string }[])[0]?.type).toBe("dismissed");
    expect(win.messages(WORKER_TO_PAGE.dismiss)).toHaveLength(1);
    expect(scope.requests("hooks.example.com/x")[0]?.body).toMatchObject({ event: "notification.dismissed", message_id: "msg_1" });
    expect(scope.requests("hooks.example.com/x")[0]?.body).not.toHaveProperty("action_id");
  });

  it("Safari has no dismissed webhook", async () => {
    const { scope } = await dismissed(SAFARI_UA);
    expect(scope.requests("hooks.example.com")).toHaveLength(0);
  });

  it("stores nothing for the page; dismiss keeps no click", async () => {
    const { scope } = await dismissed();
    const db = new Db(scope.indexedDB, () => true);
    expect(await db.get(STORE.clicks, ROW.lastClick)).toBeUndefined();
  });
});
