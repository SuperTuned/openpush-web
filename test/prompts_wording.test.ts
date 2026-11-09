/** Wording and languages: 14 languages, overrides, limits, RTL, the bell's aria_label. */
import { describe, expect, it } from "vitest";
import { LANGUAGES } from "../src/prompts/i18n";
import { en } from "../src/prompts/i18n/en";
import { baseLanguage, LABEL_LIMIT, MESSAGE_LIMIT, wordingFor } from "../src/prompts/wording";

const ALL = ["en", "es", "pt", "fr", "de", "it", "ja", "ko", "zh", "hi", "id", "tr", "ru", "ar"];

describe("default wording", () => {
  it("has the 14 languages, each with every key filled (explanation may be empty)", () => {
    expect(Object.keys(LANGUAGES).sort()).toEqual([...ALL].sort());
    for (const code of ALL) {
      const table = LANGUAGES[code]!;
      for (const group of Object.keys(en) as (keyof typeof en)[]) {
        expect(Object.keys(table[group]).sort()).toEqual(Object.keys(en[group]).sort());
        for (const [key, value] of Object.entries(table[group])) {
          if (key !== "explanation") expect(value.trim(), `${code}.${group}.${key}`).not.toBe("");
        }
      }
    }
  });

  it("keeps button labels within 20 characters and messages within 90", () => {
    const labels = new Set(["allow", "later", "save", "cancel", "submit", "code_submit", "close"]);
    for (const code of ALL) {
      const t = LANGUAGES[code]!;
      for (const group of Object.keys(t) as (keyof typeof t)[]) {
        for (const [key, value] of Object.entries(t[group])) {
          const limit = labels.has(key) || (group === "button" && (key === "subscribe" || key === "unsubscribe")) ? LABEL_LIMIT : MESSAGE_LIMIT;
          expect(value.length, `${code}.${group}.${key}`).toBeLessThanOrEqual(limit);
        }
      }
    }
  });

  it("gives the bell an accessible name in all 14 languages, English 'Notification settings'", () => {
    expect(wordingFor("bell", "en-US", {}, "Site").text.aria_label).toBe("Notification settings");
    const names = new Set<string>();
    for (const code of ALL) {
      const label = wordingFor("bell", code, {}, "Site").text.aria_label;
      expect(label).toBeTruthy();
      names.add(label);
    }
    expect(names.size).toBe(14);
  });
});

describe("choosing the language", () => {
  it("matches the base language", () => {
    expect(baseLanguage("pt-BR")).toBe("pt");
    expect(baseLanguage("zh_Hans_CN")).toBe("zh");
    expect(wordingFor("slide_in", "fr-CA", {}, "S").lang).toBe("fr");
    expect(wordingFor("slide_in", "fr-CA", {}, "S").text.allow).toBe(LANGUAGES.fr!.slide_in.allow);
  });

  it("falls back to English for a language without defaults", () => {
    const w = wordingFor("slide_in", "nl", {}, "S");
    expect(w.lang).toBe("en");
    expect(w.text.allow).toBe("Allow");
  });

  it("lays the site's text for the language over the defaults", () => {
    const w = wordingFor("slide_in", "fr", { en: { message: "Hello" }, fr: { message: "Bonjour" } }, "S");
    expect(w.text.message).toBe("Bonjour");
    expect(w.text.later).toBe(LANGUAGES.fr!.slide_in.later);
  });

  it("keeps one language per prompt: no English site text over French defaults", () => {
    expect(wordingFor("slide_in", "fr", { en: { message: "Hello" } }, "S").text.message).toBe(LANGUAGES.fr!.slide_in.message);
  });

  it("uses the site's default-language text for a language the SDK has no defaults for", () => {
    expect(wordingFor("slide_in", "nl", { en: { message: "Hello" } }, "S").text.message).toBe("Hello");
  });

  it("cuts site text to the limits", () => {
    const w = wordingFor("slide_in", "en", { en: { message: "m".repeat(200), allow: "a".repeat(40) } }, "S");
    expect(w.text.message).toHaveLength(MESSAGE_LIMIT);
    expect(w.text.allow).toHaveLength(LABEL_LIMIT);
  });

  it("ignores unknown keys and empty values", () => {
    const w = wordingFor("slide_in", "en", { en: { nope: "x", allow: "  " } }, "S");
    expect(w.text.allow).toBe("Allow");
    expect("nope" in w.text).toBe(false);
  });

  it("writes Arabic right to left", () => {
    expect(wordingFor("bell", "ar-EG", {}, "S").dir).toBe("rtl");
    expect(wordingFor("bell", "en", {}, "S").dir).toBe("ltr");
  });

  it("puts the site name in the verify bar", () => {
    expect(wordingFor("verify", "en", {}, "Example Play").text.message).toBe("Allow notifications to finish setting up Example Play");
  });
});
