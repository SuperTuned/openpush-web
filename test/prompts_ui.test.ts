// @vitest-environment happy-dom
/**
 * The prompt UI: auto prompts with timing, the gesture fallback, opt-in only from
 * taps, topics tags, the email or phone flows with the neutral confirm and the phone code,
 * placed buttons and their MutationObserver, the bell's accessible name, the verify bar, shadow
 * roots and the CSP nonce.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptsController } from "../src/prompts/controller";
import { DAY_MS } from "../src/prompts/store";
import { LANGUAGES } from "../src/prompts/i18n";
import { OpenPushError } from "../src/errors";
import { env, fakeHost, type FakeHost, type FakeHostOptions } from "./helpers/fake_prompts_host";

function make(o: FakeHostOptions = {}): { f: FakeHost; ui: PromptsController } {
  const f = fakeHost(o);
  return { f, ui: new PromptsController(f.host) };
}

function buttons(root: ShadowRoot | null): HTMLButtonElement[] {
  return [...(root?.querySelectorAll<HTMLButtonElement>("button") ?? [])];
}

function byText(root: ShadowRoot | null, text: string): HTMLButtonElement {
  const b = buttons(root).find((x) => x.textContent === text);
  if (!b) throw new Error(`no button "${text}"`);
  return b;
}

async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

const SLIDE = { type: "slide_in", id: "s1", timing: { page_views: 2, seconds: 10 } };
const TOPICS = { enabled: true, items: [{ tag: "topic_news", label: "News" }, { tag: "topic_events", label: "Events" }] };
const CONTACT = { type: "email_phone", id: "c1", fields: "both", consent: "You agree to get messages. Reply STOP to stop texts." };

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.useRealTimers();
});

describe("auto prompts: page views AND seconds", () => {
  it("shows after the seconds once the page views are reached", async () => {
    const { f, ui } = make({ prompts: [SLIDE] });
    f.host.store.countView();
    f.host.store.countView();
    ui.start();
    // The host's clock is the page's clock: it moves with the timers (the timer re-checks it).
    f.state.now += 9_000;
    await vi.advanceTimersByTimeAsync(9_000);
    expect(f.root("slide_in")).toBeNull();
    f.state.now += 1_000;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.root("slide_in")).not.toBeNull();
    expect(f.events).toEqual([["shown", { type: "slide_in", promptId: "s1" }]]);
  });

  it("does not show before the page views", async () => {
    const { f, ui } = make({ prompts: [SLIDE] });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.root("slide_in")).toBeNull();
  });

  it("shows one auto prompt per page, browser first", async () => {
    const { f, ui } = make({ prompts: [{ ...CONTACT, timing: { seconds: 0 } }, { type: "slide_in" }, { type: "browser", id: "b1" }] });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.requestDirect).toHaveBeenCalledTimes(1);
    expect(f.root("slide_in")).toBeNull();
    expect(f.root("email_phone")).toBeNull();
  });

  it("Later starts the cooldown; it shows again after 3 days", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in" }] });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(1);
    byText(f.root("slide_in"), "Not now").click();
    expect(f.events[f.events.length - 1]?.[0]).toBe("dismissed");
    expect(f.host.store.coolingDown("slide_in", f.state.now + 3 * DAY_MS - 1)).toBe(true);
    expect(f.host.store.coolingDown("slide_in", f.state.now + 3 * DAY_MS)).toBe(false);
  });

  it("an ignored prompt is not a dismiss: it shows again on the next page", async () => {
    const first = make({ prompts: [{ type: "slide_in" }] });
    first.f.host.store.countView();
    first.ui.start();
    await vi.advanceTimersByTimeAsync(1);
    first.f.pageHide();
    expect(first.f.events.map((e) => e[0])).toEqual(["shown", "closed"]);
    expect(first.f.host.store.coolingDown("slide_in", first.f.state.now)).toBe(false);
  });

  it("opted-out people never get an auto push prompt", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in" }, { type: "browser" }], status: "opted_out", permission: "granted" });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.root("slide_in")).toBeNull();
    expect(f.requestDirect).not.toHaveBeenCalled();
  });

  it("opted-out people get no auto push prompt after permission is reset to default", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in" }, { type: "browser" }], status: "not_asked", optedOut: true, permission: "default" });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.root("slide_in")).toBeNull();
    expect(f.requestDirect).not.toHaveBeenCalled();
  });

  it("in-app browsers get no push prompt, but the email or phone prompt shows", async () => {
    const blocked = new OpenPushError("not_supported", "in-app", { reason: "in_app_browser" });
    const { f, ui } = make({ prompts: [{ type: "slide_in" }, { ...CONTACT }], env: env({ os: "android", inApp: true }), pushBlocked: blocked });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(f.root("slide_in")).toBeNull();
    expect(f.root("email_phone")).not.toBeNull();
  });

  it("iPhone tab: Home Screen steps with Not now when on, nothing when off", async () => {
    const blocked = new OpenPushError("not_supported", "tab", { reason: "ios_needs_home_screen" });
    const tab = env({ os: "ios", name: "safari" });
    const off = make({ prompts: [{ type: "slide_in" }], env: tab, pushBlocked: blocked });
    off.f.host.store.countView();
    off.ui.start();
    await vi.advanceTimersByTimeAsync(1);
    expect(off.f.root("slide_in")).toBeNull();
    document.body.innerHTML = "";
    const on = make({ prompts: [{ type: "slide_in", ios_home_screen: true }], env: tab, pushBlocked: blocked });
    on.f.host.store.countView();
    on.ui.start();
    await vi.advanceTimersByTimeAsync(1);
    const root = on.f.root("slide_in");
    expect(root?.querySelectorAll("ol li")).toHaveLength(3);
    expect(buttons(root).map((b) => b.textContent)).toEqual(["Not now"]);
    byText(root, "Not now").click();
    expect(on.f.host.store.coolingDown("slide_in", on.f.state.now + 1)).toBe(true);
    expect(on.f.subscribe).not.toHaveBeenCalled();
  });
});

describe("the browser prompt and gestures", () => {
  it("Chrome desktop: the browser's own prompt at once, with no slide-in", async () => {
    const { f, ui } = make({ prompts: [{ type: "browser", id: "b1" }], env: env({ os: "windows", name: "chrome" }) });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(f.requestDirect).toHaveBeenCalledTimes(1);
    expect(f.subscribe).not.toHaveBeenCalled();
    expect(f.events.map((e) => e[0])).toEqual(["shown", "accepted"]);
  });

  it("a dismissed direct prompt starts the browser cooldown", async () => {
    const { f, ui } = make({ prompts: [{ type: "browser" }], answer: { permission: "default", subscribed: false } });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(1);
    await settle();
    expect(f.host.store.coolingDown("browser", f.state.now + 1)).toBe(true);
  });

  for (const [label, e] of [
    ["Firefox", env({ os: "windows", name: "firefox" })],
    ["Safari", env({ os: "macos", name: "safari" })],
    ["Chrome on Android", env({ os: "android", name: "chrome" })],
    ["an iOS Home Screen app", env({ os: "ios", name: "safari", standalone: true })],
  ] as const) {
    it(`${label}: the slide-in with default wording first; its Allow is the gesture`, async () => {
      const { f, ui } = make({ prompts: [{ type: "browser", id: "b1", wording: { en: { message: "Custom" } } }], env: e });
      f.host.store.countView();
      ui.start();
      await vi.advanceTimersByTimeAsync(1);
      expect(f.requestDirect).not.toHaveBeenCalled();
      const root = f.root("slide_in");
      expect(root?.querySelector(".msg")?.textContent).toBe(LANGUAGES.en!.slide_in.message);
      byText(root, "Allow").click();
      // Called inside the click, before anything is awaited.
      expect(f.subscribe).toHaveBeenCalledTimes(1);
      expect(f.events.map((x) => x[1].type)).toEqual(["browser", "browser"]);
    });
  }

  it("Allow then a dismissed browser prompt counts as a dismiss", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in" }], answer: { permission: "default", subscribed: false } });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(1);
    byText(f.root("slide_in"), "Allow").click();
    await settle();
    expect(f.host.store.coolingDown("slide_in", f.state.now + 1)).toBe(true);
    // Not also recorded as accepted: a later topics slide-in is still offered.
    expect(f.host.store.wasAccepted("slide_in")).toBe(false);
  });

  it("Allow then a granted browser prompt records the slide-in as accepted", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in" }] });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(1);
    byText(f.root("slide_in"), "Allow").click();
    expect(f.host.store.wasAccepted("slide_in")).toBe(false);
    await settle();
    expect(f.host.store.wasAccepted("slide_in")).toBe(true);
    expect(f.host.store.coolingDown("slide_in", f.state.now + 1)).toBe(false);
  });

  it("a private-window failure is not a dismiss and stops prompts this session", async () => {
    const error = new OpenPushError("not_supported", "private", { reason: "private_mode" });
    const { f, ui } = make({ prompts: [{ type: "slide_in" }], answer: error });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(1);
    byText(f.root("slide_in"), "Allow").click();
    await settle();
    expect(f.host.store.coolingDown("slide_in", f.state.now + 1)).toBe(false);
    expect(f.host.store.privateSession(f.state.now)).toBe(true);
  });

  it("nothing subscribes without a tap", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in" }, { type: "bell" }, { type: "button", placement: "x" }] });
    document.body.innerHTML = '<div data-openpush-button="x"></div>';
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.subscribe).not.toHaveBeenCalled();
    expect(f.requestDirect).not.toHaveBeenCalled();
  });
});

describe("Prompts.show…", () => {
  it("force skips the cooldown; without force a cooling prompt is skipped", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in", timing: { auto: false } }] });
    f.host.store.dismissed("slide_in", f.state.now);
    await ui.show("slide_in", {});
    expect(f.root("slide_in")).toBeNull();
    await ui.show("slide_in", { force: true });
    expect(f.root("slide_in")).not.toBeNull();
  });

  it("works without a set-up prompt (Custom code)", async () => {
    const { f, ui } = make();
    await ui.show("slide_in", {});
    expect(f.root("slide_in")?.querySelector(".msg")?.textContent).toBe(LANGUAGES.en!.slide_in.message);
  });

  it("rejects with the push error in a browser that cannot subscribe", async () => {
    const blocked = new OpenPushError("not_supported", "in-app", { reason: "in_app_browser" });
    const { ui } = make({ env: env({ inApp: true }), pushBlocked: blocked });
    await expect(ui.show("slide_in", {})).rejects.toBe(blocked);
  });

  it("showTopics needs topics; the email prompt needs a consent line", async () => {
    const { ui } = make({ prompts: [{ type: "slide_in" }, { type: "email_phone" }] });
    await expect(ui.show("topics", {})).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(ui.show("email", {})).rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("showEmail and showPhone narrow the fields", async () => {
    const { f, ui } = make({ prompts: [CONTACT] });
    await ui.show("phone", {});
    expect(f.root("email_phone")?.querySelectorAll("input")).toHaveLength(1);
    expect(f.root("email_phone")?.querySelector("input")?.type).toBe("tel");
  });
});

describe("topics", () => {
  it("Allow saves every topic as a tag, 1 or 0, after starting the subscribe", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in", topics: TOPICS }] });
    await ui.show("slide_in", {});
    const root = f.root("slide_in");
    const boxes = root?.querySelectorAll<HTMLInputElement>("input[type=checkbox]");
    expect([...(boxes ?? [])].map((b) => b.checked)).toEqual([true, true]);
    boxes![1]!.click();
    byText(root, "Allow").click();
    expect(f.subscribe).toHaveBeenCalledTimes(1);
    expect(f.subscribe.mock.invocationCallOrder[0]).toBeLessThan(f.addTags.mock.invocationCallOrder[0]!);
    expect(f.addTags).toHaveBeenCalledWith({ topic_news: "1", topic_events: "0" });
  });

  it("a subscribed person gets the update wording and their choices; Save writes tags only", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in", topics: TOPICS }], status: "subscribed", permission: "granted", tags: { topic_news: "0", topic_events: "1" } });
    await ui.show("topics", {});
    const root = f.root("slide_in");
    expect(root?.querySelector(".msg")?.textContent).toBe(LANGUAGES.en!.slide_in.update_message);
    expect([...root!.querySelectorAll<HTMLInputElement>("input[type=checkbox]")].map((b) => b.checked)).toEqual([false, true]);
    byText(root, "Save").click();
    expect(f.addTags).toHaveBeenCalledWith({ topic_news: "0", topic_events: "1" });
    expect(f.subscribe).not.toHaveBeenCalled();
    expect(f.events.map((e) => e[0])).toEqual(["shown", "accepted"]);
  });
});

describe("email or phone", () => {
  async function open(o: FakeHostOptions = {}): Promise<{ f: FakeHost; root: ShadowRoot }> {
    const { f, ui } = make({ prompts: [CONTACT], ...o });
    await ui.show("email_or_phone", {});
    return { f, root: f.root("email_phone")! };
  }
  function type(input: Element | null | undefined, value: string): void {
    (input as HTMLInputElement).value = value;
  }

  it("shows the consent line under the inputs", async () => {
    const { root } = await open();
    expect(root.querySelector(".small")?.textContent).toBe(CONTACT.consent);
  });

  it("email: addEmail with the consent wording and origin, then the neutral confirm", async () => {
    const { f, root } = await open();
    type(root.querySelector("input[type=email]"), "Ana@Example.com");
    byText(root, "Sign up").click();
    await settle();
    expect(f.addEmail).toHaveBeenCalledWith("ana@example.com", { text: CONTACT.consent, origin: "https://play.example.com" });
    expect(root.querySelector(".msg")?.textContent).toBe(LANGUAGES.en!.email_phone.confirm);
    expect(f.events.map((e) => e[0])).toEqual(["shown", "accepted"]);
  });

  it("phone: Verify.start, addSms at once (row before approval), then the code and Verify.check", async () => {
    const { f, root } = await open({ prompts: [{ ...CONTACT, fields: "phone" }] });
    type(root.querySelector("input[type=tel]"), "+1 415 555 0123");
    byText(root, "Sign up").click();
    await settle();
    expect(f.verify.start).toHaveBeenCalledWith("+14155550123", "sms", "en");
    expect(f.addSms).toHaveBeenCalledWith("+14155550123", { text: CONTACT.consent, origin: "https://play.example.com" });
    expect(f.addSms.mock.invocationCallOrder[0]).toBeGreaterThan(f.verify.start.mock.invocationCallOrder[0]!);
    expect(f.verify.check).not.toHaveBeenCalled();
    type(root.querySelector("input"), "123456");
    byText(root, "Confirm").click();
    await settle();
    expect(f.verify.check).toHaveBeenCalledTimes(1);
    expect(f.addSms).toHaveBeenCalledTimes(1);
    expect(root.querySelector(".msg")?.textContent).toBe(LANGUAGES.en!.email_phone.confirm);
  });

  it("a wrong code says so and lets them try again", async () => {
    const { f, root } = await open({ prompts: [{ ...CONTACT, fields: "phone" }] });
    f.verify.check.mockResolvedValueOnce({ id: "ver-1", maskedNumber: "", channel: "sms", status: "pending", attempts: 1, expiresAt: null });
    type(root.querySelector("input[type=tel]"), "+14155550123");
    byText(root, "Sign up").click();
    await settle();
    type(root.querySelector("input"), "000000");
    byText(root, "Confirm").click();
    await settle();
    expect(root.querySelector(".err")?.textContent).toBe(LANGUAGES.en!.email_phone.code_wrong);
  });

  it("a number that replied STOP (409 opted_out) gets the same confirm, and no row is added", async () => {
    const { f, root } = await open({ prompts: [{ ...CONTACT, fields: "phone" }] });
    f.verify.start.mockRejectedValueOnce(new OpenPushError("invalid_argument", "no", { reason: "opted_out", status: 409 }));
    type(root.querySelector("input[type=tel]"), "+14155550123");
    byText(root, "Sign up").click();
    await settle();
    expect(root.querySelector(".msg")?.textContent).toBe(LANGUAGES.en!.email_phone.confirm);
    expect(f.addSms).not.toHaveBeenCalled();
  });

  it("checks the address before sending anything; the error slot is always there", async () => {
    const { f, root } = await open();
    expect(root.querySelector(".err")).not.toBeNull();
    type(root.querySelector("input[type=email]"), "not-an-address");
    byText(root, "Sign up").click();
    await settle();
    expect(root.querySelector(".err")?.textContent).toBe(LANGUAGES.en!.email_phone.invalid_email);
    expect(f.addEmail).not.toHaveBeenCalled();
  });
});

describe("placed buttons", () => {
  it("renders every matching element, also ones added later, with the documented classes", async () => {
    document.body.innerHTML = '<div id="a" data-openpush-button="main"></div><div data-openpush-button="other"></div>';
    const { f, ui } = make({ prompts: [{ type: "button", id: "btn", placement: "main", size: "large" }] });
    ui.start();
    const a = document.getElementById("a")!;
    expect(a.className).toContain("openpush-button openpush-button--unsubscribed openpush-button--large");
    expect(a.shadowRoot?.querySelector("button")?.textContent).toBe("Get notifications");
    const later = document.createElement("section");
    later.innerHTML = '<div id="b" data-openpush-button="main"></div>';
    document.body.appendChild(later);
    await settle();
    expect(document.getElementById("b")?.shadowRoot?.querySelector("button")).not.toBeNull();
    document.getElementById("b")!.shadowRoot!.querySelector("button")!.click();
    expect(f.subscribe).toHaveBeenCalledTimes(1);
    expect(f.events).toEqual([["accepted", { type: "button", promptId: "btn" }]]);
  });

  it("offers Unsubscribe once subscribed (allow_unsubscribe), which opts out", async () => {
    document.body.innerHTML = '<div id="a" data-openpush-button=""></div>';
    const { f, ui } = make({ prompts: [{ type: "button", style: "link" }], status: "subscribed", permission: "granted" });
    ui.start();
    const a = document.getElementById("a")!;
    expect(a.classList.contains("openpush-button--subscribed")).toBe(true);
    expect(a.classList.contains("openpush-button--link")).toBe(true);
    a.shadowRoot!.querySelector("button")!.click();
    expect(f.optOut).toHaveBeenCalledTimes(1);
  });

  it("disconnects the observer when no button prompt is left", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const { f, ui } = make({ prompts: [{ type: "button", placement: "x" }] });
    ui.start();
    expect(observe).toHaveBeenCalledWith(document.body, { childList: true, subtree: true });
    f.state.view = { ...f.state.view, prompts: [] };
    ui.refresh();
    expect(disconnect).toHaveBeenCalled();
  });

  it("does not observe at all without a button prompt", () => {
    const observe = vi.spyOn(MutationObserver.prototype, "observe");
    make({ prompts: [{ type: "slide_in", timing: { auto: false } }] }).ui.start();
    expect(observe).not.toHaveBeenCalled();
  });

  it("never touches an element that has a shadow root of the site's own", () => {
    document.body.innerHTML = '<div id="a" data-openpush-button="x"></div>';
    const own = document.getElementById("a")!.attachShadow({ mode: "open" });
    own.appendChild(document.createElement("p"));
    make({ prompts: [{ type: "button", placement: "x" }] }).ui.start();
    expect(own.querySelector("p")).not.toBeNull();
    expect(own.querySelector("button")).toBeNull();
  });
});

describe("bell", () => {
  for (const code of Object.keys(LANGUAGES)) {
    it(`its accessible name comes from aria_label (${code})`, () => {
      const { f, ui } = make({ prompts: [{ type: "bell" }], language: code });
      ui.start();
      expect(f.root("bell")?.querySelector(".bell")?.getAttribute("aria-label")).toBe(LANGUAGES[code]!.bell.aria_label);
    });
  }

  it("uses the site's aria_label wording", () => {
    const { f, ui } = make({ prompts: [{ type: "bell", wording: { en: { aria_label: "Alerts" } } }] });
    ui.start();
    expect(f.root("bell")?.querySelector(".bell")?.getAttribute("aria-label")).toBe("Alerts");
  });

  it("opens a dialog whose Subscribe is the gesture", () => {
    const { f, ui } = make({ prompts: [{ type: "bell", id: "bell1" }] });
    ui.start();
    const root = f.root("bell");
    root!.querySelector<HTMLButtonElement>(".bell")!.click();
    expect(root!.querySelector("[role=dialog]")).not.toBeNull();
    byText(root, "Turn on").click();
    expect(f.subscribe).toHaveBeenCalledTimes(1);
    expect(f.events.map((e) => e[0])).toEqual(["shown", "accepted"]);
  });

  it("shows how to unblock when blocked, and hides when subscribed with hide_when_subscribed", () => {
    const blocked = make({ prompts: [{ type: "bell" }], permission: "denied", status: "denied" });
    blocked.ui.start();
    const root = blocked.f.root("bell")!;
    root.querySelector<HTMLButtonElement>(".bell")!.click();
    expect(root.textContent).toContain(LANGUAGES.en!.bell.blocked_help);
    document.body.innerHTML = "";
    const sub = make({ prompts: [{ type: "bell", hide_when_subscribed: true }], status: "subscribed", permission: "granted" });
    sub.ui.start();
    expect(document.querySelector<HTMLElement>('[data-openpush-prompt="bell"]')?.hidden).toBe(true);
  });

  it("Unsubscribe opts out", () => {
    const { f, ui } = make({ prompts: [{ type: "bell" }], status: "subscribed", permission: "granted" });
    ui.start();
    const root = f.root("bell")!;
    root.querySelector<HTMLButtonElement>(".bell")!.click();
    byText(root, "Turn off").click();
    expect(f.optOut).toHaveBeenCalledTimes(1);
  });
});

describe("verify bar", () => {
  it("removes the parameter, shows the bar, and Allow sets the code before the gesture", () => {
    const { f, ui } = make({ href: "https://play.example.com/shop?x=1&openpush-verify=ABCDEFGHJK#top" });
    ui.start();
    expect(f.replaceUrl).toHaveBeenCalledWith("https://play.example.com/shop?x=1#top");
    const root = f.root("verify")!;
    expect(root.querySelector(".t")?.textContent).toBe("Allow notifications to finish setting up Example Play");
    byText(root, "Allow").click();
    expect(f.setVerifyCode).toHaveBeenCalledWith("ABCDEFGHJK");
    expect(f.setVerifyCode.mock.invocationCallOrder[0]).toBeLessThan(f.subscribe.mock.invocationCallOrder[0]!);
  });

  it("an invalid code is removed and shows nothing", () => {
    const { f, ui } = make({ href: "https://play.example.com/?openpush-verify=%3Cscript%3E" });
    ui.start();
    expect(f.replaceUrl).toHaveBeenCalled();
    expect(f.root("verify")).toBeNull();
  });

  it("no auto prompt on a site-check visit", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in" }], href: "https://play.example.com/?openpush-verify=ABCDEFGHJK" });
    f.host.store.countView();
    ui.start();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.root("slide_in")).toBeNull();
  });
});

describe("isolation and CSP", () => {
  it("draws each prompt in its own shadow root with one style element carrying the nonce", async () => {
    const { f, ui } = make({ prompts: [{ type: "bell" }], nonce: "n0nce" });
    ui.start();
    await ui.show("slide_in", {});
    for (const kind of ["bell", "slide_in"]) {
      const styles = f.root(kind)!.querySelectorAll("style");
      expect(styles).toHaveLength(1);
      expect(styles[0]!.getAttribute("nonce")).toBe("n0nce");
    }
    expect(document.head.querySelectorAll("style")).toHaveLength(0);
  });

  it("puts site text in as text, never as HTML", async () => {
    const { f, ui } = make({ prompts: [{ type: "slide_in", wording: { en: { message: "<img src=x onerror=alert(1)>" } } }] });
    await ui.show("slide_in", {});
    const msg = f.root("slide_in")!.querySelector(".msg")!;
    expect(msg.textContent).toBe("<img src=x onerror=alert(1)>");
    expect(msg.querySelector("img")).toBeNull();
  });

  it("uses no inline handlers", async () => {
    const { f, ui } = make({ prompts: [{ type: "bell" }] });
    ui.start();
    await ui.show("email_or_phone", {}).catch(() => undefined);
    await ui.show("slide_in", {});
    for (const kind of ["bell", "slide_in"]) {
      for (const node of f.root(kind)!.querySelectorAll("*")) {
        expect([...node.attributes].some((a) => a.name.startsWith("on"))).toBe(false);
      }
    }
  });

  it("writes Arabic prompts right to left", async () => {
    const { f, ui } = make({ language: "ar" });
    await ui.show("slide_in", {});
    expect(f.root("slide_in")!.querySelector(".card")?.getAttribute("dir")).toBe("rtl");
  });
});
