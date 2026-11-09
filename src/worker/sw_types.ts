/**
 * The parts of the service worker global scope the worker code uses. The project compiles with
 * the DOM library, which has no worker event types, so they are declared here; tests build fakes
 * of the same shapes.
 */

export interface ExtendableEventLike {
  waitUntil(promise: Promise<unknown>): void;
}

export interface PushMessageDataLike {
  text(): string;
}

export interface PushEventLike extends ExtendableEventLike {
  data: PushMessageDataLike | null;
}

/** Options for `showNotification`, including the fields the DOM library leaves out. */
export interface ShowOptions {
  body?: string;
  icon?: string;
  image?: string;
  badge?: string;
  tag?: string;
  renotify?: boolean;
  requireInteraction?: boolean;
  silent?: boolean;
  actions?: { action: string; title: string; icon?: string }[];
  data?: unknown;
  timestamp?: number;
}

export interface NotificationLike {
  title: string;
  body?: string;
  icon?: string;
  image?: string;
  badge?: string;
  tag?: string;
  data?: unknown;
  close(): void;
}

export interface NotificationEventLike extends ExtendableEventLike {
  notification: NotificationLike;
  action?: string;
}

export interface PushSubscriptionLike {
  endpoint: string;
  options?: { applicationServerKey?: ArrayBuffer | null };
  toJSON(): { endpoint?: string; expirationTime?: number | null; keys?: Record<string, string> };
}

export interface PushManagerLike {
  subscribe(options: { userVisibleOnly: boolean; applicationServerKey: string | BufferSource }): Promise<PushSubscriptionLike>;
  getSubscription(): Promise<PushSubscriptionLike | null>;
}

export interface PushSubscriptionChangeEventLike extends ExtendableEventLike {
  oldSubscription?: PushSubscriptionLike | null;
  newSubscription?: PushSubscriptionLike | null;
}

export interface MessagePortLike {
  onmessage: ((event: { data: unknown }) => void) | null;
  postMessage(message: unknown): void;
  close?(): void;
}

export interface MessageChannelLike {
  port1: MessagePortLike;
  port2: MessagePortLike;
}

export interface ClientLike {
  id: string;
  url: string;
  type?: string;
  postMessage(message: unknown, transfer?: unknown[]): void;
}

export interface WindowClientLike extends ClientLike {
  focused: boolean;
  focus(): Promise<WindowClientLike>;
  navigate(url: string): Promise<WindowClientLike | null>;
}

export interface ClientsLike {
  matchAll(options: { type: "window"; includeUncontrolled: boolean }): Promise<readonly WindowClientLike[]>;
  openWindow(url: string): Promise<WindowClientLike | null>;
  claim(): Promise<void>;
}

export interface MessageEventLike extends ExtendableEventLike {
  data: unknown;
  source?: { id?: string } | null;
}

export interface RegistrationScopeLike {
  showNotification(title: string, options?: ShowOptions): Promise<void>;
  getNotifications(filter?: { tag?: string }): Promise<readonly NotificationLike[]>;
  pushManager: PushManagerLike;
}

/** What `openpush-sw.js` sets on the worker global. */
export interface ImportedMarker {
  scriptURL: string;
  standalone: boolean;
}

type Listener<E> = (event: E) => void;

export interface WorkerEventMap {
  push: PushEventLike;
  notificationclick: NotificationEventLike;
  notificationclose: NotificationEventLike;
  pushsubscriptionchange: PushSubscriptionChangeEventLike;
  message: MessageEventLike;
  install: ExtendableEventLike;
  activate: ExtendableEventLike;
}

export interface WorkerGlobalLike {
  location: { href: string; origin: string; hostname: string };
  registration: RegistrationScopeLike;
  clients: ClientsLike;
  skipWaiting(): Promise<void>;
  addEventListener<K extends keyof WorkerEventMap>(type: K, listener: Listener<WorkerEventMap[K]>): void;
  navigator?: { userAgent?: string };
  indexedDB?: IDBFactory;
  fetch(input: string, init?: RequestInit): Promise<Response>;
  Notification?: { permission?: string; maxActions?: number };
  MessageChannel?: new () => MessageChannelLike;
  console?: Console;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  __openpushImported?: ImportedMarker;
}
