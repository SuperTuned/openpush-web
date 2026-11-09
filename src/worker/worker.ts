/**
 * The OpenPush service worker. Every listener is added synchronously by `installWorker`;
 * all async work runs inside `event.waitUntil`. No state is kept between events except the open
 * database connection: everything else is in IndexedDB.
 */
import { parseUserAgent } from "../env/browser";
import { isLogLevel } from "../log/levels";
import { Logger } from "../log/logger";
import type { FetchLike } from "../net/http";
import type { OpenPushNotification } from "../notification";
import { Db, ROW, STORE } from "../storage/idb";
import { MemoryDb, type SdkDb } from "../storage/memory";
import { WORKER_OWNED_CFG, type CfgRow } from "../storage/types";
import { isWorkerMessage, message, PAGE_TO_WORKER, WORKER_TO_PAGE, type ClickPayload } from "./channel";
import { clickBehavior, openTarget, type OpenResult } from "./click";
import { displayFor, fallbackDisplay, isShownData, notificationFromShown, plainDisplay, type Display } from "./display";
import { askForeground } from "./foreground";
import { marker } from "./mode";
import { buildNotification, isOpenPushMap, parsePush } from "./payload";
import { isRecord } from "../util/values";
import { receiptEvent, Receipts, type ReceiptType } from "./receipts";
import { remember, seenRecently } from "./recent";
import { handleSubscriptionChange } from "./subscription_change";
import type {
  MessageEventLike,
  NotificationEventLike,
  PushEventLike,
  PushSubscriptionChangeEventLike,
  WindowClientLike,
  WorkerGlobalLike,
} from "./sw_types";
import { opensNothing } from "./urls";
import { fireWebhook } from "./webhooks";
import { errorText } from "../util/values";

/** A click kept for the page it opened. */
export interface StoredClick {
  clickId: string;
  at: number;
  payload: ClickPayload;
}

export const CLICK_KEEP_MS = 60_000;
const MAX_SDK_CLIENTS = 20;

export class OpenPushWorker {
  readonly log: Logger;
  private readonly db: SdkDb;
  private readonly receipts: Receipts;
  private cfgLock: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly scope: WorkerGlobalLike,
    private readonly now: () => number = () => Date.now(),
  ) {
    this.log = new Logger(scope.console, now);
    const factory = scope.indexedDB;
    const timers = { setTimeout: (fn: () => void, ms: number) => scope.setTimeout(fn, ms), clearTimeout: (h: unknown) => scope.clearTimeout(h) };
    this.db = factory ? new Db(factory, () => true, this.log, timers) : new MemoryDb();
    this.receipts = new Receipts({ db: this.db, fetch: this.fetch, log: this.log, now });
  }

  private readonly fetch: FetchLike = (input, init) => this.scope.fetch(input, init);

  /** Adds every listener, synchronously (the cold-start rule). */
  listen(): void {
    const scope = this.scope;
    scope.addEventListener("install", (event) => event.waitUntil(scope.skipWaiting()));
    scope.addEventListener("activate", (event) => event.waitUntil(scope.clients.claim()));
    scope.addEventListener("push", (event) => event.waitUntil(this.guard("push", () => this.onPush(event))));
    scope.addEventListener("notificationclick", (event) => {
      if (isShownData(event.notification?.data)) event.waitUntil(this.guard("click", () => this.onClick(event)));
    });
    scope.addEventListener("notificationclose", (event) => {
      if (isShownData(event.notification?.data)) event.waitUntil(this.guard("dismiss", () => this.onClose(event)));
    });
    scope.addEventListener("pushsubscriptionchange", (event) =>
      event.waitUntil(this.guard("subscription change", () => this.onSubscriptionChange(event))),
    );
    scope.addEventListener("message", (event) => {
      if (isWorkerMessage(event.data)) event.waitUntil(this.guard("message", () => this.onMessage(event)));
    });
  }

  private async guard(name: string, fn: () => Promise<void>): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.log.error(`The ${name} handler failed: ${errorText(error)}`);
    }
  }

  // ---------------------------------------------------------------- shared

  private get origin(): string {
    return this.scope.location.origin;
  }

  private get hostname(): string {
    return this.scope.location.hostname;
  }

  private isSafari(): boolean {
    return parseUserAgent(this.scope.navigator?.userAgent ?? "").name === "safari";
  }

  /** Reads `cfg`, applies its log level and refines the worker mode. Undefined when storage fails. */
  private async readCfg(): Promise<CfgRow | undefined> {
    let cfg: CfgRow | undefined;
    try {
      cfg = await this.db.readCfg();
    } catch (error) {
      this.log.debug(`Could not read the stored config: ${errorText(error)}`);
    }
    if (cfg && isLogLevel(cfg.logLevel)) this.log.setLevel(cfg.logLevel);
    if (cfg?.sdkKey) this.log.addSecret(cfg.sdkKey);
    if (cfg?.deviceSecret) this.log.addSecret(cfg.deviceSecret);
    const current = this.scope.__openpushImported;
    if (current && cfg) this.scope.__openpushImported = marker(current.scriptURL, cfg);
    return cfg;
  }

  /** Read-modify-write of `cfg`, one at a time within this worker. */
  private lockedCfg<T>(fn: (cfg: CfgRow | undefined) => Promise<T>): Promise<T> {
    const run = this.cfgLock.then(async () => fn(await this.db.readCfg()));
    this.cfgLock = run.catch(() => undefined);
    return run;
  }

  private async windows(): Promise<readonly WindowClientLike[]> {
    try {
      return await this.scope.clients.matchAll({ type: "window", includeUncontrolled: true });
    } catch {
      return [];
    }
  }

  private async broadcast(type: string, payload: unknown): Promise<void> {
    const msg = message(type, payload);
    for (const client of await this.windows()) {
      try {
        client.postMessage(msg);
      } catch {
        // A closing window.
      }
    }
  }

  private receipt(type: ReceiptType, cfg: CfgRow | undefined, messageId: string, actionId?: string): Promise<void> {
    return this.receipts.post(receiptEvent(type, cfg, messageId, actionId), cfg);
  }

  private async show(display: Display): Promise<boolean> {
    try {
      await this.scope.registration.showNotification(display.title, display.options);
      return true;
    } catch (error) {
      this.log.debug(`The browser refused the notification options (${errorText(error)}); showing it plainly`);
    }
    try {
      const plain = plainDisplay(display);
      await this.scope.registration.showNotification(plain.title, plain.options);
      return true;
    } catch (error) {
      this.log.error(`Could not show a notification: ${errorText(error)}`);
      return false;
    }
  }

  // ------------------------------------------------------------------ push

  private async onPush(event: PushEventLike): Promise<void> {
    const parsed = parsePush(event.data);
    const cfg = await this.readCfg();
    const standalone = this.scope.__openpushImported?.standalone ?? false;
    if (parsed.kind !== "map" || !isOpenPushMap(parsed.map)) {
      if (standalone) {
        this.log.debug(`A push without OpenPush data (${parsed.kind}) was shown with the site name`);
        await this.show(fallbackDisplay(cfg, this.origin, this.hostname, this.now()));
      } else {
        this.log.trace("A push that is not OpenPush's was left to the site's own worker code");
      }
      return;
    }
    const map = parsed.map;
    const at = this.now();
    const n = buildNotification(map, cfg, this.origin, this.hostname, at);
    const display = displayFor(map, n, cfg, this.scope.Notification?.maxActions);

    if (n.id && (await this.isRepeat(n.id, at))) {
      if (await this.onScreen(n.id)) {
        this.log.debug("A repeated push is already on screen");
        return;
      }
      await this.show(display);
      return;
    }

    // Step 4: received.
    const pending: Promise<void>[] = [];
    if (n.id) pending.push(this.receipt("received", cfg, n.id));

    // Step 5: the focused SDK page may keep it off screen (not on Safari).
    let showIt = true;
    const focused = await this.focusedSdkPage(cfg);
    if (focused) {
      const answer = await askForeground(focused, n, {
        channel: this.scope.MessageChannel ? () => new this.scope.MessageChannel!() : undefined,
        setTimeout: (fn, ms) => this.scope.setTimeout(fn, ms),
        clearTimeout: (handle) => this.scope.clearTimeout(handle),
      });
      if (answer === false) {
        if (this.isSafari()) this.log.debug("Safari shows every push; the page's preventDefault was not applied");
        else showIt = false;
      }
    }

    // Step 6: display, confirmed, displayed webhook.
    if (showIt && (await this.show(display))) {
      if (n.id) pending.push(this.receipt("confirmed", cfg, n.id));
      pending.push(fireWebhook(this.fetch, this.log, "displayed", cfg, n, { url: n.url }));
    }

    // Step 7: page listeners.
    pending.push(this.broadcast(WORKER_TO_PAGE.received, { notification: n }));
    await Promise.all(pending);
  }

  /** True for a message id shown in the last 24 hours; otherwise remembers it. */
  private isRepeat(id: string, at: number): Promise<boolean> {
    return this.lockedCfg(async (cfg) => {
      if (seenRecently(cfg?.recent, id, at)) return true;
      await this.db.mergeCfg({ recent: remember(cfg?.recent, id, at), lastPush: { messageId: id, at, kind: "received" } });
      return false;
    }).catch(() => false);
  }

  private async onScreen(id: string): Promise<boolean> {
    try {
      const shown = await this.scope.registration.getNotifications();
      return shown.some((n) => isShownData(n.data) && n.data.mid === id);
    } catch {
      return false;
    }
  }

  private async focusedSdkPage(cfg: CfgRow | undefined): Promise<WindowClientLike | undefined> {
    const ids = cfg?.sdkClients ?? [];
    if (ids.length === 0) return undefined;
    return (await this.windows()).find((w) => w.focused && ids.includes(w.id));
  }

  // ----------------------------------------------------------------- click

  private async onClick(event: NotificationEventLike): Promise<void> {
    const shown = event.notification;
    const data = shown.data;
    if (!isShownData(data)) return;
    shown.close();
    const actionId = event.action ?? "";
    const cfg = await this.readCfg();
    const button = data.buttons.find((b) => b.id === actionId);
    const url = button?.url ?? data.url;
    const behavior = clickBehavior(cfg?.click);

    if (data.fallback) {
      await openTarget(this.scope.clients, url, behavior, this.origin, this.log);
      return;
    }

    // Step 1: clicked receipt, started before anything opens so it keeps its place in order.
    const pending: Promise<void>[] = [this.receipt("clicked", cfg, data.mid, actionId)];
    pending.push(this.rememberClick(data.mid));

    // Steps 2 to 4.
    let result: OpenResult = "none";
    if (opensNothing(url) && !this.isSafari()) this.log.debug("The click link only records the click; nothing opens");
    else result = await openTarget(this.scope.clients, url, behavior, this.origin, this.log);

    // Step 5: page listeners, and the click kept for the page it opened.
    const at = this.now();
    const notification: OpenPushNotification = notificationFromShown(shown, data);
    const payload: ClickPayload = { notification, result: { actionId, url }, clickId: `${data.mid}:${actionId}:${at}` };
    pending.push(this.broadcast(WORKER_TO_PAGE.click, payload));
    if (result === "opened" || result === "navigated") {
      const stored: StoredClick = { clickId: payload.clickId, at, payload };
      pending.push(this.db.put(STORE.clicks, ROW.lastClick, stored).catch(() => undefined));
    }

    // Step 6: clicked webhook.
    pending.push(fireWebhook(this.fetch, this.log, "clicked", cfg, notification, { url, actionId }));
    await Promise.all(pending);
  }

  private rememberClick(messageId: string): Promise<void> {
    if (!messageId) return Promise.resolve();
    const at = this.now();
    return this.lockedCfg(async () => {
      await this.db.mergeCfg({ lastPush: { messageId, at, kind: "clicked" } });
    }).catch(() => undefined);
  }

  // --------------------------------------------------------------- dismiss

  private async onClose(event: NotificationEventLike): Promise<void> {
    const shown = event.notification;
    const data = shown.data;
    if (!isShownData(data) || data.fallback) return;
    const cfg = await this.readCfg();
    const notification = notificationFromShown(shown, data);
    const pending: Promise<void>[] = [this.receipt("dismissed", cfg, data.mid)];
    pending.push(this.broadcast(WORKER_TO_PAGE.dismiss, { notification }));
    if (!this.isSafari()) pending.push(fireWebhook(this.fetch, this.log, "dismissed", cfg, notification, { url: data.url }));
    await Promise.all(pending);
  }

  // --------------------------------------------------- subscription change

  private async onSubscriptionChange(event: PushSubscriptionChangeEventLike): Promise<void> {
    const cfg = await this.readCfg();
    await handleSubscriptionChange(event, cfg, {
      db: this.db,
      fetch: this.fetch,
      log: this.log,
      now: this.now,
      pushManager: this.scope.registration.pushManager,
      permission: () => this.scope.Notification?.permission,
    });
  }

  // --------------------------------------------------------------- message

  private async onMessage(event: MessageEventLike): Promise<void> {
    if (!isWorkerMessage(event.data)) return;
    const { type, payload } = event.data;
    if (type === PAGE_TO_WORKER.config) {
      if (!isRecord(payload)) return;
      const patch: Partial<CfgRow> = {};
      for (const [key, value] of Object.entries(payload)) {
        if (value === undefined || key === "bootstrap" || (WORKER_OWNED_CFG as readonly string[]).includes(key)) continue;
        patch[key] = value;
      }
      const sourceId = typeof event.source?.id === "string" ? event.source.id : undefined;
      const live = sourceId ? (await this.windows()).map((w) => w.id) : [];
      await this.lockedCfg(async (cfg) => {
        if (sourceId) {
          const known = (cfg?.sdkClients ?? []).filter((id) => id !== sourceId && live.includes(id));
          patch.sdkClients = [...known, sourceId].slice(-MAX_SDK_CLIENTS);
        }
        await this.db.mergeCfg(patch);
      });
      if (isLogLevel(patch.logLevel)) this.log.setLevel(patch.logLevel);
      if (typeof patch.sdkKey === "string") this.log.addSecret(patch.sdkKey);
      if (typeof patch.deviceSecret === "string") this.log.addSecret(patch.deviceSecret);
      const current = this.scope.__openpushImported;
      if (current) this.scope.__openpushImported = marker(current.scriptURL, await this.db.readCfg().catch(() => undefined));
      return;
    }
    if (type === PAGE_TO_WORKER.logLevel) {
      const level = isRecord(payload) ? payload.level : undefined;
      if (!isLogLevel(level)) return;
      this.log.setLevel(level);
      await this.lockedCfg(async () => {
        await this.db.mergeCfg({ logLevel: level });
      });
    }
  }
}

/**
 * Sets `self.__openpushImported` and adds every listener, synchronously. A second import of the
 * script in the same worker does nothing.
 */
export function installWorker(scope: WorkerGlobalLike, now?: () => number): OpenPushWorker | undefined {
  if (scope.__openpushImported) return undefined;
  scope.__openpushImported = marker(scope.location.href);
  const worker = new OpenPushWorker(scope, now);
  worker.listen();
  return worker;
}
