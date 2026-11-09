/**
 * Push payload normalisation. A direct push is the `op_*` data
 * map itself; a legacy Firebase push wraps the same map in an envelope's `data`.
 */
import type { NotificationButton, OpenPushNotification } from "../notification";
import type { CfgRow } from "../storage/types";
import type { PushMessageDataLike } from "./sw_types";
import { resolveUrl } from "./urls";
import { isRecord } from "../util/values";

/** The OpenPush message id key (`server/send.py` `payload_for`). */
export const MESSAGE_ID_KEY = "op_message_id";
/** Marks an OpenPush push. */
export const PAYLOAD_VERSION_KEY = "op_v";

export type PushMap = Record<string, unknown>;

export type ParsedPush =
  | { kind: "empty" }
  /** Not JSON. */
  | { kind: "malformed" }
  /** JSON, but not an object (a string, number or list). */
  | { kind: "raw" }
  | { kind: "map"; map: PushMap; envelope: "firebase" | "direct" };

const ENVELOPE_FIELDS = ["from", "fcmMessageId", "collapse_key"] as const;
/** Payload keys with a meaning of their own; everything else (not `op_*`) is custom data. */
const RESERVED_KEYS = new Set(["title", "body", "deep_link", "image_url"]);
const MAX_BUTTONS = 2;
const BUTTON_ID = /^[A-Za-z0-9_-]{1,32}$/;


/** Step 1: parse, and unwrap a Firebase envelope (`data` plus `from`, `fcmMessageId` or `collapse_key`). */
export function parsePush(data: PushMessageDataLike | null | undefined): ParsedPush {
  if (!data) return { kind: "empty" };
  let text: string;
  try {
    text = data.text();
  } catch {
    return { kind: "malformed" };
  }
  if (text.trim() === "") return { kind: "empty" };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { kind: "malformed" };
  }
  if (!isRecord(json)) return { kind: "raw" };
  if (isRecord(json.data) && ENVELOPE_FIELDS.some((field) => field in json)) {
    return { kind: "map", map: json.data, envelope: "firebase" };
  }
  return { kind: "map", map: json, envelope: "direct" };
}

/** Step 2: a push is OpenPush's only when its map carries `op_v` or the message id key. */
export function isOpenPushMap(map: PushMap): boolean {
  return text(map[PAYLOAD_VERSION_KEY]) !== "" || text(map[MESSAGE_ID_KEY]) !== "";
}

/** A payload value as a trimmed string; "" when absent or not a string or number. */
export function text(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

/** The message's custom data: every key that is not an OpenPush key. */
export function customData(map: PushMap): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(map)) {
    if (key.startsWith("op_") || RESERVED_KEYS.has(key)) continue;
    out[key] = value;
  }
  return out;
}

interface RawButton {
  id: string;
  label: string;
  url: string;
  icon: string;
}

/** `op_web_buttons` (compact JSON, or a list): at most 2, each with a label. `op_actions` is never read. */
export function readButtons(value: unknown): RawButton[] {
  let list = value;
  if (typeof list === "string") {
    try {
      list = JSON.parse(list);
    } catch {
      return [];
    }
  }
  if (!Array.isArray(list)) return [];
  const out: RawButton[] = [];
  const ids = new Set<string>();
  for (const item of list) {
    if (out.length >= MAX_BUTTONS) break;
    if (!isRecord(item)) continue;
    const label = text(item.label) || text(item.title);
    if (!label) continue;
    let id = text(item.id);
    if (!BUTTON_ID.test(id) || ids.has(id)) id = `b${out.length + 1}`;
    if (ids.has(id)) id = `b${out.length + 1}_${ids.size}`;
    ids.add(id);
    out.push({ id, label, url: text(item.url), icon: text(item.icon) });
  }
  return out;
}

/** Title after defaults: the push title, else `defaultTitle`, else the site name. Never empty. */
export function titleFor(map: PushMap, cfg: CfgRow | undefined, hostname: string): string {
  return text(map.title) || text(cfg?.defaultTitle) || text(cfg?.siteName) || hostname || "Notification";
}

/** Builds the notification object from a map that `isOpenPushMap` accepted. */
export function buildNotification(map: PushMap, cfg: CfgRow | undefined, origin: string, hostname: string, now: number): OpenPushNotification {
  const deepLink = map.deep_link;
  const defaultUrl = cfg?.defaultUrl;
  const buttons: NotificationButton[] = readButtons(map.op_web_buttons).map((b) => {
    const button: NotificationButton = { id: b.id, title: b.label, url: resolveUrl([b.url, deepLink, defaultUrl], origin) };
    if (b.icon) button.icon = b.icon;
    return button;
  });
  return {
    id: text(map[MESSAGE_ID_KEY]),
    title: titleFor(map, cfg, hostname),
    body: text(map.body),
    icon: text(map.op_web_icon) || null,
    image: text(map.op_web_image) || null,
    badge: text(map.op_web_badge) || null,
    url: resolveUrl([deepLink, defaultUrl], origin),
    buttons,
    topic: text(map.op_web_topic) || text(map.op_web_tag) || null,
    data: customData(map),
    receivedAt: now,
  };
}
