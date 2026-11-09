/**
 * Custom events and outcomes: `_op`, batches of 50 every 5 s, identity, and the
 * unique outcome's idempotency key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InitContext } from "../src/core/hooks";
import { ATTRIBUTION_MS, BATCH_SIZE, EventTracker, FLUSH_MS, uniqueKey, utcDate } from "../src/events/events";
import { Logger } from "../src/log/logger";
import type { LastPush } from "../src/storage/types";
import { SDK_VERSION } from "../src/version";

type Item = Record<string, unknown>;

interface Setup {
  tracker: EventTracker;
  enqueue: ReturnType<typeof vi.fn>;
  batches(): Item[][];
  ids: { sub: string | null; ext: string | null };
  consent: { allowed: boolean };
  last: { push: LastPush | undefined };
  ctx: { value: InitContext | undefined };
}

function setup(initialized = true): Setup {
  const enqueue = vi.fn(async (_write: unknown) => ({ status: 200, ok: true, header: () => null, body: {} }));
  const ctx = { value: initialized ? ({ options: { appId: "app-1" }, queue: { enqueue } } as unknown as InitContext) : undefined };
  const ids = { sub: "sub-1" as string | null, ext: null as string | null };
  const consent = { allowed: true };
  const last: { push: LastPush | undefined } = { push: undefined };
  const tracker = new EventTracker({
    log: new Logger(undefined, () => Date.now()),
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    now: () => Date.now(),
    allowed: () => consent.allowed,
    context: () => ctx.value,
    subscriptionId: () => ids.sub,
    externalId: () => ids.ext,
    device: () => ({ browser: "chrome", os: "windows" }),
    attribution: { lastPush: async () => last.push },
  });
  const batches = (): Item[][] =>
    enqueue.mock.calls.map((c) => ((c[0] as { body: { events: Item[] } }).body.events));
  return { tracker, enqueue, batches, ids, consent, last, ctx };
}

const NOW = Date.UTC(2026, 10, 8, 12, 0, 0);

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("trackEvent", () => {
  it("adds properties._op, a timestamp, an idempotency key and the subscription id", () => {
    const s = setup();
    s.tracker.track("level_completed", { level: 8 });
    vi.advanceTimersByTime(FLUSH_MS);
    const [item] = s.batches()[0] ?? [];
    expect(item).toMatchObject({
      name: "level_completed",
      properties: { level: 8, _op: { browser: "chrome", os: "windows", sdk: SDK_VERSION } },
      timestamp: NOW / 1000,
      subscription_id: "sub-1",
    });
    expect(item?.idempotency_key).toMatch(/^[0-9a-f]{32}$/);
    expect(s.enqueue.mock.calls[0]?.[0]).toMatchObject({ kind: "events", method: "POST", path: "/v1/apps/app-1/events", coalesce: "append" });
  });

  it("uses the caller's idempotency key", () => {
    const s = setup();
    s.tracker.track("bought", {}, "order-77");
    vi.advanceTimersByTime(FLUSH_MS);
    expect(s.batches()[0]?.[0]?.idempotency_key).toBe("order-77");
  });

  it("sends with the external id when the browser has no row", () => {
    const s = setup();
    s.ids.sub = null;
    s.ids.ext = "player-1";
    s.tracker.track("opened");
    vi.advanceTimersByTime(FLUSH_MS);
    expect(s.batches()[0]?.[0]).toMatchObject({ external_id: "player-1" });
    expect(s.batches()[0]?.[0]).not.toHaveProperty("subscription_id");
  });

  it("waits while nothing identifies this browser", () => {
    const s = setup();
    s.ids.sub = null;
    s.tracker.track("opened");
    vi.advanceTimersByTime(3 * FLUSH_MS);
    expect(s.enqueue).not.toHaveBeenCalled();
    s.ids.sub = "sub-9";
    vi.advanceTimersByTime(FLUSH_MS);
    expect(s.batches()[0]?.[0]).toMatchObject({ subscription_id: "sub-9" });
  });

  it("batches: every 5 s, at once at 50, at most 50 per request", () => {
    const s = setup();
    for (let i = 0; i < 3; i++) s.tracker.track(`e${i}`);
    vi.advanceTimersByTime(FLUSH_MS - 1);
    expect(s.enqueue).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(s.batches().map((b) => b.length)).toEqual([3]);

    const t = setup();
    for (let i = 0; i < 120; i++) t.tracker.track("tick");
    vi.advanceTimersByTime(0);
    expect(t.batches().map((b) => b.length)).toEqual([BATCH_SIZE, BATCH_SIZE]);
    vi.advanceTimersByTime(FLUSH_MS);
    expect(t.batches().map((b) => b.length)).toEqual([BATCH_SIZE, BATCH_SIZE, 20]);
  });

  it("events tracked before initialize are sent after it", () => {
    const s = setup(false);
    s.tracker.track("early");
    vi.advanceTimersByTime(3 * FLUSH_MS);
    s.ctx.value = { options: { appId: "app-1" }, queue: { enqueue: s.enqueue } } as unknown as InitContext;
    s.tracker.start();
    vi.advanceTimersByTime(0);
    expect(s.batches()[0]?.[0]).toMatchObject({ name: "early" });
  });

  it("rejects bad names and properties with invalid_argument", () => {
    const s = setup();
    const code = (fn: () => void): string | undefined => {
      try {
        fn();
      } catch (error) {
        return (error as { code?: string }).code;
      }
      return undefined;
    };
    expect(code(() => s.tracker.track(""))).toBe("invalid_argument");
    expect(code(() => s.tracker.track("a/b"))).toBe("invalid_argument");
    expect(code(() => s.tracker.track("x".repeat(129)))).toBe("invalid_argument");
    expect(code(() => s.tracker.track("ok", [] as unknown as Record<string, unknown>))).toBe("invalid_argument");
    expect(code(() => s.tracker.track("ok", { big: "x".repeat(2100) }))).toBe("invalid_argument");
    expect(code(() => s.tracker.track("ok", {}, ""))).toBe("invalid_argument");
    expect(code(() => s.tracker.track("Level 1.done-ok_x"))).toBeUndefined();
  });

  it("without consent, events are dropped", () => {
    const s = setup();
    s.consent.allowed = false;
    s.tracker.track("opened");
    vi.advanceTimersByTime(FLUSH_MS);
    expect(s.enqueue).not.toHaveBeenCalled();
  });
});

describe("outcomes", () => {
  it("sendOutcome is a custom event with {value}", () => {
    const s = setup();
    s.tracker.sendOutcome("purchase", 4.99);
    s.tracker.sendOutcome("signup");
    vi.advanceTimersByTime(FLUSH_MS);
    const [a, b] = s.batches()[0] ?? [];
    expect(a).toMatchObject({ name: "purchase", properties: { value: 4.99 } });
    expect(b?.properties).not.toHaveProperty("value");
  });

  it("sendUniqueOutcome keys on the last push clicked or received within 24 h", async () => {
    const s = setup();
    s.last.push = { messageId: "msg-9", at: NOW - 3_600_000, kind: "clicked" };
    s.tracker.sendUniqueOutcome("purchase");
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(s.batches()[0]?.[0]?.idempotency_key).toBe("uo:purchase:sub-1:msg-9");
    expect(uniqueKey("purchase", "sub-1", "msg-9")).toBe("uo:purchase:sub-1:msg-9");
  });

  it("an older push, or none, keys on the UTC date", async () => {
    const s = setup();
    s.last.push = { messageId: "msg-old", at: NOW - ATTRIBUTION_MS - 1, kind: "received" };
    s.tracker.sendUniqueOutcome("purchase");
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(s.batches()[0]?.[0]?.idempotency_key).toBe(`uo:purchase:sub-1:${utcDate(NOW)}`);
    expect(utcDate(NOW)).toBe("2026-11-08");

    const t = setup();
    t.tracker.sendUniqueOutcome("purchase");
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(t.batches()[0]?.[0]?.idempotency_key).toBe("uo:purchase:sub-1:2026-11-08");
  });

  it("a non-number value is refused", () => {
    const s = setup();
    expect(() => s.tracker.sendOutcome("x", "1" as unknown as number)).toThrow();
  });
});
