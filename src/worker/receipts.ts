/**
 * Receipts: `POST {server}/v1/ingest` with `X-OP-SDK-Key` and the site's
 * `requestHeaders`, read from the copy the page stored before each send. A receipt that cannot be
 * sent waits in the shared `queue` store (one row per receipt, kind `receipt`) and goes out with
 * the next receipt, or with the page's write queue on the next page load. At most 100 wait; the
 * oldest are dropped. Order is kept: queued receipts go first, in the order they were made.
 */
import { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";
import { HttpClient, type FetchLike } from "../net/http";
import { storedHeaders } from "../net/request_headers";
import type { QueuedWrite } from "../net/queue";
import { isRetryableStatus } from "../net/retry";
import type { SdkDb } from "../storage/memory";
import type { CfgRow } from "../storage/types";

export type ReceiptType = "received" | "confirmed" | "clicked" | "dismissed";

export interface ReceiptEvent {
  type: ReceiptType;
  app: string;
  message_id: string;
  token?: string;
  subscription_id?: string;
  action_id?: string;
}

export const RECEIPT_KIND = "receipt";
export const INGEST_PATH = "/v1/ingest";
export const MAX_QUEUED_RECEIPTS = 100;

export interface ReceiptDeps {
  db: SdkDb;
  fetch: FetchLike;
  log: Logger;
  now: () => number;
}

/** The receipt for `messageId`, or undefined when `cfg` does not name the app yet. */
export function receiptEvent(type: ReceiptType, cfg: CfgRow | undefined, messageId: string, actionId?: string): ReceiptEvent | undefined {
  const app = cfg?.app;
  if (!app || !messageId) return undefined;
  const event: ReceiptEvent = { type, app, message_id: messageId };
  if (cfg.token) event.token = cfg.token;
  if (cfg.subscriptionId) event.subscription_id = cfg.subscriptionId;
  if (type === "clicked") event.action_id = actionId ?? "";
  return event;
}

function eventsOf(write: QueuedWrite): ReceiptEvent[] {
  const events = write.body?.events;
  return Array.isArray(events) ? (events as ReceiptEvent[]) : [];
}

export class Receipts {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(private readonly deps: ReceiptDeps) {}

  /** Sends `event` after every receipt posted before it. Never rejects. */
  post(event: ReceiptEvent | undefined, cfg: CfgRow | undefined): Promise<void> {
    if (!event) return Promise.resolve();
    const run = this.chain.then(() => this.send(event, cfg));
    this.chain = run.catch(() => undefined);
    return run.catch((error: unknown) => {
      this.deps.log.debug(`A receipt could not be stored: ${error instanceof Error ? error.message : "storage error"}`);
    });
  }

  private async queued(): Promise<QueuedWrite[]> {
    const rows = await this.deps.db.all<QueuedWrite>("queue");
    return rows.filter((w) => w.kind === RECEIPT_KIND && typeof w.seq === "number").sort((a, b) => (a.seq ?? 0) - (b.seq ?? 0));
  }

  private async send(event: ReceiptEvent, cfg: CfgRow | undefined): Promise<void> {
    const { db, log } = this.deps;
    const waiting = await this.queued();
    const server = cfg?.server;
    const key = cfg?.sdkKey;
    if (!server || !key) {
      await this.store(event);
      return;
    }
    const extra = await storedHeaders(db, log);
    const http = new HttpClient({
      fetch: this.deps.fetch,
      serverUrl: () => server,
      sdkKey: () => key,
      log,
      allowed: () => true,
      extraHeaders: async () => extra,
    });
    const events = [...waiting.flatMap(eventsOf), event];
    let status: number;
    try {
      status = (await http.send({ method: "POST", path: INGEST_PATH, body: { events } })).status;
    } catch (error) {
      if (error instanceof OpenPushError && error.code !== "network") throw error;
      await this.store(event);
      return;
    }
    if (status < 400 || !isRetryableStatus(status)) {
      if (status >= 400) log.warn(`The server refused ${events.length} receipt(s) (${status}); they were dropped`);
      for (const row of waiting) await db.delete("queue", row.seq as number);
      return;
    }
    await this.store(event);
  }

  /** Keeps a receipt for later; drops the oldest beyond 100. */
  private async store(event: ReceiptEvent): Promise<void> {
    const { db, now } = this.deps;
    const write: QueuedWrite = {
      kind: RECEIPT_KIND,
      method: "POST",
      path: INGEST_PATH,
      body: { events: [event] },
      coalesce: "append",
      createdAt: now(),
    };
    await db.add("queue", write);
    const rows = await this.queued();
    const extra = rows.length - MAX_QUEUED_RECEIPTS;
    for (let i = 0; i < extra; i++) await db.delete("queue", rows[i]?.seq as number);
  }
}
