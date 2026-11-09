/** Prompt rules, as pure functions. */
import { describe, expect, it } from "vitest";
import { parsePrompts, type PromptDef, type SlideInDef } from "../src/prompts/config";
import { autoPushAsk, bellVisible, contactFields, iosTab, manualPushAsk, needsGesture, pickAuto, waitFor, type RuleInputs } from "../src/prompts/rules";
import { env } from "./helpers/fake_prompts_host";

function inputs(over: Partial<RuleInputs> = {}): RuleInputs {
  return {
    now: 0,
    views: 1,
    elapsed: 0,
    env: env(),
    status: "not_asked",
    optedOut: false,
    permission: "default",
    pushBlocked: false,
    newRegistrations: true,
    privateSession: false,
    channels: { email: true, phone: true },
    coolingDown: () => false,
    wasAccepted: () => false,
    ...over,
  };
}

const ALL = parsePrompts([
  { type: "email_phone", consent: "OK to message me.", timing: { page_views: 1, seconds: 0 } },
  { type: "slide_in", timing: { page_views: 2, seconds: 10 }, topics: { enabled: true, items: [{ tag: "topic_news", label: "News" }] } },
  { type: "browser", timing: { page_views: 3, seconds: 20 } },
  { type: "bell" },
]);

describe("timing: page views AND seconds", () => {
  it("needs the page views", () => {
    const slide = parsePrompts([{ type: "slide_in", timing: { page_views: 2, seconds: 10 } }]);
    expect(pickAuto(slide, inputs({ views: 1 }))).toBeUndefined();
    expect(pickAuto(slide, inputs({ views: 2 }))?.type).toBe("slide_in");
  });

  it("waits for the seconds since this page load", () => {
    const [slide] = parsePrompts([{ type: "slide_in", timing: { page_views: 1, seconds: 10 } }]) as [PromptDef];
    expect(waitFor(slide, inputs({ elapsed: 0 }))).toBe(10_000);
    expect(waitFor(slide, inputs({ elapsed: 4 }))).toBe(6_000);
    expect(waitFor(slide, inputs({ elapsed: 12 }))).toBe(0);
  });

  it("timing.auto false never shows on its own", () => {
    expect(pickAuto(parsePrompts([{ type: "slide_in", timing: { auto: false } }]), inputs({ views: 9 }))).toBeUndefined();
  });

  it("a disabled prompt never shows on its own", () => {
    expect(pickAuto(parsePrompts([{ type: "slide_in", enabled: false }]), inputs())).toBeUndefined();
  });
});

describe("ordering: browser, slide_in, email_phone; one per page", () => {
  it("picks the browser prompt first when all are due", () => {
    expect(pickAuto(ALL, inputs({ views: 3 }))?.type).toBe("browser");
  });
  it("then the slide-in", () => {
    expect(pickAuto(ALL, inputs({ views: 2 }))?.type).toBe("slide_in");
  });
  it("then email or phone", () => {
    expect(pickAuto(ALL, inputs({ views: 1 }))?.type).toBe("email_phone");
  });
  it("skips a type in its cooldown and takes the next", () => {
    expect(pickAuto(ALL, inputs({ views: 3, coolingDown: (t) => t === "browser" }))?.type).toBe("slide_in");
  });
  it("re-shows an ignored prompt: nothing is recorded without a click", () => {
    expect(pickAuto(ALL, inputs({ views: 4 }))?.type).toBe("browser");
    expect(pickAuto(ALL, inputs({ views: 5 }))?.type).toBe("browser");
  });
});

describe("who sees push prompts", () => {
  const slide = parsePrompts([{ type: "slide_in", topics: { enabled: true, items: [{ tag: "t", label: "T" }] } }])[0] as SlideInDef;
  const plain = parsePrompts([{ type: "slide_in" }])[0] as SlideInDef;

  it("people who can be asked", () => {
    expect(autoPushAsk(plain, inputs())).toBe("ask");
    expect(autoPushAsk(plain, inputs({ permission: "denied", status: "denied" }))).toBeNull();
  });
  it("opted-out people never get an auto push prompt", () => {
    expect(autoPushAsk(slide, inputs({ status: "opted_out", permission: "granted" }))).toBeNull();
    expect(autoPushAsk({ type: "browser" }, inputs({ status: "opted_out" }))).toBeNull();
  });
  it("opted-out people whose permission is back at default still get no auto push prompt", () => {
    // pushStatus says not_asked once permission is reset; the local opt-out still holds.
    const reset = inputs({ status: "not_asked", permission: "default", optedOut: true, views: 9 });
    expect(autoPushAsk(plain, reset)).toBeNull();
    expect(autoPushAsk({ type: "browser" }, reset)).toBeNull();
    expect(pickAuto(parsePrompts([{ type: "browser" }, { type: "slide_in" }]), reset)).toBeUndefined();
    // A Prompts.* call from a click is their way back.
    expect(manualPushAsk(plain, reset, false)).toBe("ask");
  });
  it("subscribed people get the topics update once, never a plain ask", () => {
    expect(autoPushAsk(slide, inputs({ status: "subscribed", permission: "granted" }))).toBe("topics");
    expect(autoPushAsk(slide, inputs({ status: "subscribed", permission: "granted", wasAccepted: () => true }))).toBeNull();
    expect(autoPushAsk(plain, inputs({ status: "subscribed", permission: "granted" }))).toBeNull();
  });
  it("in-app browsers get no push prompt, but email or phone still works", () => {
    const i = inputs({ env: env({ os: "android", inApp: true }), pushBlocked: true, views: 3 });
    expect(autoPushAsk(plain, i)).toBeNull();
    expect(pickAuto(ALL, i)?.type).toBe("email_phone");
    expect(bellVisible(false, i)).toBe(false);
  });
  it("a private-window failure this session stops push prompts", () => {
    expect(autoPushAsk(plain, inputs({ privateSession: true }))).toBeNull();
  });
  it("new subscriptions off: no push prompt", () => {
    expect(autoPushAsk(plain, inputs({ newRegistrations: false }))).toBeNull();
    expect(bellVisible(false, inputs({ newRegistrations: false }))).toBe(false);
  });
});

describe("iPhone and iPad", () => {
  const tab = env({ os: "ios", name: "safari", standalone: false });
  const app = env({ os: "ios", name: "safari", standalone: true });
  const plain = parsePrompts([{ type: "slide_in" }])[0] as SlideInDef;
  const steps = parsePrompts([{ type: "slide_in", ios_home_screen: true }])[0] as SlideInDef;

  it("a browser tab gets no push prompt", () => {
    expect(iosTab(tab)).toBe(true);
    expect(autoPushAsk(plain, inputs({ env: tab, pushBlocked: true }))).toBeNull();
    expect(autoPushAsk({ type: "browser" }, inputs({ env: tab, pushBlocked: true }))).toBeNull();
  });
  it("the Home Screen steps show in a tab when they are on", () => {
    expect(autoPushAsk(steps, inputs({ env: tab, pushBlocked: true }))).toBe("home_screen");
    expect(manualPushAsk(steps, inputs({ env: tab, pushBlocked: true }), false)).toBe("home_screen");
  });
  it("a Home Screen app asks as usual, and needs the tap (gesture fallback)", () => {
    expect(iosTab(app)).toBe(false);
    expect(autoPushAsk(plain, inputs({ env: app }))).toBe("ask");
    expect(needsGesture(app)).toBe(true);
  });
  it("a touch Mac (iPadOS) counts as iPad", () => {
    expect(iosTab(env({ os: "ipados", name: "safari" }))).toBe(true);
  });
});

describe("gesture fallback", () => {
  it("Chrome and Edge on desktop ask directly", () => {
    expect(needsGesture(env({ os: "windows", name: "chrome" }))).toBe(false);
    expect(needsGesture(env({ os: "macos", name: "edge" }))).toBe(false);
    expect(needsGesture(env({ os: "linux", name: "chrome" }))).toBe(false);
  });
  it("Firefox, Safari, Chrome on Android need a tap", () => {
    expect(needsGesture(env({ os: "windows", name: "firefox" }))).toBe(true);
    expect(needsGesture(env({ os: "macos", name: "safari" }))).toBe(true);
    expect(needsGesture(env({ os: "android", name: "chrome" }))).toBe(true);
  });
});

describe("manual prompts", () => {
  const plain = parsePrompts([{ type: "slide_in" }])[0] as SlideInDef;
  it("an opted-out person may be asked by the site (Allow is their opt-in)", () => {
    expect(manualPushAsk(plain, inputs({ status: "opted_out", permission: "granted" }), false)).toBe("ask");
  });
  it("blocked or subscribed without topics: nothing to ask", () => {
    expect(manualPushAsk(plain, inputs({ permission: "denied", status: "denied" }), false)).toBeNull();
    expect(manualPushAsk(plain, inputs({ status: "subscribed", permission: "granted" }), false)).toBeNull();
  });
});

describe("email or phone availability", () => {
  const def = parsePrompts([{ type: "email_phone", fields: "both", consent: "OK" }])[0];
  it("offers only the channels the app has", () => {
    if (def?.type !== "email_phone") throw new Error("parse");
    expect(contactFields(def, { email: true, phone: false })).toEqual(["email"]);
    expect(contactFields(def, { email: false, phone: false })).toEqual([]);
  });
  it("needs its consent line", () => {
    const bare = parsePrompts([{ type: "email_phone", fields: "email" }])[0];
    if (bare?.type !== "email_phone") throw new Error("parse");
    expect(contactFields(bare, { email: true, phone: true })).toEqual([]);
  });
  it("is not auto-shown again after a submit", () => {
    expect(pickAuto(ALL, inputs({ views: 1, wasAccepted: (t) => t === "email_phone" }))).toBeUndefined();
  });
});
