import { afterEach, describe, expect, it, vi } from "vitest";
import { FOREGROUND_ANSWER_MS, NotificationEvents, STORED_CLICK_MS, WorkerBridge } from "../src/core/notification_events";
import { createOpenPush } from "../src/core/sdk";
import { Logger } from "../src/log/logger";
import type { OpenPushNotification } from "../src/notification";
import { Db, ROW, STORE } from "../src/storage/idb";
import { MemoryDb } from "../src/storage/memory";
import type { ClickPayload } from "../src/worker/channel";
import type { WorkerMessageEventLike } from "../src/worker/registration";
import { FakeContainer, fakePlatform, flush, SITE } from "./helpers/fake_platform";

const log = () => new Logger(undefined, () => 0, "none");
const realTimers = {
  setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
  clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
};

const NOTE: OpenPushNotification = {
  id: "msg_1",
  title: "Spring sale",
  body: "Everything 20% off",
  icon: null,
  image: null,
  badge: null,
  url: `${SITE}/sale`,
  buttons: [],
  topic: null,
  data: { level: "7" },
  receivedAt: 1,
};

function protocol(type: string, payload: unknown) {
  return { op: "openpush", v: 2, type, payload };
}

function clickPayload(clickId = "msg_1::100"): ClickPayload {
  return { notification: NOTE, result: { actionId: "", url: `${SITE}/sale` }, clickId };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("foreground lifecycle listeners", () => {
  it("answers true with no listener, or when no listener prevents it", () => {
    const events = new NotificationEvents(log());
    const answer = vi.fn();
    events.runForeground(NOTE, answer, realTimers);
    expect(answer).toHaveBeenCalledWith(true);

    const seen = vi.fn();
    events.addForegroundLifecycleListener(seen);
    const second = vi.fn();
    events.runForeground(NOTE, second, realTimers);
    expect(seen.mock.calls[0]?.[0].notification).toBe(NOTE);
    expect(second).toHaveBeenCalledWith(true);
  });

  it("answers false after the wait when a listener prevents it and never calls display()", () => {
    vi.useFakeTimers();
    const events = new NotificationEvents(log());
    events.addForegroundLifecycleListener((e) => e.preventDefault());
    const answer = vi.fn();
    events.runForeground(NOTE, answer, realTimers);
    expect(answer).not.toHaveBeenCalled();
    vi.advanceTimersByTime(FOREGROUND_ANSWER_MS);
    expect(answer).toHaveBeenCalledExactlyOnceWith(false);
  });

  it("answers true when display() follows preventDefault(), at once or later", () => {
    vi.useFakeTimers();
    const events = new NotificationEvents(log());
    events.addForegroundLifecycleListener((e) => {
      e.preventDefault();
      e.display();
    });
    const now = vi.fn();
    events.runForeground(NOTE, now, realTimers);
    expect(now).toHaveBeenCalledExactlyOnceWith(true);

    const later = new NotificationEvents(log());
    let display: (() => void) | undefined;
    later.addForegroundLifecycleListener((e) => {
      e.preventDefault();
      display = e.display;
    });
    const answer = vi.fn();
    later.runForeground(NOTE, answer, realTimers);
    vi.advanceTimersByTime(300);
    display?.();
    expect(answer).toHaveBeenCalledExactlyOnceWith(true);
    vi.advanceTimersByTime(FOREGROUND_ANSWER_MS);
    expect(answer).toHaveBeenCalledTimes(1);
  });

  it("a throwing listener does not stop the others", () => {
    const events = new NotificationEvents(log());
    const second = vi.fn();
    events.addForegroundLifecycleListener(() => {
      throw new Error("site bug");
    });
    events.addForegroundLifecycleListener(second);
    events.runForeground(NOTE, vi.fn(), realTimers);
    expect(second).toHaveBeenCalled();
  });
});

describe("worker bridge", () => {
  function bridge(now = () => 1_000) {
    const events = new NotificationEvents(log());
    const b = new WorkerBridge({ events, log: log(), timers: realTimers, now, container: () => undefined });
    return { events, b };
  }

  it("answers the worker's foreground question on the reply port", () => {
    const { events, b } = bridge();
    events.addForegroundLifecycleListener((e) => {
      e.preventDefault();
      e.display();
    });
    const port = { postMessage: vi.fn() };
    const event: WorkerMessageEventLike = { data: protocol("openpush:foreground", { notification: NOTE }), ports: [port] };
    b.onMessage(event);
    expect(port.postMessage).toHaveBeenCalledWith(protocol("openpush:foreground-answer", { display: true }));
  });

  it("holds clicks until initialize has resolved, then fires each once", async () => {
    const { events, b } = bridge();
    const clicked = vi.fn();
    events.addClickListener(clicked);
    b.onMessage({ data: protocol("openpush:click", clickPayload()) });
    expect(clicked).not.toHaveBeenCalled();
    await b.afterInitialize({ db: new MemoryDb() });
    expect(clicked).toHaveBeenCalledExactlyOnceWith({ notification: NOTE, result: { actionId: "", url: `${SITE}/sale` } });
    b.onMessage({ data: protocol("openpush:click", clickPayload()) });
    expect(clicked).toHaveBeenCalledTimes(1);
    b.onMessage({ data: protocol("openpush:click", clickPayload("msg_1::200")) });
    expect(clicked).toHaveBeenCalledTimes(2);
  });

  it("fires the click kept for the page it opened, once, and removes it", async () => {
    const { events, b } = bridge(() => 10_000);
    const clicked = vi.fn();
    events.addClickListener(clicked);
    const db = new MemoryDb();
    await db.put(STORE.clicks, ROW.lastClick, { clickId: "msg_1::9000", at: 9_000, payload: clickPayload("msg_1::9000") });
    b.onMessage({ data: protocol("openpush:click", clickPayload("msg_1::9000")) });
    await b.afterInitialize({ db });
    expect(clicked).toHaveBeenCalledTimes(1);
    expect(await db.get(STORE.clicks, ROW.lastClick)).toBeUndefined();
  });

  it("ignores a kept click older than 60 s", async () => {
    const { events, b } = bridge(() => 100_000);
    const clicked = vi.fn();
    events.addClickListener(clicked);
    const db = new MemoryDb();
    await db.put(STORE.clicks, ROW.lastClick, { clickId: "c", at: 100_000 - STORED_CLICK_MS - 1, payload: clickPayload("c") });
    await b.afterInitialize({ db });
    expect(clicked).not.toHaveBeenCalled();
    expect(await db.get(STORE.clicks, ROW.lastClick)).toBeUndefined();
  });

  it("fires dismiss listeners and ignores messages outside the protocol", () => {
    const { events, b } = bridge();
    const dismissed = vi.fn();
    const clicked = vi.fn();
    events.addDismissListener(dismissed);
    events.addClickListener(clicked);
    b.onMessage({ data: protocol("openpush:dismiss", { notification: NOTE }) });
    expect(dismissed).toHaveBeenCalledWith({ notification: NOTE });
    b.onMessage({ data: { op: "openpush:click", message_id: "m", action_id: "", url: "/" } });
    events.removeDismissListener(dismissed);
    b.onMessage({ data: protocol("openpush:dismiss", { notification: NOTE }) });
    expect(dismissed).toHaveBeenCalledTimes(1);
    expect(clicked).not.toHaveBeenCalled();
  });
});

describe("OpenPush.Notifications listeners through initialize", () => {
  class ListeningContainer extends FakeContainer {
    listener: ((event: WorkerMessageEventLike) => void) | undefined;
    readonly startMessages = vi.fn();
    addEventListener(_type: "message", listener: (event: WorkerMessageEventLike) => void): void {
      this.listener = listener;
    }
  }

  it("a click the worker kept for this page fires after initialize", async () => {
    const fake = fakePlatform();
    const container = new ListeningContainer();
    fake.platform.serviceWorker = () => container;
    const db = new Db(fake.idb, () => true);
    await db.put(STORE.clicks, ROW.lastClick, { clickId: "k1", at: Date.now(), payload: clickPayload("k1") });

    const { api } = createOpenPush({ platform: fake.platform });
    const clicked = vi.fn();
    api.Notifications.addClickListener(clicked);
    await api.initialize({ appId: "app-1" });
    await flush();
    expect(container.startMessages).toHaveBeenCalled();
    expect(clicked).toHaveBeenCalledExactlyOnceWith({ notification: NOTE, result: { actionId: "", url: `${SITE}/sale` } });

    container.listener?.({ data: protocol("openpush:click", clickPayload("k1")) });
    expect(clicked).toHaveBeenCalledTimes(1);
    container.listener?.({ data: protocol("openpush:dismiss", { notification: NOTE }) });
  });

  it("exposes every listener member", () => {
    const { api } = createOpenPush({ platform: fakePlatform().platform });
    for (const name of [
      "addClickListener",
      "removeClickListener",
      "addForegroundLifecycleListener",
      "removeForegroundLifecycleListener",
      "addDismissListener",
      "removeDismissListener",
    ] as const) {
      expect(typeof api.Notifications[name]).toBe("function");
    }
  });
});

describe("composeHooks", () => {
  it("runs reconcile steps in order and after-initialize steps side by side; a failure skips nothing", async () => {
    const { composeHooks } = await import("../src/core/hooks");
    const order: string[] = [];
    let release: () => void = () => undefined;
    const hooks = composeHooks(
      {
        reconcilePush: async () => {
          order.push("a");
          throw new Error("a failed");
        },
        afterInitialize: () => new Promise<void>((resolve) => (release = resolve)),
      },
      {
        reconcilePush: async () => {
          order.push("b");
        },
        afterInitialize: () => {
          order.push("after-b");
        },
      },
    );
    const ctx = {} as never;
    await expect(hooks.reconcilePush?.(ctx)).rejects.toThrow("a failed");
    expect(order).toEqual(["a", "b"]);
    const after = hooks.afterInitialize?.(ctx);
    await Promise.resolve();
    expect(order).toContain("after-b");
    release();
    await after;
  });
});
