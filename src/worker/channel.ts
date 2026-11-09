import type { LogLevel } from "../log/levels";
import type { NotificationClickEvent, OpenPushNotification } from "../notification";
import type { CfgRow } from "../storage/types";
import { PROTOCOL_VERSION } from "../version";
import type { RegistrationLike } from "./registration";

/** Message types the page posts to the worker. */
export const PAGE_TO_WORKER = {
  config: "openpush:config",
  logLevel: "openpush:log-level",
  /** The page's answer to `openpush:foreground`, on the reply port. */
  foregroundAnswer: "openpush:foreground-answer",
} as const;

/** Message types the worker posts to pages. */
export const WORKER_TO_PAGE = {
  /** To the focused SDK page, with a reply port; the page answers `{display}`. */
  foreground: "openpush:foreground",
  received: "openpush:received",
  click: "openpush:click",
  dismiss: "openpush:dismiss",
} as const;

export interface ForegroundPayload {
  notification: OpenPushNotification;
}

/** The page's answer on the reply port. */
export interface ForegroundAnswer {
  display: boolean;
}

export interface ClickPayload extends NotificationClickEvent {
  /** Identifies one click, so a page that gets it twice (message and stored click) fires once. */
  clickId: string;
}

export interface NotificationPayload {
  notification: OpenPushNotification;
}

export interface WorkerMessage<T extends string = string, P = unknown> {
  op: "openpush";
  v: typeof PROTOCOL_VERSION;
  type: T;
  payload: P;
}

/** True for a message in the OpenPush protocol, major version 2. */
export function isWorkerMessage(value: unknown): value is WorkerMessage {
  if (!value || typeof value !== "object") return false;
  const m = value as Record<string, unknown>;
  return m.op === "openpush" && m.v === PROTOCOL_VERSION && typeof m.type === "string";
}

export function message<T extends string, P>(type: T, payload: P): WorkerMessage<T, P> {
  return { op: "openpush", v: PROTOCOL_VERSION, type, payload };
}

/** The config the worker keeps in `cfg` (everything but the cached bootstrap). */
export function workerConfig(cfg: CfgRow): Omit<CfgRow, "bootstrap"> {
  const { bootstrap: _bootstrap, ...rest } = cfg;
  return rest;
}

/** Posts to whichever worker the registration has (active, waiting or installing). */
export function postToWorker(reg: RegistrationLike | undefined, msg: WorkerMessage): boolean {
  const worker = reg ? (reg.active ?? reg.waiting ?? reg.installing) : null;
  if (!worker) return false;
  try {
    worker.postMessage(msg);
    return true;
  } catch {
    return false;
  }
}

export function configMessage(cfg: CfgRow): WorkerMessage<typeof PAGE_TO_WORKER.config, Omit<CfgRow, "bootstrap">> {
  return message(PAGE_TO_WORKER.config, workerConfig(cfg));
}

export function logLevelMessage(level: LogLevel): WorkerMessage<typeof PAGE_TO_WORKER.logLevel, { level: LogLevel }> {
  return message(PAGE_TO_WORKER.logLevel, { level });
}
