/** Display fields and the data kept on a shown notification for click and dismiss. */
import type { NotificationButton, OpenPushNotification } from "../notification";
import type { CfgRow } from "../storage/types";
import { text, titleFor, type PushMap } from "./payload";
import { isRecord } from "../util/values";
import type { NotificationLike, ShowOptions } from "./sw_types";
import { resolveUrl } from "./urls";

/**
 * Send time, when the payload carries it (seconds or milliseconds since the epoch). The server
 * does not send it yet; the notification then has no `timestamp`.
 */
export const SENT_AT_KEY = "op_sent_at";

/** `data` of a notification OpenPush showed. `op` tells OpenPush's notifications from the site's own. */
export interface ShownData {
  op: "openpush";
  mid: string;
  url: string;
  buttons: NotificationButton[];
  topic: string | null;
  custom: Record<string, unknown>;
  receivedAt: number;
  /** The site-name notification a standalone worker shows for data it cannot read. */
  fallback?: boolean;
}

export interface Display {
  title: string;
  options: ShowOptions;
}

export function isShownData(value: unknown): value is ShownData {
  return isRecord(value) && value.op === "openpush" && typeof value.mid === "string" && typeof value.url === "string";
}

function flag(map: PushMap, key: string): boolean {
  return text(map[key]) === "1";
}

/** `"1"` → true, `"0"` → false, absent → the site's Keep on screen setting (default on). */
export function requireInteraction(map: PushMap, cfg: CfgRow | undefined): boolean {
  const value = text(map.op_web_require_interaction);
  if (value === "1") return true;
  if (value === "0") return false;
  return cfg?.keepOnScreen ?? true;
}

function sentAt(map: PushMap): number | undefined {
  const raw = map[SENT_AT_KEY];
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : Number.NaN;
  if (!Number.isFinite(n) || n <= 0) return undefined;
  return n < 1e12 ? Math.round(n * 1000) : Math.round(n);
}

/** Title and `showNotification` options for an OpenPush push. */
export function displayFor(map: PushMap, n: OpenPushNotification, cfg: CfgRow | undefined, maxActions?: number): Display {
  const options: ShowOptions = { body: n.body, requireInteraction: requireInteraction(map, cfg) };
  const icon = n.icon ?? (text(cfg?.siteIcon) || null);
  if (icon) options.icon = icon;
  if (n.image) options.image = n.image;
  if (n.badge) options.badge = n.badge;
  const tag = text(map.op_web_tag) || text(map.op_web_topic) || n.id;
  if (tag) {
    options.tag = tag;
    options.renotify = flag(map, "op_web_renotify");
  }
  if (flag(map, "op_web_silent")) options.silent = true;
  const limit = typeof maxActions === "number" && maxActions >= 0 ? Math.min(maxActions, 2) : 2;
  const actions = n.buttons.slice(0, limit).map((b) => (b.icon ? { action: b.id, title: b.title, icon: b.icon } : { action: b.id, title: b.title }));
  if (actions.length > 0) options.actions = actions;
  const timestamp = sentAt(map);
  if (timestamp !== undefined) options.timestamp = timestamp;
  const data: ShownData = {
    op: "openpush",
    mid: n.id,
    url: n.url,
    buttons: n.buttons.map((b) => ({ ...b })),
    topic: n.topic,
    custom: { ...n.data },
    receivedAt: n.receivedAt,
  };
  options.data = data;
  return { title: n.title, options };
}

/** The bare options used when the browser refuses the full set: the must-show rule still holds. */
export function plainDisplay(display: Display): Display {
  const { body, tag, data, icon } = display.options;
  const options: ShowOptions = { body, data };
  if (tag) options.tag = tag;
  if (icon) options.icon = icon;
  return { title: display.title, options };
}

/** The site-name notification for data a standalone worker cannot read. */
export function fallbackDisplay(cfg: CfgRow | undefined, origin: string, hostname: string, now: number): Display {
  const data: ShownData = {
    op: "openpush",
    mid: "",
    url: resolveUrl([cfg?.defaultUrl], origin),
    buttons: [],
    topic: null,
    custom: {},
    receivedAt: now,
    fallback: true,
  };
  const options: ShowOptions = { data };
  const icon = text(cfg?.siteIcon);
  if (icon) options.icon = icon;
  return { title: titleFor({}, { siteName: cfg?.siteName }, hostname), options };
}

/** Rebuilds the notification object from a shown notification (click and dismiss). */
export function notificationFromShown(shown: NotificationLike, data: ShownData): OpenPushNotification {
  return {
    id: data.mid,
    title: shown.title,
    body: shown.body ?? "",
    icon: shown.icon || null,
    image: shown.image || null,
    badge: shown.badge || null,
    url: data.url,
    buttons: data.buttons,
    topic: data.topic,
    data: data.custom,
    receivedAt: data.receivedAt,
  };
}
