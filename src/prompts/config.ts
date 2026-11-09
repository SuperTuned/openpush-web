/**
 * Prompt definitions, read from the console list or `initialize({prompts})`. Each entry is
 * `{id, type, enabled, timing, wording, ...type options}`. Bad values fall back to defaults; an
 * entry of an unknown type is skipped. At most one prompt of each type, except `button` (up to 5
 * distinct placements).
 */
import type { PromptType } from "./types";

export interface Timing {
  /** False: only through `Prompts.*` (or, for the bell and buttons, their own placement). */
  auto: boolean;
  pageViews: number;
  seconds: number;
}

/** Wording overrides: language code → wording key → text. */
export type WordingOverrides = Record<string, Record<string, string>>;

interface Base {
  id: string;
  enabled: boolean;
  timing: Timing;
  wording: WordingOverrides;
}

export interface Topic {
  tag: string;
  label: string;
}

export interface SlideInDef extends Base {
  type: "slide_in";
  topics: Topic[];
  /** Desktop position; on phones it is always the bottom. */
  position: "top" | "bottom";
  /** On iPhone and iPad tabs, show how to add the site to the Home Screen. */
  iosHomeScreen: boolean;
}

export interface BellDef extends Base {
  type: "bell";
  position: "bottom-left" | "bottom-right";
  offset: { bottom: number; side: number };
  size: "small" | "medium" | "large";
  colors: { main?: string; accent?: string };
  hideWhenSubscribed: boolean;
}

export interface ButtonDef extends Base {
  type: "button";
  style: "button" | "link";
  size: "small" | "medium" | "large";
  colors: { background?: string; text?: string };
  allowUnsubscribe: boolean;
  placement: string;
}

export interface BrowserDef extends Base {
  type: "browser";
}

export interface EmailPhoneDef extends Base {
  type: "email_phone";
  fields: "email" | "phone" | "both";
  /** The consent line shown under the inputs; required. */
  consent: string;
}

export type PromptDef = SlideInDef | BellDef | ButtonDef | BrowserDef | EmailPhoneDef;

export const MAX_TOPICS = 10;
export const MAX_BUTTONS = 5;
export const CONSENT_LIMIT = 300;
const TAG_KEY = /^[A-Za-z0-9_.-]{1,60}$/;
const LANGUAGE = /^[A-Za-z]{2,3}(?:[-_][A-Za-z0-9]{2,8})*$/;
/** Colours the prompt style accepts: hex, rgb(a), hsl(a) or a colour name. */
const COLOR = /^(?:#[0-9a-f]{3,8}|(?:rgb|hsl)a?\([\d\s.,%/deg]+\)|[a-z]{3,20})$/i;

function rec(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function str(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value.trim() : fallback;
}

function int(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : typeof value === "string" && value.trim() !== "" ? Number(value) : NaN;
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}

export function color(value: unknown): string | undefined {
  const v = str(value);
  return v && COLOR.test(v) ? v : undefined;
}

function timingOf(value: unknown): Timing {
  const t = rec(value);
  return { auto: t.auto !== false, pageViews: int(t.page_views, 1, 50, 1), seconds: int(t.seconds, 0, 600, 0) };
}

/** A flat `{key: text}` map is the default language's text; `{en: {...}, fr: {...}}` is per language. */
function wordingOf(value: unknown): WordingOverrides {
  const raw = rec(value);
  const out: WordingOverrides = {};
  const flat: Record<string, string> = {};
  for (const [key, entry] of Object.entries(raw)) {
    if (typeof entry === "string") flat[key] = entry;
    else if (LANGUAGE.test(key) && entry && typeof entry === "object" && !Array.isArray(entry)) {
      const texts: Record<string, string> = {};
      for (const [k, v] of Object.entries(entry as Record<string, unknown>)) if (typeof v === "string") texts[k] = v;
      out[key.toLowerCase().replace(/_/g, "-")] = texts;
    }
  }
  if (Object.keys(flat).length > 0) out.en = { ...flat, ...out.en };
  return out;
}

function topicsOf(value: unknown): Topic[] {
  const t = rec(value);
  if (t.enabled === false || !Array.isArray(t.items)) return [];
  const seen = new Set<string>();
  const out: Topic[] = [];
  for (const item of t.items) {
    const i = rec(item);
    const tag = str(i.tag);
    const label = str(i.label) || tag;
    if (!TAG_KEY.test(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push({ tag, label: label.slice(0, 60) });
    if (out.length === MAX_TOPICS) break;
  }
  return out;
}

/** One definition, or undefined for an unknown type. */
export function parsePrompt(raw: unknown): PromptDef | undefined {
  const p = rec(raw);
  const type = p.type as PromptType;
  const base: Base = {
    id: str(p.id) || String(type),
    enabled: p.enabled !== false,
    timing: timingOf(p.timing),
    wording: wordingOf(p.wording),
  };
  switch (type) {
    case "slide_in":
      return {
        ...base,
        type,
        topics: topicsOf(p.topics),
        position: oneOf(p.position, ["top", "bottom"] as const, "top"),
        iosHomeScreen: p.ios_home_screen === true,
      };
    case "bell": {
      const offset = rec(p.offset);
      const colors = rec(p.colors);
      return {
        ...base,
        type,
        position: oneOf(p.position, ["bottom-left", "bottom-right"] as const, "bottom-right"),
        offset: { bottom: int(offset.bottom, 0, 400, 16), side: int(offset.side, 0, 400, 16) },
        size: oneOf(p.size, ["small", "medium", "large"] as const, "medium"),
        colors: { main: color(colors.main), accent: color(colors.accent) },
        hideWhenSubscribed: p.hide_when_subscribed === true,
      };
    }
    case "button": {
      const colors = rec(p.colors);
      return {
        ...base,
        type,
        style: oneOf(p.style, ["button", "link"] as const, "button"),
        size: oneOf(p.size, ["small", "medium", "large"] as const, "medium"),
        colors: { background: color(colors.background), text: color(colors.text) },
        allowUnsubscribe: p.allow_unsubscribe !== false,
        placement: str(p.placement),
      };
    }
    case "browser":
      return { ...base, type };
    case "email_phone":
      return {
        ...base,
        type,
        fields: oneOf(p.fields, ["email", "phone", "both"] as const, "email"),
        consent: str(p.consent).slice(0, CONSENT_LIMIT),
      };
    default:
      return undefined;
  }
}

/** The list as the UI uses it: known types, one per type, up to 5 distinct button placements. */
export function parsePrompts(list: readonly unknown[]): PromptDef[] {
  const out: PromptDef[] = [];
  const types = new Set<string>();
  const placements = new Set<string>();
  for (const raw of list) {
    const def = parsePrompt(raw);
    if (!def) continue;
    if (def.type === "button") {
      if (placements.has(def.placement) || placements.size === MAX_BUTTONS) continue;
      placements.add(def.placement);
    } else {
      if (types.has(def.type)) continue;
      types.add(def.type);
    }
    out.push(def);
  }
  return out;
}

/** A prompt with default options, for `Prompts.*` calls when none is set up (Custom code). */
export function defaultPrompt<T extends PromptDef["type"]>(type: T): Extract<PromptDef, { type: T }> {
  return parsePrompt({ type, timing: { auto: false } }) as Extract<PromptDef, { type: T }>;
}
