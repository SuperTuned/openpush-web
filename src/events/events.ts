/**
 * Custom events and outcomes. `trackEvent` adds `properties._op` and an
 * idempotency key, and sends in batches of up to 50 through the write queue: every 5 s, or at
 * once when 50 are waiting. Outcomes are custom events; a unique outcome's key makes the server
 * store one event per name and attribution key.
 */
import type { InitContext } from "../core/hooks";
import { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";
import type { Timers } from "../net/queue";
import type { LastPush } from "../storage/types";
import { randomId } from "../util/hash";
import { SDK_VERSION } from "../version";
import { eventName, record } from "../user/validate";

export const BATCH_SIZE = 50;
export const FLUSH_MS = 5_000;
/** The server's limit on encoded properties. */
export const MAX_PROPERTIES_BYTES = 2048;
/** A push clicked or received within this time is the unique outcome's attribution. */
export const ATTRIBUTION_MS = 24 * 3600_000;
/** Events kept while nothing identifies this browser yet; the oldest go first. */
export const MAX_WAITING = 500;

/** Where the last clicked or received push is read from (the worker keeps it). */
export interface AttributionSource {
  lastPush(): Promise<LastPush | undefined>;
}

export interface EventDeps {
  log: Logger;
  timers: Timers;
  now: () => number;
  /** False while consent is required and not given. */
  allowed: () => boolean;
  context: () => InitContext | undefined;
  subscriptionId: () => string | null;
  externalId: () => string | null;
  /** `{browser, os}` of this browser. */
  device: () => { browser: string; os: string };
  attribution: AttributionSource;
}

interface WaitingEvent {
  name: string;
  properties: Record<string, unknown>;
  timestamp: number;
  key?: string;
  /** A unique outcome's attribution key; the idempotency key is made when it is sent. */
  attribution?: string;
}

/** `"uo:" + name + ":" + subscriptionId + ":" + attributionKey`. */
export function uniqueKey(name: string, subscriptionId: string, attribution: string): string {
  return `uo:${name}:${subscriptionId}:${attribution}`;
}

export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

export class EventTracker {
  private waiting: WaitingEvent[] = [];
  private timer: unknown;

  constructor(private readonly deps: EventDeps) {}

  /** `OpenPush.trackEvent`. Throws `invalid_argument` for a bad name or properties. */
  track(name: string, properties?: Record<string, unknown>, idempotencyKey?: string): void {
    this.add(this.build(name, properties, idempotencyKey));
  }

  /** `Session.sendOutcome`: a custom event named `name` with `{value}`. */
  sendOutcome(name: string, value?: number): void {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) {
      throw new OpenPushError("invalid_argument", "An outcome value must be a number");
    }
    this.track(name, value === undefined ? {} : { value });
  }

  /**
   * `Session.sendUniqueOutcome`: the same event once per attribution key, which is the message
   * id of the last push clicked or received within 24 hours, else the UTC date.
   */
  sendUniqueOutcome(name: string): void {
    const event = this.build(name, {});
    const now = this.deps.now();
    void this.deps.attribution
      .lastPush()
      .catch(() => undefined)
      .then((last) => {
        const recent = last && typeof last.messageId === "string" && now - last.at >= 0 && now - last.at <= ATTRIBUTION_MS;
        event.attribution = recent ? last.messageId : utcDate(now);
        this.add(event);
      });
  }

  /** After `initialize`: sends what was tracked before it. */
  start(): void {
    if (this.waiting.length > 0) this.schedule(0);
  }

  /** Sends one batch now (tests and the timer). */
  flush(): void {
    if (this.timer !== undefined) this.deps.timers.clearTimeout(this.timer);
    this.timer = undefined;
    const ctx = this.deps.context();
    if (!ctx || this.waiting.length === 0) return;
    const subscriptionId = this.deps.subscriptionId();
    const externalId = this.deps.externalId();
    if (!subscriptionId && !externalId) {
      // The server needs one of the two; wait for a registration or a login.
      this.schedule(FLUSH_MS);
      return;
    }
    // One batch now, plus every further full batch (at once at 50); the rest waits for the timer.
    do {
      const batch = this.waiting.splice(0, BATCH_SIZE).map((e) => {
        const item: Record<string, unknown> = { name: e.name, properties: e.properties, timestamp: e.timestamp };
        if (subscriptionId) item.subscription_id = subscriptionId;
        else if (externalId) item.external_id = externalId;
        item.idempotency_key = e.attribution === undefined ? e.key : uniqueKey(e.name, subscriptionId ?? "", e.attribution);
        return item;
      });
      ctx.queue
        .enqueue({ kind: "events", method: "POST", path: `/v1/apps/${encodeURIComponent(ctx.options.appId)}/events`, body: { events: batch }, coalesce: "append" })
        .catch(() => this.deps.log.warn(`${batch.length} events were not accepted`));
    } while (this.waiting.length >= BATCH_SIZE);
    if (this.waiting.length > 0) this.schedule(FLUSH_MS);
  }

  private build(name: string, properties?: Record<string, unknown>, idempotencyKey?: string): WaitingEvent {
    const clean = eventName(name);
    const props = properties === undefined ? {} : { ...record(properties, "Event properties") };
    props._op = { ...this.deps.device(), sdk: SDK_VERSION };
    let size: number;
    try {
      size = new TextEncoder().encode(JSON.stringify(props)).length;
    } catch {
      throw new OpenPushError("invalid_argument", "Event properties must be plain JSON");
    }
    if (size > MAX_PROPERTIES_BYTES) throw new OpenPushError("invalid_argument", `Event properties are over ${MAX_PROPERTIES_BYTES} bytes`);
    let key = idempotencyKey;
    if (key !== undefined && (typeof key !== "string" || key.trim() === "" || key.length > 200)) {
      throw new OpenPushError("invalid_argument", "An idempotency key must be text of 1 to 200 characters");
    }
    // Every event has a key, so a batch sent again after a lost answer is not counted twice.
    key ??= randomId();
    return { name: clean, properties: props, timestamp: this.deps.now() / 1000, key };
  }

  private add(event: WaitingEvent): void {
    if (!this.deps.allowed()) {
      this.deps.log.debug(`Event "${event.name}" not sent: consent is not given`);
      return;
    }
    this.waiting.push(event);
    if (this.waiting.length > MAX_WAITING) this.waiting.splice(0, this.waiting.length - MAX_WAITING);
    this.schedule(this.waiting.length >= BATCH_SIZE ? 0 : FLUSH_MS);
  }

  private schedule(delay: number): void {
    if (!this.deps.context()) return;
    if (this.timer !== undefined) {
      if (delay > 0) return;
      this.deps.timers.clearTimeout(this.timer);
    }
    this.timer = this.deps.timers.setTimeout(() => {
      this.timer = undefined;
      this.flush();
    }, delay);
  }
}
