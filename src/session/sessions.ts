/**
 * Sessions. All tabs of the site share one session through localStorage
 * `openpush.session`. On page load, and when a hidden page becomes visible, a last observation
 * more than 60 s old starts a new session: `POST /sessions {token}`, after the previous session's
 * active time (if over 60 s) as `{token, duration_seconds, idempotency_key}`. Duration goes at
 * the next session, never on unload. Only browsers with a row send.
 */
import type { InitContext } from "../core/hooks";
import type { Timers } from "../net/queue";
import type { LocalStore } from "../storage/local";
import { LOCAL_KEY } from "../storage/local";

/** The shared record, in milliseconds. */
export interface SessionRecord {
  start: number;
  /** The last time any visible tab of the site looked. */
  last: number;
  /** Visible time in this session (time any tab was visible, counted once). */
  active: number;
  /** Visible time up to this moment is in `active`. */
  counted: number;
}

export const SESSION_GAP_MS = 60_000;
/** Durations of a minute or less are not sent. */
export const MIN_DURATION_MS = 60_000;
/** How often a visible tab records its time. */
export const TICK_MS = 15_000;

export interface SessionDeps {
  local: LocalStore;
  timers: Timers;
  now: () => number;
  isVisible: () => boolean;
  onVisible: (listener: () => void) => void;
  onHidden: (listener: () => void) => void;
  /** The browser's row token, when it has a row (a subscription id and a token). */
  rowToken: () => string | null;
}

function isRecord(value: unknown): value is SessionRecord {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.start === "number" && typeof v.last === "number" && typeof v.active === "number" && typeof v.counted === "number";
}

export class SessionTracker {
  private ctx: InitContext | undefined;
  /** When this tab last became visible; undefined while hidden. */
  private visibleSince: number | undefined;
  private timer: unknown;

  constructor(private readonly deps: SessionDeps) {}

  /** Starts session tracking for this page load. */
  start(ctx: InitContext): void {
    if (this.ctx) return;
    this.ctx = ctx;
    this.deps.onVisible(() => this.shown());
    this.deps.onHidden(() => this.hidden());
    if (this.deps.isVisible()) this.shown();
    else this.observe();
  }

  private shown(): void {
    this.observe();
    this.visibleSince = this.deps.now();
    this.tick();
  }

  private hidden(): void {
    this.record();
    this.visibleSince = undefined;
    if (this.timer !== undefined) this.deps.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }

  private tick(): void {
    if (this.timer !== undefined) this.deps.timers.clearTimeout(this.timer);
    this.timer = this.deps.timers.setTimeout(() => {
      this.timer = undefined;
      if (this.visibleSince === undefined) return;
      this.record();
      this.tick();
    }, TICK_MS);
  }

  /** A new session when the last observation is more than 60 s old; else this one goes on. */
  private observe(): void {
    const now = this.deps.now();
    const rec = this.read();
    if (rec && now - rec.last <= SESSION_GAP_MS) {
      this.record();
      return;
    }
    const token = this.deps.rowToken();
    if (token && rec && rec.active > MIN_DURATION_MS) {
      this.send("session-duration", { token, duration_seconds: Math.round(rec.active / 1000), idempotency_key: `sd:${rec.start}` });
    }
    if (token) this.send("session", { token });
    this.deps.local.setJson(LOCAL_KEY.session, { start: now, last: now, active: 0, counted: now } satisfies SessionRecord);
  }

  /**
   * Moves the last observation to now. A visible tab also adds its visible time not yet counted
   * by any tab, so two visible tabs do not count the same time twice.
   */
  private record(): void {
    const rec = this.read();
    if (!rec) return;
    const now = this.deps.now();
    if (this.visibleSince !== undefined) {
      rec.active += Math.max(0, now - Math.max(rec.counted, this.visibleSince));
      rec.counted = Math.max(rec.counted, now);
    }
    rec.last = Math.max(rec.last, now);
    this.deps.local.setJson(LOCAL_KEY.session, rec);
  }

  private read(): SessionRecord | undefined {
    const value = this.deps.local.getJson<unknown>(LOCAL_KEY.session);
    return isRecord(value) ? value : undefined;
  }

  private send(kind: string, body: Record<string, unknown>): void {
    const ctx = this.ctx;
    if (!ctx) return;
    ctx.queue
      .enqueue({ kind, method: "POST", path: `/v1/apps/${encodeURIComponent(ctx.options.appId)}/sessions`, body, coalesce: kind === "session" ? "replace" : "append" })
      .catch(() => undefined);
  }
}
