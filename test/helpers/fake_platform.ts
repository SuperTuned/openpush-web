import { IDBFactory } from "fake-indexeddb";
import { vi, type Mock } from "vitest";
import type { PermissionValue, Platform, WindowLike } from "../../src/platform/types";
import type { StorageLike } from "../../src/storage/local";
import type { PagePushManager, RegistrationLike, ServiceWorkerContainerLike, WorkerLike } from "../../src/worker/registration";

export const SITE = "https://play.example.com";

export function bootstrapBody(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    app: "app-1",
    sdk_key: "sdk_key_abcdef123456",
    enabled: true,
    site: { origin: SITE, name: "Example Play", icon: `${SITE}/icon.png` },
    setup_type: "typical",
    web_push: { public_key: "BPUBLICKEY", key_id: "k1" },
    worker: { path: "/openpush-sw.js", scope: "/" },
    auto_resubscribe: true,
    keep_on_screen: true,
    click: { match: "exact", action: "navigate" },
    prompts: [],
    webhooks: { displayed: null, clicked: null, dismissed: null, cors: false },
    channels: { email: true, phone: false },
    languages: ["en"],
    move: { from_firebase: false },
    direct: { new_registrations: true },
    ...over,
  };
}

export function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  if (status === 304) return new Response(null, { status, headers });
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json", ...headers } });
}

export class FakeStorage implements StorageLike {
  readonly map = new Map<string, string>();
  readonly setItem = vi.fn((key: string, value: string) => {
    this.map.set(key, value);
  });
  readonly removeItem = vi.fn((key: string) => {
    this.map.delete(key);
  });
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
}

export function fakeWorker(scriptURL: string): WorkerLike & { postMessage: Mock<(message: unknown) => void> } {
  return { scriptURL, postMessage: vi.fn<(message: unknown) => void>() };
}

export function fakeRegistration(scope: string, scriptURL: string, pushManager?: PagePushManager): RegistrationLike {
  const reg: RegistrationLike = { scope, active: fakeWorker(scriptURL), waiting: null, installing: null };
  if (pushManager) reg.pushManager = pushManager;
  return reg;
}

export class FakeContainer implements ServiceWorkerContainerLike {
  registrations: RegistrationLike[] = [];
  failWith: unknown;
  /** Given to registrations this container creates (tests of the push lifecycle set it). */
  pushManager: PagePushManager | undefined;
  readonly register = vi.fn(async (scriptURL: string, options: { scope: string }) => {
    if (this.failWith) throw this.failWith;
    const reg = fakeRegistration(options.scope, scriptURL, this.pushManager);
    this.registrations = this.registrations.filter((r) => r.scope !== options.scope).concat(reg);
    return reg;
  });
  readonly getRegistration = vi.fn();
  async getRegistrations(): Promise<readonly RegistrationLike[]> {
    return this.registrations;
  }
}

export interface FakeOptions {
  href?: string;
  userAgent?: string;
  fetch?: (url: string, init?: RequestInit) => Promise<Response>;
  dataLayer?: unknown[];
  pushApi?: boolean;
  /** Browser permission; "default" when not given. */
  permission?: PermissionValue;
  /** What the browser prompt answers; "granted" when not given. */
  promptAnswer?: PermissionValue;
}

export interface Fake {
  platform: Platform;
  fetch: ReturnType<typeof vi.fn>;
  idb: IDBFactory;
  openSpy: ReturnType<typeof vi.spyOn>;
  storage: FakeStorage;
  container: FakeContainer;
  window: WindowLike & { dispatchEvent: ReturnType<typeof vi.fn> };
  /** Current browser permission; tests may change it. */
  permission: { value: PermissionValue; promptAnswer: PermissionValue };
  requestPermission: ReturnType<typeof vi.fn>;
  /** Simulates the page becoming visible again. */
  becomeVisible(): void;
  sink: { error: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn>; info: ReturnType<typeof vi.fn>; debug: ReturnType<typeof vi.fn> };
}

export const CHROME_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export function fakePlatform(options: FakeOptions = {}): Fake {
  const url = new URL(options.href ?? `${SITE}/`);
  const idb = new IDBFactory();
  const openSpy = vi.spyOn(idb, "open");
  const storage = new FakeStorage();
  const container = new FakeContainer();
  const fetch = vi.fn(options.fetch ?? (async () => jsonResponse(bootstrapBody(), 200, { ETag: '"v1"' })));
  const win = { dispatchEvent: vi.fn(() => true), dataLayer: options.dataLayer } as Fake["window"];
  const sink = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const pushApi = options.pushApi ?? true;
  const permission = { value: options.permission ?? ("default" as PermissionValue), promptAnswer: options.promptAnswer ?? ("granted" as PermissionValue) };
  const requestPermission = vi.fn(async () => {
    if (permission.value === "default") permission.value = permission.promptAnswer;
    return permission.value;
  });
  const visible: (() => void)[] = [];
  const platform: Platform = {
    fetch: (input, init) => fetch(input, init),
    timers: {
      setTimeout: (fn, ms) => setTimeout(fn, ms),
      clearTimeout: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    now: () => Date.now(),
    console: sink,
    location: () => ({ href: url.href, origin: url.origin, protocol: url.protocol, hostname: url.hostname, search: url.search }),
    navigator: () => ({ userAgent: options.userAgent ?? CHROME_UA, language: "en-GB", maxTouchPoints: 0 }),
    indexedDB: () => idb,
    localStorage: () => storage,
    serviceWorker: () => (pushApi ? container : undefined),
    hasPushManager: () => pushApi,
    hasNotification: () => pushApi,
    isStandalone: () => false,
    window: () => win,
    customEvent: (type, detail) => ({ type, detail }) as unknown as Event,
    notificationPermission: () => (pushApi ? permission.value : undefined),
    requestNotificationPermission: () => requestPermission(),
    onVisible: (listener) => {
      visible.push(listener);
    },
    timezone: () => "Europe/London",
  };
  const becomeVisible = (): void => visible.forEach((fn) => fn());
  return { platform, fetch, idb, openSpy, storage, container, window: win, sink, permission, requestPermission, becomeVisible };
}

/** Lets pending promise callbacks run. */
export async function flush(times = 20): Promise<void> {
  for (let i = 0; i < times; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}
