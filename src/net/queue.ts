import { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";
import type { HttpClient, HttpMethod, HttpResponse } from "./http";
import { isRetryableStatus, parseRetryAfter, retryDelay } from "./retry";
import { isRecord } from "../util/values";

/**
 * How a new write treats a waiting write of the same kind:
 * - replace: the new write replaces it;
 * - merge: replaces it, with `tags` and `aliases` merged (new values win);
 * - append: both are kept (for example event batches).
 */
export type Coalesce = "replace" | "merge" | "append";

export interface QueuedWrite {
  /** Set by the storage; gives the call order. */
  seq?: number;
  kind: string;
  method: Exclude<HttpMethod, "GET">;
  path: string;
  body?: Record<string, unknown>;
  coalesce: Coalesce;
  createdAt: number;
}

/** Persistent storage of the queue, in call order. */
export interface QueueStorage {
  all(): Promise<QueuedWrite[]>;
  add(write: QueuedWrite): Promise<number>;
  remove(seq: number): Promise<void>;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export type ResponseHandler = (write: QueuedWrite, res: HttpResponse) => void | Promise<void>;

export interface QueueDeps {
  storage: QueueStorage;
  http: Pick<HttpClient, "send">;
  timers: Timers;
  now: () => number;
  log: Logger;
  /** False while consent is not given, or before the SDK key is known. */
  canSend: () => boolean;
  /** False while consent is not given: nothing is stored. */
  canWrite: () => boolean;
}

interface Waiter {
  resolve(res: HttpResponse): void;
  reject(error: unknown): void;
}

const MERGED_FIELDS = ["tags", "aliases"] as const;

export function mergeBodies(
  previous: Record<string, unknown> | undefined,
  next: Record<string, unknown> | undefined,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...previous, ...next };
  // Tags and aliases merge only within one identity: after a login as someone else or a logout,
  // the waiting body's maps (and hash) belong to the earlier user and are not carried over.
  const id = next?.external_id;
  const sameIdentity = id === undefined || id === previous?.external_id;
  for (const field of [...MERGED_FIELDS, "external_id_auth_hash"] as const) {
    if (!sameIdentity && next?.[field] === undefined) delete out[field];
  }
  if (!sameIdentity) return out;
  for (const field of MERGED_FIELDS) {
    const a = previous?.[field];
    const b = next?.[field];
    if (isRecord(a) || isRecord(b)) out[field] = { ...(isRecord(a) ? a : {}), ...(isRecord(b) ? b : {}) };
  }
  return out;
}

/**
 * The one persistent write queue. Writes go out in call order. Transport failure, 429 or
 * 5xx: retry after 2 s, 8 s, then every 30 s, never sooner than `Retry-After`, while the page is
 * open. Other 4xx: dropped with a log line. Writes left over are sent on the next page load.
 */
export class WriteQueue {
  private started = false;
  private pumping = false;
  private timer: unknown;
  private attempts = 0;
  private inFlight: number | undefined;
  private lock: Promise<unknown> = Promise.resolve();
  private readonly waiters = new Map<number, Waiter[]>();
  private readonly handlers = new Map<string, Set<ResponseHandler>>();

  constructor(private readonly deps: QueueDeps) {}

  /** Called for every accepted write of `kind`, including writes left from an earlier page. */
  onResponse(kind: string, handler: ResponseHandler): () => void {
    let set = this.handlers.get(kind);
    if (!set) {
      set = new Set();
      this.handlers.set(kind, set);
    }
    set.add(handler);
    return () => set?.delete(handler);
  }

  /**
   * Stores the write and resolves with the server's answer once it is accepted. Rejects when the
   * server drops it (4xx other than 429).
   */
  enqueue(write: Omit<QueuedWrite, "seq" | "createdAt">): Promise<HttpResponse> {
    if (!this.deps.canWrite()) {
      return Promise.reject(new OpenPushError("consent_required", "Writes are off until consent is given"));
    }
    return new Promise<HttpResponse>((resolve, reject) => {
      this.locked(async () => {
        let waiters: Waiter[] = [{ resolve, reject }];
        let body = write.body;
        if (write.coalesce !== "append") {
          const waiting = (await this.deps.storage.all()).find(
            (w) => w.kind === write.kind && w.seq !== undefined && w.seq !== this.inFlight,
          );
          if (waiting?.seq !== undefined) {
            if (write.coalesce === "merge") body = mergeBodies(waiting.body, write.body);
            await this.deps.storage.remove(waiting.seq);
            waiters = [...(this.waiters.get(waiting.seq) ?? []), ...waiters];
            this.waiters.delete(waiting.seq);
          }
        }
        const stored: QueuedWrite = { ...write, createdAt: this.deps.now() };
        if (body !== undefined) stored.body = body;
        else delete stored.body;
        const seq = await this.deps.storage.add(stored);
        this.waiters.set(seq, waiters);
      }).then(
        () => this.kick(),
        (error: unknown) => reject(error),
      );
    });
  }

  /** Starts sending: drains writes left from earlier pages, then new ones. */
  start(): void {
    this.started = true;
    this.kick();
  }

  /** Resumes after consent comes back or the SDK key becomes known. */
  resume(): void {
    this.kick();
  }

  /** Stops timers (tests and teardown). */
  stop(): void {
    this.started = false;
    if (this.timer !== undefined) this.deps.timers.clearTimeout(this.timer);
    this.timer = undefined;
  }

  async size(): Promise<number> {
    return (await this.deps.storage.all()).length;
  }

  private locked<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.lock.then(fn, fn);
    this.lock = run.catch(() => undefined);
    return run;
  }

  private kick(): void {
    if (!this.started || this.pumping || this.timer !== undefined) return;
    void this.pump();
  }

  private async pump(): Promise<void> {
    this.pumping = true;
    try {
      while (this.started && this.deps.canSend()) {
        const head = await this.locked(async () => {
          const next = (await this.deps.storage.all())[0];
          this.inFlight = next?.seq;
          return next;
        });
        if (!head || head.seq === undefined) break;
        const outcome = await this.sendOne(head);
        if (outcome === "wait") break;
      }
    } catch (error) {
      this.deps.log.error(`The write queue stopped: ${error instanceof Error ? error.message : "storage error"}`);
    } finally {
      this.inFlight = undefined;
      this.pumping = false;
    }
  }

  private async sendOne(write: QueuedWrite): Promise<"next" | "wait"> {
    const seq = write.seq as number;
    let res: HttpResponse;
    try {
      res = await this.deps.http.send({ method: write.method, path: write.path, body: write.body });
    } catch (error) {
      if (error instanceof OpenPushError && error.code !== "network") return "wait";
      this.scheduleRetry(undefined, write.kind);
      return "wait";
    }
    if (res.status < 400) {
      await this.locked(() => this.deps.storage.remove(seq));
      this.attempts = 0;
      await this.notify(write, res);
      this.settle(seq, (w) => w.resolve(res));
      return "next";
    }
    if (isRetryableStatus(res.status)) {
      this.scheduleRetry(parseRetryAfter(res.header("Retry-After"), this.deps.now()), write.kind, res.status);
      return "wait";
    }
    await this.locked(() => this.deps.storage.remove(seq));
    this.attempts = 0;
    this.deps.log.warn(`Dropped a ${write.kind} write: the server answered ${res.status}`);
    const error = new OpenPushError("network", `The server refused the ${write.kind} write (${res.status})`, {
      status: res.status,
      body: res.body,
    });
    this.settle(seq, (w) => w.reject(error));
    return "next";
  }

  private scheduleRetry(retryAfterMs: number | undefined, kind: string, status?: number): void {
    this.attempts += 1;
    const delay = Math.max(retryDelay(this.attempts), retryAfterMs ?? 0);
    const why = status === undefined ? "no connection" : `server answered ${status}`;
    this.deps.log.debug(`The ${kind} write will be retried in ${Math.round(delay / 1000)} s (${why})`);
    this.timer = this.deps.timers.setTimeout(() => {
      this.timer = undefined;
      this.kick();
    }, delay);
  }

  private async notify(write: QueuedWrite, res: HttpResponse): Promise<void> {
    for (const handler of this.handlers.get(write.kind) ?? []) {
      try {
        await handler(write, res);
      } catch (error) {
        this.deps.log.error(`A ${write.kind} response handler failed: ${error instanceof Error ? error.message : "error"}`);
      }
    }
  }

  private settle(seq: number, fn: (w: Waiter) => void): void {
    const list = this.waiters.get(seq);
    this.waiters.delete(seq);
    list?.forEach(fn);
  }
}

/** Queue storage on the IndexedDB `queue` store. */
export class IdbQueueStorage implements QueueStorage {
  constructor(private readonly db: { all<T>(store: "queue"): Promise<T[]>; add(store: "queue", value: unknown): Promise<number>; delete(store: "queue", key: IDBValidKey): Promise<void> }) {}

  async all(): Promise<QueuedWrite[]> {
    const rows = await this.db.all<QueuedWrite>("queue");
    return rows.sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  add(write: QueuedWrite): Promise<number> {
    return this.db.add("queue", write);
  }

  remove(seq: number): Promise<void> {
    return this.db.delete("queue", seq);
  }
}

/** In-memory queue storage, for tests and when IndexedDB is missing. */
export class MemoryQueueStorage implements QueueStorage {
  private rows: QueuedWrite[] = [];
  private next = 1;

  async all(): Promise<QueuedWrite[]> {
    return this.rows.map((r) => ({ ...r }));
  }

  async add(write: QueuedWrite): Promise<number> {
    const seq = this.next++;
    this.rows.push({ ...write, seq });
    return seq;
  }

  async remove(seq: number): Promise<void> {
    this.rows = this.rows.filter((r) => r.seq !== seq);
  }
}
