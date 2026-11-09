/**
 * The wording a prompt shows. The SDK picks the language from `promptsLanguage` (base
 * language match) and lays the site's own text over its defaults:
 *
 * - the site wrote text for the visitor's language: that text over the defaults of the language;
 * - else, the SDK has defaults for the language: those defaults (one language per prompt);
 * - else: the site's default-language (`en`) text over the English defaults.
 *
 * Site text is cut to the limits (messages 90, button labels 20). `{site}` becomes the site name.
 */
import type { WordingOverrides } from "./config";
import { DEFAULT_LANGUAGE, LANGUAGES, RTL_LANGUAGES } from "./i18n";
import type { StringGroup, Strings } from "./i18n/strings";

export const MESSAGE_LIMIT = 90;
export const LABEL_LIMIT = 20;
const LABEL_KEYS = new Set(["allow", "later", "save", "cancel", "subscribe", "unsubscribe", "submit", "code_submit", "close"]);

export interface Wording<G extends StringGroup> {
  text: Strings[G];
  /** The language the text is in (base code). */
  lang: string;
  dir: "ltr" | "rtl";
}

/** "pt-BR" → "pt", "zh_Hans_CN" → "zh". */
export function baseLanguage(tag: string): string {
  return (tag || "").trim().toLowerCase().split(/[-_]/)[0] ?? "";
}

function overrideFor(overrides: WordingOverrides, tag: string): Record<string, string> | undefined {
  const exact = tag.trim().toLowerCase().replace(/_/g, "-");
  if (overrides[exact]) return overrides[exact];
  const base = baseLanguage(tag);
  if (overrides[base]) return overrides[base];
  return Object.entries(overrides).find(([code]) => baseLanguage(code) === base)?.[1];
}

function clip(key: string, value: string): string {
  const limit = LABEL_KEYS.has(key) ? LABEL_LIMIT : MESSAGE_LIMIT;
  return value.trim().slice(0, limit);
}

export function wordingFor<G extends StringGroup>(group: G, language: string, overrides: WordingOverrides, siteName: string): Wording<G> {
  const base = baseLanguage(language);
  let lang = base;
  let site = overrideFor(overrides, language);
  if (!site && !LANGUAGES[base]) {
    lang = DEFAULT_LANGUAGE;
    site = overrides[DEFAULT_LANGUAGE];
  }
  const defaults = LANGUAGES[lang] ?? LANGUAGES[DEFAULT_LANGUAGE]!;
  const text = { ...defaults[group] } as Record<string, string>;
  for (const [key, value] of Object.entries(site ?? {})) {
    if (key in text && typeof value === "string" && value.trim() !== "") text[key] = clip(key, value);
  }
  const name = siteName.trim();
  for (const key of Object.keys(text)) text[key] = text[key]!.replace(/\{site\}/g, name);
  return { text: text as unknown as Strings[G], lang, dir: RTL_LANGUAGES.includes(lang) ? "rtl" : "ltr" };
}
