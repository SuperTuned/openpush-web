import { afterEach, describe, expect, it, vi } from "vitest";
import { Logger } from "../src/log/logger";
import { isOptedIn, ListenerSet, pushStatus, sameState, type StatusInputs } from "../src/push/state";
import { madeWithKey, SUBSCRIBE_RETRY_DELAYS_MS, subscribeWithRetries } from "../src/push/subscribe";
import { ACTIVE_KEY, FakePushManager, OLD_KEY } from "./helpers/fake_push";

const base: StatusInputs = { supported: true, permission: "granted", hasSubscription: true, pending: false, optedOut: false };

describe("permission and subscription states", () => {
  it.each([
    ["any permission, unsupported", { supported: false }, "unsupported", false],
    ["no Notification API", { permission: undefined }, "unsupported", false],
    ["default, no subscription", { permission: "default", hasSubscription: false }, "not_asked", false],
    ["denied, no subscription", { permission: "denied", hasSubscription: false }, "denied", false],
    ["granted, being created", { pending: true, hasSubscription: false }, "pending", false],
    ["granted, subscription, no opt-out", {}, "subscribed", true],
    ["granted, subscription, opted out", { optedOut: true }, "opted_out", false],
  ] as const)("%s", (_name, over, status, optedIn) => {
    const input = { ...base, ...over } as StatusInputs;
    expect(pushStatus(input)).toBe(status);
    expect(isOptedIn(input)).toBe(optedIn);
  });

  it("granted with no subscription and nothing being created is pending; with an opt-out, opted_out", () => {
    expect(pushStatus({ ...base, hasSubscription: false })).toBe("pending");
    expect(pushStatus({ ...base, hasSubscription: false, optedOut: true })).toBe("opted_out");
  });

  it("an opt-out does not hide a denied permission", () => {
    expect(pushStatus({ ...base, permission: "denied", optedOut: true })).toBe("denied");
  });

  it("compares states field by field", () => {
    const a = { id: "s", token: "t", optedIn: true, status: "subscribed" as const };
    expect(sameState(a, { ...a })).toBe(true);
    expect(sameState(a, { ...a, id: null })).toBe(false);
  });
});

describe("ListenerSet", () => {
  it("runs every listener and logs one that throws", () => {
    const sink = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    const set = new ListenerSet<number>(new Logger(sink, () => 0), "test");
    const seen: number[] = [];
    set.add(() => {
      throw new Error("site bug");
    });
    set.add((n) => seen.push(n));
    set.emit(3);
    expect(seen).toEqual([3]);
    expect(sink.error).toHaveBeenCalledTimes(1);
  });
});

describe("subscribe retries", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  const timers = {
    setTimeout: (fn: () => void, ms: number) => setTimeout(fn, ms),
    clearTimeout: (h: unknown) => clearTimeout(h as ReturnType<typeof setTimeout>),
  };

  it("tries again after 1 s, 4 s and 15 s", async () => {
    vi.useFakeTimers();
    const manager = new FakePushManager();
    manager.failNext = 3;
    const done = subscribeWithRetries(manager, ACTIVE_KEY, { timers });
    await vi.advanceTimersByTimeAsync(0);
    expect(manager.subscribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(999);
    expect(manager.subscribe).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(manager.subscribe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(3_999);
    expect(manager.subscribe).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(manager.subscribe).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(15_000);
    expect(manager.subscribe).toHaveBeenCalledTimes(4);
    const outcome = await done;
    expect(outcome.ok).toBe(true);
    expect(SUBSCRIBE_RETRY_DELAYS_MS).toEqual([1_000, 4_000, 15_000]);
  });

  it("gives up after 4 tries in all", async () => {
    vi.useFakeTimers();
    const manager = new FakePushManager();
    manager.failNext = 10;
    const done = subscribeWithRetries(manager, ACTIVE_KEY, { timers });
    await vi.advanceTimersByTimeAsync(20_000);
    const outcome = await done;
    expect(outcome).toMatchObject({ ok: false, tries: 4 });
    expect(manager.subscribe).toHaveBeenCalledTimes(4);
  });

  it("stops at once when giveUp says so (a private window)", async () => {
    const manager = new FakePushManager();
    manager.failNext = 10;
    const outcome = await subscribeWithRetries(manager, ACTIVE_KEY, { timers, giveUp: () => true });
    expect(outcome).toMatchObject({ ok: false, tries: 1 });
  });

  it("subscribes with userVisibleOnly and the key's bytes", async () => {
    const manager = new FakePushManager();
    await subscribeWithRetries(manager, ACTIVE_KEY, { timers, delays: [] });
    expect(manager.subscribe.mock.calls[0]?.[0].userVisibleOnly).toBe(true);
    expect(manager.keysUsed).toEqual([ACTIVE_KEY]);
  });

  it("tells which key a subscription was made with", () => {
    const manager = new FakePushManager();
    expect(madeWithKey(manager.have("https://x.example/a", ACTIVE_KEY), ACTIVE_KEY)).toBe(true);
    expect(madeWithKey(manager.have("https://x.example/b", OLD_KEY), ACTIVE_KEY)).toBe(false);
    expect(madeWithKey(manager.have("https://x.example/c", null), ACTIVE_KEY)).toBeUndefined();
  });
});
