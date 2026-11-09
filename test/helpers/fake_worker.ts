import { IDBFactory } from "fake-indexeddb";
import { vi } from "vitest";
import { Db } from "../../src/storage/idb";
import type { CfgRow } from "../../src/storage/types";
import type {
  ExtendableEventLike,
  MessageChannelLike,
  MessagePortLike,
  NotificationLike,
  PushSubscriptionLike,
  ShowOptions,
  WindowClientLike,
  WorkerEventMap,
  WorkerGlobalLike,
} from "../../src/worker/sw_types";
import { CHROME_UA, jsonResponse, SITE } from "./fake_platform";

export const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
export const FIREFOX_UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:132.0) Gecko/20100101 Firefox/132.0";

export class FakePort implements MessagePortLike {
  onmessage: ((event: { data: unknown }) => void) | null = null;
  other: FakePort | undefined;
  readonly sent: unknown[] = [];
  postMessage(message: unknown): void {
    this.sent.push(message);
    const target = this.other;
    queueMicrotask(() => target?.onmessage?.({ data: message }));
  }
  close(): void {
    this.onmessage = null;
  }
}

export class FakeChannel implements MessageChannelLike {
  readonly port1 = new FakePort();
  readonly port2 = new FakePort();
  constructor() {
    this.port1.other = this.port2;
    this.port2.other = this.port1;
  }
}

export class FakeWindow implements WindowClientLike {
  readonly type = "window";
  readonly postMessage = vi.fn<(message: unknown, transfer?: unknown[]) => void>();
  readonly focus = vi.fn(async () => {
    this.focused = true;
    return this as WindowClientLike;
  });
  readonly navigate = vi.fn(async (url: string) => {
    if (!this.controlled) throw new TypeError("not controlled");
    this.url = url;
    return this as WindowClientLike;
  });
  constructor(
    public id: string,
    public url: string,
    public focused = false,
    public controlled = true,
  ) {}

  /** Messages of one protocol type this window got. */
  messages(type: string): { type: string; payload: unknown }[] {
    return this.postMessage.mock.calls
      .map((c) => c[0] as { type: string; payload: unknown })
      .filter((m) => m && m.type === type);
  }
}

export interface Shown {
  title: string;
  options: ShowOptions;
}

type Listener = (event: never) => void;

export class FakeScope implements WorkerGlobalLike {
  location: { href: string; origin: string; hostname: string };
  readonly listeners = new Map<string, Listener[]>();
  readonly shown: Shown[] = [];
  onScreen: NotificationLike[] = [];
  windows: FakeWindow[] = [];
  refuseOptions = false;
  readonly registration = {
    showNotification: vi.fn(async (title: string, options?: ShowOptions) => {
      if (this.refuseOptions && options?.actions) throw new TypeError("bad options");
      this.shown.push({ title, options: options ?? {} });
    }),
    getNotifications: vi.fn(async () => this.onScreen),
    pushManager: {
      subscribe: vi.fn(async (): Promise<PushSubscriptionLike> => fakeSubscription("https://fcm.googleapis.com/fcm/send/new-endpoint-12345678")),
      getSubscription: vi.fn(async () => null),
    },
  };
  readonly clients = {
    matchAll: vi.fn(async () => this.windows as readonly WindowClientLike[]),
    openWindow: vi.fn(async (url: string) => {
      const w = new FakeWindow(`opened-${this.windows.length}`, url, true);
      this.windows.push(w);
      return w as WindowClientLike;
    }),
    claim: vi.fn(async () => undefined),
  };
  readonly skipWaiting = vi.fn(async () => undefined);
  readonly addEventListener = vi.fn(<K extends keyof WorkerEventMap>(type: K, listener: (event: WorkerEventMap[K]) => void) => {
    const list = this.listeners.get(type) ?? [];
    list.push(listener as Listener);
    this.listeners.set(type, list);
  });
  navigator = { userAgent: CHROME_UA };
  indexedDB: IDBFactory = new IDBFactory();
  readonly fetch = vi.fn(async (_input: string, _init?: RequestInit) => jsonResponse({ accepted: 1, dropped: 0 }));
  Notification: { permission?: string; maxActions?: number } = { permission: "granted", maxActions: 2 };
  MessageChannel: (new () => MessageChannelLike) | undefined = FakeChannel;
  console = undefined;
  setTimeout = (fn: () => void, ms: number): unknown => setTimeout(fn, ms);
  clearTimeout = (handle: unknown): void => clearTimeout(handle as ReturnType<typeof setTimeout>);
  __openpushImported?: { scriptURL: string; standalone: boolean };

  constructor(scriptPath = "/openpush-sw.js") {
    const url = new URL(scriptPath, SITE);
    this.location = { href: url.href, origin: url.origin, hostname: url.hostname };
  }

  /** Fires an event at every listener of `type` and waits for everything passed to `waitUntil`. */
  async dispatch<K extends keyof WorkerEventMap>(type: K, fields: Omit<WorkerEventMap[K], "waitUntil">): Promise<WorkerEventMap[K]> {
    const waits: Promise<unknown>[] = [];
    const event = { ...fields, waitUntil: (p: Promise<unknown>) => waits.push(p) } as unknown as WorkerEventMap[K] & ExtendableEventLike;
    for (const listener of this.listeners.get(type) ?? []) (listener as (e: WorkerEventMap[K]) => void)(event);
    await Promise.all(waits);
    return event;
  }

  /** Requests the worker made to `path`, with parsed JSON bodies. */
  requests(path: string): { url: string; init: RequestInit; body: Record<string, unknown> }[] {
    return this.fetch.mock.calls
      .filter((c) => String(c[0]).includes(path))
      .map((c) => ({ url: String(c[0]), init: c[1] ?? {}, body: JSON.parse(String(c[1]?.body ?? "{}")) as Record<string, unknown> }));
  }
}

export function fakeSubscription(endpoint: string, key?: ArrayBuffer): PushSubscriptionLike {
  return {
    endpoint,
    options: { applicationServerKey: key ?? null },
    toJSON: () => ({ endpoint, expirationTime: null, keys: { p256dh: "BP256DH", auth: "AUTH" } }),
  };
}

/** A push event's data. `undefined` → no data. Objects are JSON-encoded; strings are sent as is. */
export function pushData(value: unknown): { data: { text(): string } | null } {
  if (value === undefined) return { data: null };
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return { data: { text: () => text } };
}

export function shownNotification(shown: Shown, close = vi.fn()): NotificationLike & { close: ReturnType<typeof vi.fn> } {
  return {
    title: shown.title,
    body: shown.options.body,
    icon: shown.options.icon,
    image: shown.options.image,
    badge: shown.options.badge,
    tag: shown.options.tag,
    data: shown.options.data,
    close,
  };
}

export const BASE_CFG: CfgRow = {
  app: "app-1",
  sdkKey: "sdk_key_abcdef123456",
  server: "https://api.example.com",
  publicKey: "BPUBLICKEY",
  keyId: "k1",
  token: "https://fcm.googleapis.com/fcm/send/old-endpoint-87654321",
  subscriptionId: "sub-1",
  deviceSecret: "device-secret-abcdef",
  click: { match: "exact", action: "navigate" },
  webhooks: { displayed: null, clicked: null, dismissed: null, cors: false },
  keepOnScreen: true,
  defaultUrl: `${SITE}/`,
  defaultTitle: "",
  siteName: "Example Play",
  siteIcon: `${SITE}/icon.png`,
  workerPath: "/openpush-sw.js",
  workerScope: "/",
  workerState: "ok",
};

export async function seedCfg(scope: FakeScope, cfg: CfgRow = BASE_CFG): Promise<Db> {
  const db = new Db(scope.indexedDB, () => true);
  await db.mergeCfg(cfg);
  return db;
}

export function opPush(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    op_v: "2",
    op_message_id: "msg_1",
    op_app: "app-1",
    title: "Spring sale",
    body: "Everything 20% off",
    deep_link: `${SITE}/sale`,
    ...over,
  };
}
