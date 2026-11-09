import { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";
import type { WorkerState } from "../storage/types";

export interface WorkerLike {
  scriptURL: string;
  postMessage(message: unknown): void;
}

/** A browser push subscription as the page sees it. */
export interface PagePushSubscription {
  endpoint: string;
  expirationTime?: number | null;
  options?: { applicationServerKey?: ArrayBuffer | null };
  toJSON(): { endpoint?: string; expirationTime?: number | null; keys?: Record<string, string> };
  unsubscribe(): Promise<boolean>;
}

/** `registration.pushManager` as the page uses it. */
export interface PagePushManager {
  subscribe(options: { userVisibleOnly: boolean; applicationServerKey: BufferSource }): Promise<PagePushSubscription>;
  getSubscription(): Promise<PagePushSubscription | null>;
}

/** A shown notification, as `registration.getNotifications()` returns it. */
export interface ShownNotificationLike {
  tag?: string;
  data?: unknown;
  close(): void;
}

export interface RegistrationLike {
  scope: string;
  active: WorkerLike | null;
  waiting: WorkerLike | null;
  installing: WorkerLike | null;
  /** Present in browsers with the Push API. */
  pushManager?: PagePushManager;
  getNotifications?(filter?: { tag?: string }): Promise<readonly ShownNotificationLike[]>;
}

/** A message from the worker, as `navigator.serviceWorker` delivers it. */
export interface WorkerMessageEventLike {
  data: unknown;
  ports?: readonly { postMessage(message: unknown): void }[];
}

/** The parts of `navigator.serviceWorker` the SDK uses. `getRegistration(scope)` is never used. */
export interface ServiceWorkerContainerLike {
  getRegistrations(): Promise<readonly RegistrationLike[]>;
  register(scriptURL: string, options: { scope: string }): Promise<RegistrationLike>;
  addEventListener?(type: "message", listener: (event: WorkerMessageEventLike) => void): void;
  /** Delivers messages the worker posted before the page listened. */
  startMessages?(): void;
}

export type RegistrationFailure = "not_found" | "not_javascript" | "redirected" | "forbidden" | "scope_not_allowed" | "other";

export type WorkerResult =
  | { state: "ok"; registration: RegistrationLike; scriptURL: string; scope: string }
  | { state: Exclude<WorkerState, "ok">; error: OpenPushError };

/** An absolute URL ending in "/", relative values resolved against the page. */
export function normaliseScope(scope: string, base: string): string {
  const url = new URL(scope, base);
  url.search = "";
  url.hash = "";
  return url.href.endsWith("/") ? url.href : `${url.href}/`;
}

export function absoluteScript(path: string, base: string): string {
  return new URL(path, base).href;
}

function workerOf(reg: RegistrationLike): WorkerLike | null {
  return reg.active ?? reg.waiting ?? reg.installing;
}

function pathOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

/** Maps a browser registration error to `detail.reason` as well as the message allows. */
export function classifyRegistrationError(error: unknown): RegistrationFailure {
  const name = error && typeof error === "object" && "name" in error ? String((error as { name: unknown }).name) : "";
  const message = error && typeof error === "object" && "message" in error ? String((error as { message: unknown }).message) : String(error ?? "");
  if (/scope/i.test(message) && /max scope|not under|outside|allowed/i.test(message)) return "scope_not_allowed";
  if (/redirect/i.test(message)) return "redirected";
  if (/mime|content-type/i.test(message)) return "not_javascript";
  if (/\b404\b|not found/i.test(message)) return "not_found";
  if (/\b40[13]\b|forbidden|origin/i.test(message) || name === "SecurityError") return "forbidden";
  return "other";
}

/**
 * Registers the OpenPush worker. Another worker whose normalised scope equals ours
 * exactly, with a different script URL, blocks registration (`worker_scope_taken`). A worker at
 * a parent scope (a site's root PWA worker) never blocks.
 */
export async function registerWorker(
  container: ServiceWorkerContainerLike,
  pageHref: string,
  path: string,
  scope: string,
  log: Logger,
): Promise<WorkerResult> {
  const wantScope = normaliseScope(scope, pageHref);
  const wantScript = absoluteScript(path, pageHref);
  let existing: readonly RegistrationLike[] = [];
  try {
    existing = await container.getRegistrations();
  } catch {
    existing = [];
  }
  for (const reg of existing) {
    let regScope: string;
    try {
      regScope = normaliseScope(reg.scope, pageHref);
    } catch {
      continue;
    }
    if (regScope !== wantScope) continue;
    const worker = workerOf(reg);
    if (!worker || worker.scriptURL === wantScript) continue;
    const other = pathOf(worker.scriptURL);
    log.error(
      `Another service worker (${other}) already uses the scope ${pathOf(wantScope)}. OpenPush did not register ${pathOf(wantScript)}; ` +
        "add the OpenPush import line to that worker, or give OpenPush its own folder",
    );
    return {
      state: "taken",
      error: new OpenPushError("worker_scope_taken", `The scope ${pathOf(wantScope)} belongs to another service worker`, {
        scope: pathOf(wantScope),
        existing: other,
        configured: pathOf(wantScript),
      }),
    };
  }
  try {
    const registration = await container.register(wantScript, { scope: wantScope });
    log.debug(`Service worker registered: ${pathOf(wantScript)} (scope ${pathOf(wantScope)})`);
    return { state: "ok", registration, scriptURL: wantScript, scope: wantScope };
  } catch (error) {
    const reason = classifyRegistrationError(error);
    log.error(`Could not register the service worker ${pathOf(wantScript)} (${reason.replace(/_/g, " ")})`);
    return {
      state: reason === "not_found" ? "missing" : "error",
      error: new OpenPushError("worker_registration_failed", `The service worker ${pathOf(wantScript)} could not be registered`, {
        reason,
        path: pathOf(wantScript),
      }),
    };
  }
}
