/**
 * Sessions, with fake timers and two "tabs" sharing one localStorage.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InitContext } from "../src/core/hooks";
import { SessionTracker, TICK_MS, type SessionRecord } from "../src/session/sessions";
import { LOCAL_KEY, LocalStore } from "../src/storage/local";
import { FakeStorage } from "./helpers/fake_platform";

interface Tab {
  tracker: SessionTracker;
  enqueue: ReturnType<typeof vi.fn>;
  show(): void;
  hide(): void;
  load(): void;
}

function tab(storage: FakeStorage, options: { token?: string | null; visible?: boolean; allowed?: () => boolean } = {}): Tab {
  let visible = options.visible ?? true;
  const shown: (() => void)[] = [];
  const hidden: (() => void)[] = [];
  const enqueue = vi.fn(async (_write: unknown) => ({ status: 200, ok: true, header: () => null, body: {} }));
  const tracker = new SessionTracker({
    local: new LocalStore(storage, options.allowed ?? (() => true)),
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    now: () => Date.now(),
    isVisible: () => visible,
    onVisible: (l) => shown.push(l),
    onHidden: (l) => hidden.push(l),
    rowToken: () => (options.token === undefined ? "https://fcm.googleapis.com/fcm/send/ep-1" : options.token),
  });
  const ctx = { options: { appId: "app-1" }, queue: { enqueue } } as unknown as InitContext;
  return {
    tracker,
    enqueue,
    show: () => {
      visible = true;
      shown.forEach((fn) => fn());
    },
    hide: () => {
      visible = false;
      hidden.forEach((fn) => fn());
    },
    load: () => tracker.start(ctx),
  };
}

const record = (storage: FakeStorage): SessionRecord => JSON.parse(storage.map.get(LOCAL_KEY.session) ?? "null") as SessionRecord;
const bodies = (t: Tab, kind: string): Record<string, unknown>[] =>
  t.enqueue.mock.calls.map((c) => c[0] as { kind: string; body: Record<string, unknown> }).filter((w) => w.kind === kind).map((w) => w.body);

const SECOND = 1_000;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
});

afterEach(() => {
  vi.useRealTimers();
});

describe("sessions", () => {
  it("the first load starts a session: POST /sessions {token} on the sessions path", async () => {
    const storage = new FakeStorage();
    const a = tab(storage);
    a.load();
    expect(bodies(a, "session")).toEqual([{ token: "https://fcm.googleapis.com/fcm/send/ep-1" }]);
    expect(a.enqueue.mock.calls[0]?.[0]).toMatchObject({ method: "POST", path: "/v1/apps/app-1/sessions" });
    expect(record(storage)).toMatchObject({ start: 1_000_000, last: 1_000_000, active: 0 });
  });

  it("a load within 60 s of the last observation continues the session", async () => {
    const storage = new FakeStorage();
    tab(storage).load();
    vi.advanceTimersByTime(50 * SECOND);
    const b = tab(storage);
    b.load();
    expect(bodies(b, "session")).toHaveLength(0);
    expect(record(storage).start).toBe(1_000_000);
  });

  it("visible again after more than 60 s: a new session, after the previous one's duration when over 60 s", async () => {
    const storage = new FakeStorage();
    const a = tab(storage);
    a.load();
    vi.advanceTimersByTime(90 * SECOND);
    a.hide();
    vi.advanceTimersByTime(120 * SECOND);
    a.show();
    expect(bodies(a, "session-duration")).toEqual([{ token: "https://fcm.googleapis.com/fcm/send/ep-1", duration_seconds: 90, idempotency_key: "sd:1000000" }]);
    expect(bodies(a, "session")).toHaveLength(2);
    const kinds = a.enqueue.mock.calls.map((c) => (c[0] as { kind: string }).kind);
    expect(kinds.lastIndexOf("session-duration")).toBeLessThan(kinds.lastIndexOf("session"));
  });

  it("a session of a minute or less sends no duration", async () => {
    const storage = new FakeStorage();
    const a = tab(storage);
    a.load();
    vi.advanceTimersByTime(45 * SECOND);
    a.hide();
    vi.advanceTimersByTime(5 * 60 * SECOND);
    a.show();
    expect(bodies(a, "session-duration")).toHaveLength(0);
    expect(bodies(a, "session")).toHaveLength(2);
  });

  it("hidden for less than 60 s keeps the session and does not count hidden time", async () => {
    const storage = new FakeStorage();
    const a = tab(storage);
    a.load();
    vi.advanceTimersByTime(30 * SECOND);
    a.hide();
    vi.advanceTimersByTime(40 * SECOND);
    a.show();
    vi.advanceTimersByTime(30 * SECOND);
    a.hide();
    expect(bodies(a, "session")).toHaveLength(1);
    expect(record(storage).active).toBe(60 * SECOND);
  });

  it("two visible tabs count shared time once", async () => {
    const storage = new FakeStorage();
    const a = tab(storage);
    a.load();
    vi.advanceTimersByTime(5 * SECOND);
    const b = tab(storage);
    b.load();
    vi.advanceTimersByTime(60 * SECOND);
    a.hide();
    b.hide();
    expect(record(storage).active).toBe(65 * SECOND);
    expect(bodies(b, "session")).toHaveLength(0);
  });

  it("a visible tab keeps the session alive for a tab that loads later", async () => {
    const storage = new FakeStorage();
    const a = tab(storage);
    a.load();
    vi.advanceTimersByTime(10 * TICK_MS);
    const b = tab(storage);
    b.load();
    expect(bodies(b, "session")).toHaveLength(0);
  });

  it("a hidden tab at load counts no visible time", async () => {
    const storage = new FakeStorage();
    const a = tab(storage, { visible: false });
    a.load();
    vi.advanceTimersByTime(120 * SECOND);
    expect(record(storage).active).toBe(0);
  });

  it("only browsers with a row send; the local session still moves on", async () => {
    const storage = new FakeStorage();
    const a = tab(storage, { token: null });
    a.load();
    expect(a.enqueue).not.toHaveBeenCalled();
    expect(record(storage)).toBeTruthy();
  });

  it("without consent nothing is written", async () => {
    const storage = new FakeStorage();
    const a = tab(storage, { allowed: () => false });
    a.load();
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});
