/**
 * Request bodies for `POST /v1/apps/{app}/subscriptions` with `platform: "web"`.
 * Pure: every value comes in through the arguments.
 */
import type { BrowserInfo, BrowserName } from "../env/browser";
import type { ResolvedWelcome } from "../core/options";
import { hash32 } from "../util/hash";
import { SDK_VERSION } from "../version";

export type RequestBody = Record<string, unknown>;

/**
 * Every key a web registration with a push subscription may carry. Nothing else is
 * ever sent. `external_id`, `external_id_auth_hash`, `tags` and `aliases` are filled by the user
 * module through `BodyContributor`s; `verify_code` by the verify bar.
 */
export const REGISTRATION_KEYS = [
  "platform",
  "subscription",
  "vapid_key_id",
  "browser",
  "language",
  "timezone",
  "country",
  "sdk_version",
  "sdk_wrapper",
  "status",
  "external_id",
  "external_id_auth_hash",
  "tags",
  "aliases",
  "previous_token",
  "subscription_id",
  "device_secret",
  "opt_in",
  "verify_code",
  "welcome",
] as const;

/** The keys a body contributor may add. */
export const CONTRIBUTED_KEYS = ["external_id", "external_id_auth_hash", "tags", "aliases", "verify_code"] as const;
export type ContributedKey = (typeof CONTRIBUTED_KEYS)[number];

/** Adds identity, tags, aliases or a verify code to a registration body (later modules). */
export type BodyContributor = () => Partial<Record<ContributedKey, unknown>> | undefined;

/** The browser and locale fields of every registration. */
export interface DeviceFields {
  browser: BrowserInfo;
  /** BCP-47 tag, for example "en-GB". */
  language: string;
  timezone?: string;
  /** `sdk_wrapper`, set by a framework wrapper ("react/1.2.0"). */
  sdkWrapper?: string;
}

export interface SubscriptionJson {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

/** The proof of an earlier push identity of this browser. */
export interface PreviousIdentity {
  token: string;
  subscriptionId?: string;
  deviceSecret?: string;
}

export interface SubscriptionBodyInput {
  subscription: SubscriptionJson;
  vapidKeyId?: string;
  status: number;
  device: DeviceFields;
  /** Moves and token changes. */
  previous?: PreviousIdentity;
  /** The row's device secret, when this browser has one and the body is for that row. */
  deviceSecret?: string;
  /** Only when the person acts in this moment. */
  optIn?: boolean;
  /** Custom code only. */
  welcome?: ResolvedWelcome | null;
  contributors?: readonly BodyContributor[];
}

/** Chromium browsers the server does not name count as Chrome. */
export function reportedBrowserName(name: BrowserName): string {
  return name === "opera" || name === "samsung" ? "chrome" : name;
}

/** `language` (primary subtag) and `country` (region subtag), from the language tag, as v1 did. */
export function localeFields(tag: string): { language?: string; country?: string } {
  const parts = tag.replace(/_/g, "-").split("-").filter((p) => p !== "");
  const out: { language?: string; country?: string } = {};
  const primary = parts[0];
  if (primary && /^[A-Za-z]{2,3}$/.test(primary)) out.language = primary.toLowerCase();
  const region = parts.slice(1).find((p) => /^[A-Za-z]{2}$/.test(p) || /^\d{3}$/.test(p));
  if (region) out.country = region.toUpperCase();
  return out;
}

/** The subscription as the server wants it: endpoint, expiration time and both keys. */
export function subscriptionJson(sub: { toJSON(): { endpoint?: string; expirationTime?: number | null; keys?: Record<string, string> } }): SubscriptionJson {
  const json = sub.toJSON();
  const p256dh = json.keys?.p256dh;
  const auth = json.keys?.auth;
  if (!json.endpoint || !p256dh || !auth) throw new Error("The push subscription has no endpoint or keys");
  return { endpoint: json.endpoint, expirationTime: json.expirationTime ?? null, keys: { p256dh, auth } };
}

function deviceBody(device: DeviceFields): RequestBody {
  const body: RequestBody = {
    browser: {
      name: reportedBrowserName(device.browser.name),
      version: device.browser.version,
      os: device.browser.os,
      os_version: device.browser.os_version,
      standalone: device.browser.standalone,
    },
  };
  const locale = localeFields(device.language);
  if (locale.language) body.language = locale.language;
  if (device.timezone) body.timezone = device.timezone;
  if (locale.country) body.country = locale.country;
  body.sdk_version = SDK_VERSION;
  if (device.sdkWrapper) body.sdk_wrapper = device.sdkWrapper;
  return body;
}

function contributed(contributors: readonly BodyContributor[] | undefined): RequestBody {
  const out: RequestBody = {};
  for (const contribute of contributors ?? []) {
    const fields = contribute();
    if (!fields) continue;
    for (const key of CONTRIBUTED_KEYS) {
      if (fields[key] !== undefined) out[key] = fields[key];
    }
  }
  return out;
}

/** A registration with a push subscription. */
export function subscriptionBody(input: SubscriptionBodyInput): RequestBody {
  const body: RequestBody = { platform: "web", subscription: input.subscription };
  if (input.vapidKeyId) body.vapid_key_id = input.vapidKeyId;
  Object.assign(body, deviceBody(input.device));
  body.status = input.status;
  Object.assign(body, contributed(input.contributors));
  if (input.previous) {
    body.previous_token = input.previous.token;
    if (input.previous.subscriptionId) body.subscription_id = input.previous.subscriptionId;
    if (input.previous.deviceSecret) body.device_secret = input.previous.deviceSecret;
  }
  if (input.deviceSecret && body.device_secret === undefined) body.device_secret = input.deviceSecret;
  if (input.optIn === true) body.opt_in = true;
  if (input.welcome) {
    body.welcome = {
      enabled: input.welcome.enabled,
      title: input.welcome.title,
      message: input.welcome.message,
      url: input.welcome.url,
    };
  }
  return body;
}

/**
 * A status change for the row by its token, without a subscription: permission lost
 * (`status: 0`) or an opt-out (`status: -2`). Never `opt_in`.
 */
export function tokenBody(token: string, status: 0 | -2, device: DeviceFields, deviceSecret?: string): RequestBody {
  const body: RequestBody = { platform: "web", token, ...deviceBody(device), status };
  if (deviceSecret) body.device_secret = deviceSecret;
  return body;
}

/** A failed silent move. The server counts it; nothing else changes. */
export function moveFailedBody(previous: PreviousIdentity, error: string): RequestBody {
  const body: RequestBody = { platform: "web", previous_token: previous.token };
  if (previous.subscriptionId) body.subscription_id = previous.subscriptionId;
  if (previous.deviceSecret) body.device_secret = previous.deviceSecret;
  body.move_failed = { error: errorName(error) };
  body.sdk_version = SDK_VERSION;
  return body;
}

/** An error name the server accepts: letters, digits and `_.:-`, at most 64 characters. */
export function errorName(value: unknown): string {
  const raw =
    value && typeof value === "object" && "name" in value && typeof (value as { name: unknown }).name === "string"
      ? (value as { name: string }).name
      : typeof value === "string"
        ? value
        : "";
  const clean = raw.replace(/[^A-Za-z0-9_.:-]/g, "").slice(0, 64);
  return clean || "UnknownError";
}

/**
 * The fields whose change makes page-load reconciliation register again: the
 * browser's, and the user's (identity, tags and aliases set since the last accepted one).
 */
const FINGERPRINT_KEYS = [
  "subscription",
  "token",
  "vapid_key_id",
  "status",
  "browser",
  "language",
  "timezone",
  "country",
  "sdk_version",
  "sdk_wrapper",
  "external_id",
  "external_id_auth_hash",
  "tags",
  "aliases",
];

/** A short hash of what a registration says about the browser; stored, never sent. */
export function fingerprint(body: RequestBody): string {
  const picked = FINGERPRINT_KEYS.map((key) => [key, body[key] ?? null]);
  return hash32(JSON.stringify(picked));
}
