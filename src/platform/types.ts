import type { UserAgentDataLike } from "../env/browser";
import type { LogSink } from "../log/logger";
import type { FetchLike } from "../net/http";
import type { Timers } from "../net/queue";
import type { StorageLike } from "../storage/local";
import type { ServiceWorkerContainerLike } from "../worker/registration";

/** `Notification.permission` values. */
export type PermissionValue = "default" | "granted" | "denied";

export interface LocationLike {
  href: string;
  origin: string;
  protocol: string;
  hostname: string;
  search: string;
}

export interface NavigatorLike {
  userAgent: string;
  language?: string;
  maxTouchPoints?: number;
  userAgentData?: UserAgentDataLike;
}

/** The page's `window`, for the DOM event and the tag manager data layer. */
export interface WindowLike {
  dispatchEvent(event: Event): boolean;
  dataLayer?: unknown;
}

/**
 * Every browser API the page SDK touches, behind one interface so the logic runs with fakes in
 * tests and stays safe to import where there is no browser (server rendering).
 */
export interface Platform {
  fetch: FetchLike;
  timers: Timers;
  now(): number;
  console: LogSink | undefined;
  location(): LocationLike | undefined;
  navigator(): NavigatorLike | undefined;
  indexedDB(): IDBFactory | undefined;
  localStorage(): StorageLike | undefined;
  serviceWorker(): ServiceWorkerContainerLike | undefined;
  hasPushManager(): boolean;
  hasNotification(): boolean;
  /** Running as an installed (Home Screen) web app. */
  isStandalone(): boolean;
  window(): WindowLike | undefined;
  /** Builds the `openpush:initialized` event. */
  customEvent(type: string, detail: unknown): Event | undefined;
  /** `Notification.permission`; undefined when the browser has no Notification API. */
  notificationPermission(): PermissionValue | undefined;
  /**
   * Shows the browser's permission prompt. Call it straight from the person's gesture, before
   * any `await`, so browsers that require a gesture (Firefox, Safari, iOS) allow it.
   */
  requestNotificationPermission(): Promise<PermissionValue>;
  /** Calls `listener` each time a hidden page becomes visible again. */
  onVisible(listener: () => void): void;
  /** Calls `listener` each time the page becomes hidden (session time). */
  onHidden?(listener: () => void): void;
  /** The page is visible now. Without it, sessions count no visible time. */
  isVisible?(): boolean;
  /** The IANA time zone, when the browser says. */
  timezone(): string | undefined;
  /** The page document (prompts draw into it); undefined without a DOM. */
  document?(): Document | undefined;
  /** `history.replaceState` to `url` (the verify bar removes its parameter). */
  replaceUrl?(url: string): void;
  /** Calls `listener` when the page is left (prompts report `closed`). */
  onPageHide?(listener: () => void): void;
}
