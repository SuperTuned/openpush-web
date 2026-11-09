import type { ServiceWorkerContainerLike } from "../worker/registration";
import type { LocationLike, NavigatorLike, PermissionValue, Platform, WindowLike } from "./types";

type Global = typeof globalThis & {
  navigator?: Navigator & { standalone?: boolean; userAgentData?: NavigatorLike["userAgentData"] };
  location?: Location;
  indexedDB?: IDBFactory;
  localStorage?: Storage;
  PushManager?: unknown;
  Notification?: {
    permission?: string;
    requestPermission?: (callback?: (value: string) => void) => Promise<string> | undefined;
  };
  document?: { visibilityState?: string; addEventListener?: (type: string, listener: () => void) => void };
  matchMedia?: (query: string) => { matches: boolean };
  CustomEvent?: typeof CustomEvent;
  dispatchEvent?: (event: Event) => boolean;
  addEventListener?: (type: string, listener: () => void) => void;
  history?: { state: unknown; replaceState(state: unknown, unused: string, url: string): void };
};

const g = globalThis as Global;

function safe<T>(read: () => T): T | undefined {
  try {
    return read();
  } catch {
    return undefined;
  }
}

function asPermission(value: unknown): PermissionValue {
  return value === "granted" || value === "denied" ? value : "default";
}

/** `Notification.requestPermission`, promise or (older Safari) callback form. */
function requestPermission(): Promise<PermissionValue> {
  const api = g.Notification;
  if (!api?.requestPermission) return Promise.resolve(asPermission(api?.permission));
  return new Promise<PermissionValue>((resolve, reject) => {
    let settled = false;
    const done = (value: unknown): void => {
      if (settled) return;
      settled = true;
      resolve(asPermission(value));
    };
    try {
      const result = api.requestPermission?.(done);
      if (result && typeof result.then === "function") result.then(done, reject);
    } catch (error) {
      reject(error);
    }
  });
}

function onVisibility(visible: boolean, listener: () => void): void {
  safe(() =>
    g.document?.addEventListener?.("visibilitychange", () => {
      if ((g.document?.visibilityState === "visible") === visible) listener();
    }),
  );
}

/** The real browser. Every access is lazy and guarded. */
export function browserPlatform(): Platform {
  return {
    fetch: (input, init) => g.fetch(input, init),
    timers: {
      setTimeout: (fn, ms) => g.setTimeout(fn, ms),
      clearTimeout: (handle) => g.clearTimeout(handle as ReturnType<typeof setTimeout>),
    },
    now: () => Date.now(),
    console: typeof console === "undefined" ? undefined : console,
    location: () => safe(() => g.location as LocationLike | undefined),
    navigator: () => safe(() => g.navigator as NavigatorLike | undefined),
    indexedDB: () => safe(() => g.indexedDB),
    localStorage: () => safe(() => g.localStorage),
    serviceWorker: () => safe(() => g.navigator?.serviceWorker as unknown as ServiceWorkerContainerLike | undefined),
    hasPushManager: () => safe(() => typeof g.PushManager !== "undefined") === true,
    hasNotification: () => safe(() => typeof g.Notification !== "undefined") === true,
    isStandalone: () =>
      safe(
        () =>
          g.navigator?.standalone === true ||
          !!g.matchMedia?.("(display-mode: standalone)").matches ||
          !!g.matchMedia?.("(display-mode: fullscreen)").matches,
      ) === true,
    window: () => (typeof g.dispatchEvent === "function" ? (g as unknown as WindowLike) : undefined),
    customEvent: (type, detail) => safe(() => (g.CustomEvent ? new g.CustomEvent(type, { detail }) : undefined)),
    notificationPermission: () => safe(() => (g.Notification ? asPermission(g.Notification.permission) : undefined)),
    requestNotificationPermission: () => requestPermission(),
    onVisible: (listener) => onVisibility(true, listener),
    onHidden: (listener) => onVisibility(false, listener),
    isVisible: () => safe(() => g.document?.visibilityState) !== "hidden",
    timezone: () => safe(() => Intl.DateTimeFormat().resolvedOptions().timeZone) || undefined,
    document: () => safe(() => (g as { document?: Document }).document),
    replaceUrl: (url) => safe(() => g.history?.replaceState(g.history.state, "", url)),
    onPageHide: (listener) => safe(() => g.addEventListener?.("pagehide", listener)),
  };
}
