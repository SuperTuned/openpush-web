/** Prompt definitions. */
import { describe, expect, it } from "vitest";
import { color, defaultPrompt, parsePrompt, parsePrompts } from "../src/prompts/config";

describe("parsePrompts", () => {
  it("keeps one prompt per type and up to 5 distinct button placements", () => {
    const list = parsePrompts([
      { type: "slide_in", id: "a" },
      { type: "slide_in", id: "b" },
      ...["p1", "p2", "p2", "p3", "p4", "p5", "p6"].map((placement) => ({ type: "button", placement })),
      { type: "nope" },
    ]);
    expect(list.filter((p) => p.type === "slide_in").map((p) => p.id)).toEqual(["a"]);
    expect(list.filter((p) => p.type === "button").map((p) => (p.type === "button" ? p.placement : ""))).toEqual(["p1", "p2", "p3", "p4", "p5"]);
    expect(list.some((p) => (p.type as string) === "nope")).toBe(false);
  });

  it("reads timing with limits and defaults", () => {
    expect(parsePrompt({ type: "browser" })?.timing).toEqual({ auto: true, pageViews: 1, seconds: 0 });
    expect(parsePrompt({ type: "browser", timing: { page_views: 99, seconds: -3, auto: false } })?.timing).toEqual({ auto: false, pageViews: 50, seconds: 0 });
  });

  it("keeps at most 10 topics with valid, unique tag keys", () => {
    const items = [...Array.from({ length: 12 }, (_, i) => ({ tag: `topic_${i}`, label: `T${i}` })), { tag: "bad key", label: "x" }, { tag: "topic_0", label: "dup" }];
    const p = parsePrompt({ type: "slide_in", topics: { enabled: true, items } });
    if (p?.type !== "slide_in") throw new Error("parse");
    expect(p.topics).toHaveLength(10);
    expect(new Set(p.topics.map((t) => t.tag)).size).toBe(10);
    const off = parsePrompt({ type: "slide_in", topics: { enabled: false, items } });
    expect(off?.type === "slide_in" && off.topics).toEqual([]);
  });

  it("reads per-language wording, and a flat map as the default language", () => {
    expect(parsePrompt({ type: "bell", wording: { en: { aria_label: "Alerts" }, fr: { aria_label: "Alertes" } } })?.wording).toEqual({
      en: { aria_label: "Alerts" },
      fr: { aria_label: "Alertes" },
    });
    expect(parsePrompt({ type: "bell", wording: { aria_label: "Alerts" } })?.wording).toEqual({ en: { aria_label: "Alerts" } });
  });

  it("accepts only plain colours", () => {
    expect(color("#112233")).toBe("#112233");
    expect(color("rgb(1, 2, 3)")).toBe("rgb(1, 2, 3)");
    expect(color("teal")).toBe("teal");
    expect(color("red;background:url(x)")).toBeUndefined();
    expect(color("url(javascript:alert(1))")).toBeUndefined();
  });

  it("cuts the consent line to 300 characters", () => {
    const p = parsePrompt({ type: "email_phone", consent: "c".repeat(400) });
    expect(p?.type === "email_phone" && p.consent.length).toBe(300);
  });

  it("has defaults for Prompts.* calls without a set-up prompt", () => {
    const bell = defaultPrompt("bell");
    expect(bell).toMatchObject({ type: "bell", position: "bottom-right", size: "medium", hideWhenSubscribed: false });
    expect(defaultPrompt("slide_in").timing.auto).toBe(false);
  });
});
