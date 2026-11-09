/**
 * The `requestHeaders` option: extra headers the site adds to the SDK's requests to the OpenPush
 * server (registrations, opt-in and opt-out, user, session and event calls, receipts). The public
 * config request is left as it is.
 *
 * The page keeps a copy of the headers in IndexedDB (`cfg` store, row `headers`), because the
 * service worker sends receipts when no page is open and cannot call the site's function. The copy
 * follows the option: it is replaced when the headers change, and removed when the option is
 * removed or the user logs out. Header values never appear in a log line.
 */
import type { Logger } from "../log/logger";
import { ROW, STORE } from "../storage/idb";
import type { SdkDb } from "../storage/memory";
import { errorText, isRecord } from "../util/values";
import type { Timers } from "./queue";

export type HeaderMap = Record<string, string>;

/** Header names and text values, or a function (sync or async) that returns them. */
export type RequestHeadersOption = HeaderMap | (() => HeaderMap | Promise<HeaderMap>);

/** How long a request waits for the site's function before it goes without the extra headers. */
export const HEADERS_TIMEOUT_MS = 5_000;

/**
 * Headers the SDK sets itself, the REST API key (a secret that must never be in a web page), and
 * the names browsers do not let a page set.
 */
const RESERVED = new Set([
  "authorization",
  "content-type",
  "cookie",
  "host",
  "if-none-match",
  "origin",
  "x-op-api-key",
  "x-op-sdk-key",
  "accept-charset",
  "accept-encoding",
  "access-control-request-headers",
  "access-control-request-method",
  "connection",
  "content-length",
  "cookie2",
  "date",
  "dnt",
  "expect",
  "keep-alive",
  "referer",
  "set-cookie",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "via",
  "x-http-method",
  "x-http-method-override",
  "x-method-override",
]);
const RESERVED_PREFIX = /^(?:proxy-|sec-)/;
const TOKEN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const CONTROL = /[\u0000-\u0008\u000a-\u001f\u007f]/;

export function isRequestHeadersOption(value: unknown): value is RequestHeadersOption {
  return typeof value === "function" || isRecord(value);
}

/** A header name safe to show in a log line. */
function shown(name: string): string {
  return JSON.stringify(name.length > 40 ? `${name.slice(0, 40)}…` : name);
}

/**
 * The headers in `raw` the SDK may send. Anything else is left out with one warning per header
 * and reason; the warning names the header, never its value. Accepted values are hidden in logs.
 */
export function cleanHeaders(raw: unknown, log: Logger): HeaderMap {
  if (raw === undefined || raw === null) return {};
  if (!isRecord(raw)) {
    log.once(
      "request-headers:type",
      "warn",
      "requestHeaders must be an object of header names and text values, or a function that returns one; no extra headers were sent",
    );
    return {};
  }
  const out: HeaderMap = {};
  for (const [name, value] of Object.entries(raw)) {
    const lower = name.toLowerCase();
    let reason: string | undefined;
    if (!TOKEN.test(name)) reason = "it is not a valid header name";
    else if (RESERVED.has(lower) || RESERVED_PREFIX.test(lower)) reason = "the SDK or the browser sets this header";
    else if (typeof value !== "string") reason = "its value must be text";
    else if (CONTROL.test(value)) reason = "its value has a line break or another control character";
    if (reason) {
      log.once(`request-headers:${lower}:${reason}`, "warn", `requestHeaders: ${shown(name)} was not sent: ${reason}`);
      continue;
    }
    for (const kept of Object.keys(out)) if (kept.toLowerCase() === lower) delete out[kept];
    out[name] = value as string;
    log.addSecret(value as string);
  }
  return out;
}

/** The headers the page stored for the worker; empty when there are none. */
export async function storedHeaders(db: SdkDb, log: Logger): Promise<HeaderMap> {
  try {
    return cleanHeaders(await db.get<HeaderMap>(STORE.cfg, ROW.headers), log);
  } catch (error) {
    log.debug(`Could not read the stored request headers: ${errorText(error)}`);
    return {};
  }
}

const TIMED_OUT = Symbol("timed out");

export interface RequestHeadersDeps {
  option: RequestHeadersOption | undefined;
  db: SdkDb;
  log: Logger;
  timers: Timers;
}

/** The page side of `requestHeaders`: resolves the option for each request and keeps the copy. */
export class RequestHeaders {
  /** JSON of the copy last written ("" when removed); undefined when unknown. */
  private stored: string | undefined;
  private writes: Promise<void> = Promise.resolve();

  constructor(private readonly deps: RequestHeadersDeps) {}

  /** The headers for one request. Never rejects: a failing function means no extra headers. */
  async resolve(): Promise<HeaderMap> {
    const { option, log } = this.deps;
    if (option === undefined) return {};
    let raw: unknown = option;
    if (typeof option === "function") {
      try {
        raw = await this.withTimeout(Promise.resolve(option()));
      } catch {
        log.once("request-headers:failed", "warn", "requestHeaders: the function failed, so the request was sent without the extra headers");
        return {};
      }
      if (raw === TIMED_OUT) {
        log.once(
          "request-headers:timeout",
          "warn",
          `requestHeaders: the function did not answer within ${HEADERS_TIMEOUT_MS / 1000} seconds, so the request was sent without the extra headers`,
        );
        return {};
      }
    }
    const headers = cleanHeaders(raw, log);
    void this.keep(headers);
    return headers;
  }

  /** At `initialize`: the copy matches the option now (removed when the option is gone). */
  async sync(): Promise<void> {
    if (this.deps.option === undefined) await this.keep({});
    else await this.resolve();
    await this.writes;
  }

  /** Removes the copy (logout); the next request stores what the option gives then. */
  async clear(): Promise<void> {
    this.stored = undefined;
    await this.keep({});
  }

  private keep(headers: HeaderMap): Promise<void> {
    const json = Object.keys(headers).length > 0 ? JSON.stringify(headers) : "";
    if (json === this.stored) return this.writes;
    this.stored = json;
    const { db, log } = this.deps;
    this.writes = this.writes
      .then(() => (json ? db.put(STORE.cfg, ROW.headers, headers) : db.delete(STORE.cfg, ROW.headers)))
      .catch((error: unknown) => {
        this.stored = undefined;
        log.debug(`Could not store the request headers: ${errorText(error)}`);
      });
    return this.writes;
  }

  private withTimeout<T>(work: Promise<T>): Promise<T | typeof TIMED_OUT> {
    const { timers } = this.deps;
    return new Promise((resolve, reject) => {
      const handle = timers.setTimeout(() => resolve(TIMED_OUT), HEADERS_TIMEOUT_MS);
      work.then(
        (value) => {
          timers.clearTimeout(handle);
          resolve(value);
        },
        (error: unknown) => {
          timers.clearTimeout(handle);
          reject(error);
        },
      );
    });
  }
}
