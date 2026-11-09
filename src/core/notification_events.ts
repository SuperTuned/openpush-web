/**
 * Page side of the worker messages: the click,
 * foreground lifecycle and dismiss listener registries, and the bridge that feeds them.
 */
import type { Logger } from "../log/logger";
import type { Timers } from "../net/queue";
import type {
  NotificationClickEvent,
  NotificationDismissEvent,
  NotificationWillDisplayEvent,
  OpenPushNotification,
} from "../notification";
import { ROW, STORE } from "../storage/idb";
import { isWorkerMessage, message, PAGE_TO_WORKER, WORKER_TO_PAGE, type ClickPayload } from "../worker/channel";
import type { ServiceWorkerContainerLike, WorkerMessageEventLike } from "../worker/registration";
import type { InitContext } from "./hooks";

export type ClickListener = (event: NotificationClickEvent) => void;
export type ForegroundLifecycleListener = (event: NotificationWillDisplayEvent) => void;
export type DismissListener = (event: NotificationDismissEvent) => void;
export type ReceivedListener = (notification: OpenPushNotification) => void;

/** The listener members of `OpenPush.Notifications`. */
export interface NotificationListenersApi {
  addClickListener(listener: ClickListener): void;
  removeClickListener(listener: ClickListener): void;
  addForegroundLifecycleListener(listener: ForegroundLifecycleListener): void;
  removeForegroundLifecycleListener(listener: ForegroundLifecycleListener): void;
  addDismissListener(listener: DismissListener): void;
  removeDismissListener(listener: DismissListener): void;
}

/** A page answers the worker within this time; the worker waits 1,000 ms. */
export const FOREGROUND_ANSWER_MS = 900;
/** How long the worker keeps a click for the page it opened. */
export const STORED_CLICK_MS = 60_000;

interface StoredClickRow {
  clickId?: unknown;
  at?: unknown;
  payload?: unknown;
}

function isClickPayload(value: unknown): value is ClickPayload {
  if (!value || typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  return typeof v.clickId === "string" && !!v.notification && typeof v.result === "object" && v.result !== null;
}

function hasNotification(value: unknown): value is { notification: OpenPushNotification } {
  return !!value && typeof value === "object" && !!(value as { notification?: unknown }).notification;
}

/** The listener registries. Each listener runs on its own; its errors are the site's and are logged. */
export class NotificationEvents implements NotificationListenersApi {
  private readonly clicks = new Set<ClickListener>();
  private readonly foreground = new Set<ForegroundLifecycleListener>();
  private readonly dismisses = new Set<DismissListener>();
  private readonly received = new Set<ReceivedListener>();

  constructor(private readonly log: Logger) {}

  addClickListener(listener: ClickListener): void {
    if (typeof listener === "function") this.clicks.add(listener);
  }

  removeClickListener(listener: ClickListener): void {
    this.clicks.delete(listener);
  }

  addForegroundLifecycleListener(listener: ForegroundLifecycleListener): void {
    if (typeof listener === "function") this.foreground.add(listener);
  }

  removeForegroundLifecycleListener(listener: ForegroundLifecycleListener): void {
    this.foreground.delete(listener);
  }

  addDismissListener(listener: DismissListener): void {
    if (typeof listener === "function") this.dismisses.add(listener);
  }

  removeDismissListener(listener: DismissListener): void {
    this.dismisses.delete(listener);
  }

  /** Internal: every push the worker received, for later modules. */
  addReceivedListener(listener: ReceivedListener): () => void {
    this.received.add(listener);
    return () => this.received.delete(listener);
  }

  emitClick(event: NotificationClickEvent): void {
    this.each(this.clicks, "click", (l) => l({ notification: event.notification, result: { ...event.result } }));
  }

  emitDismiss(notification: OpenPushNotification): void {
    this.each(this.dismisses, "dismiss", (l) => l({ notification }));
  }

  emitReceived(notification: OpenPushNotification): void {
    this.each(this.received, "received", (l) => l(notification));
  }

  /**
   * Runs the foreground listeners and calls `answer` once: true unless a listener called
   * `preventDefault()` without `display()`. After `preventDefault()`, `display()` may still come
   * within `FOREGROUND_ANSWER_MS`.
   */
  runForeground(notification: OpenPushNotification, answer: (display: boolean) => void, timers: Timers): void {
    let prevented = false;
    let displayed = false;
    let answered = false;
    let running = true;
    let timer: unknown;
    const reply = (display: boolean): void => {
      if (answered) return;
      answered = true;
      if (timer !== undefined) timers.clearTimeout(timer);
      answer(display);
    };
    const event: NotificationWillDisplayEvent = {
      notification,
      preventDefault: () => {
        prevented = true;
      },
      display: () => {
        displayed = true;
        if (prevented && !running) reply(true);
      },
    };
    this.each(this.foreground, "foreground", (l) => l(event));
    running = false;
    if (!prevented || displayed) {
      reply(true);
      return;
    }
    timer = timers.setTimeout(() => reply(false), FOREGROUND_ANSWER_MS);
  }

  private each<L>(set: Set<L>, name: string, call: (listener: L) => void): void {
    for (const listener of [...set]) {
      try {
        call(listener);
      } catch (error) {
        this.log.error(`A ${name} listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}

export interface WorkerBridgeDeps {
  events: NotificationEvents;
  log: Logger;
  timers: Timers;
  now: () => number;
  container: () => ServiceWorkerContainerLike | undefined;
}

/**
 * Listens to the worker. Clicks wait until `initialize` has resolved; then the click the worker
 * kept for the page it opened (if any, within 60 s) fires once, and is removed.
 */
export class WorkerBridge {
  private attached = false;
  private ready = false;
  private readonly heldClicks: ClickPayload[] = [];
  private readonly firedClicks = new Set<string>();

  constructor(private readonly deps: WorkerBridgeDeps) {}

  /** Starts listening (once). */
  attach(): void {
    if (this.attached) return;
    const container = this.deps.container();
    if (!container?.addEventListener) return;
    this.attached = true;
    try {
      container.addEventListener("message", (event) => this.onMessage(event));
      container.startMessages?.();
    } catch {
      this.deps.log.debug("Could not listen to the service worker");
    }
  }

  onMessage(event: WorkerMessageEventLike): void {
    const data = event.data;
    if (!isWorkerMessage(data)) return;
    const { events, timers } = this.deps;
    const payload = data.payload;
    switch (data.type) {
      case WORKER_TO_PAGE.foreground: {
        if (!hasNotification(payload)) return;
        const port = event.ports?.[0];
        events.runForeground(
          payload.notification,
          (display) => {
            try {
              port?.postMessage(message(PAGE_TO_WORKER.foregroundAnswer, { display }));
            } catch {
              // The worker stopped waiting.
            }
          },
          timers,
        );
        return;
      }
      case WORKER_TO_PAGE.click:
        if (!isClickPayload(payload)) return;
        if (this.ready) this.fireClick(payload);
        else this.heldClicks.push(payload);
        return;
      case WORKER_TO_PAGE.dismiss:
        if (hasNotification(payload)) events.emitDismiss(payload.notification);
        return;
      case WORKER_TO_PAGE.received:
        if (hasNotification(payload)) events.emitReceived(payload.notification);
        return;
      default:
        return;
    }
  }

  /** After `initialize`: the stored click for this page, then clicks that arrived meanwhile. */
  async afterInitialize(ctx: Pick<InitContext, "db">): Promise<void> {
    if (this.ready) return;
    try {
      const row = await ctx.db.get<StoredClickRow>(STORE.clicks, ROW.lastClick);
      if (row) {
        await ctx.db.delete(STORE.clicks, ROW.lastClick).catch(() => undefined);
        const at = typeof row.at === "number" ? row.at : 0;
        const age = this.deps.now() - at;
        if (age >= 0 && age <= STORED_CLICK_MS && isClickPayload(row.payload)) this.fireClick(row.payload);
      }
    } catch {
      this.deps.log.debug("Could not read the stored click");
    }
    this.ready = true;
    for (const held of this.heldClicks.splice(0)) this.fireClick(held);
  }

  private fireClick(payload: ClickPayload): void {
    if (this.firedClicks.has(payload.clickId)) return;
    this.firedClicks.add(payload.clickId);
    this.deps.events.emitClick({ notification: payload.notification, result: payload.result });
  }
}
