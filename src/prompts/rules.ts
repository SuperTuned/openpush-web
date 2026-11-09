/**
 * The auto-prompt rules, as pure functions of what the page knows.
 *
 * - Timing: page views AND seconds since this page load.
 * - One auto prompt per page, in the order `browser`, `slide_in`, `email_phone`.
 * - Push prompts only for people who can be asked (permission not asked yet), or, for the
 *   slide-in with topics, subscribed people who have not saved their topics yet. Opted-out
 *   people never get an auto push prompt; the bell or a button is their way back.
 * - A cooldown after a dismiss (3, 7, then 30 days), per type; `force` skips it and timing.
 * - No push prompt in in-app browsers, in an iPhone or iPad browser tab (except the slide-in's
 *   Home Screen steps when they are on), after a private-window failure this session, or when
 *   new subscriptions are off for the app.
 */
import type { EnvInfo } from "../env/detect";
import { isAppleMobile } from "../env/platform";
import type { PermissionValue } from "../platform/types";
import type { PushStatus } from "../push/state";
import type { EmailPhoneDef, PromptDef, SlideInDef } from "./config";
import { AUTO_ORDER } from "./types";

export interface RuleInputs {
  now: number;
  /** Page views of the site, this one included. */
  views: number;
  /** Seconds since this page loaded. */
  elapsed: number;
  env: EnvInfo;
  status: PushStatus;
  /**
   * This browser opted out (bell or button Unsubscribe, `optOut()`, or a server -2 the SDK took
   * up), whatever the browser permission is now (no auto push prompt after an opt-out).
   */
  optedOut: boolean;
  permission: PermissionValue;
  /** Push is stopped on this page (unsupported browser, iOS tab, wrong origin, …). */
  pushBlocked: boolean;
  newRegistrations: boolean;
  /** A private-window failure happened this session. */
  privateSession: boolean;
  channels: { email: boolean; phone: boolean };
  coolingDown(type: string): boolean;
  wasAccepted(type: string): boolean;
}

/** What a push prompt would ask this person. */
export type PushAsk = "ask" | "topics" | "home_screen";

/** An iPhone or iPad browser tab (not a Home Screen web app). */
export function iosTab(env: EnvInfo): boolean {
  return isAppleMobile(env.browser.os) && !env.standalone;
}

const DESKTOP = ["windows", "macos", "linux", "chromeos"];

/**
 * True where the browser prompt must come from a tap: everywhere except Chrome and Edge
 * (and other Chromium browsers) on desktop. There the `browser` type shows the slide-in first.
 */
export function needsGesture(env: EnvInfo): boolean {
  const { name, os } = env.browser;
  return !((name === "chrome" || name === "edge" || name === "opera") && DESKTOP.includes(os));
}

/** For an auto prompt: what the push prompt would ask, or null when it must not show. */
export function autoPushAsk(def: SlideInDef | { type: "browser" }, i: RuleInputs): PushAsk | null {
  if (i.env.inAppBrowser || i.optedOut) return null;
  if (iosTab(i.env)) {
    return def.type === "slide_in" && def.iosHomeScreen && i.permission !== "denied" ? "home_screen" : null;
  }
  if (i.pushBlocked || i.privateSession || i.status === "opted_out") return null;
  if (i.status === "subscribed") {
    return def.type === "slide_in" && def.topics.length > 0 && !i.wasAccepted("slide_in") ? "topics" : null;
  }
  if (!i.newRegistrations) return null;
  return i.permission === "default" ? "ask" : null;
}

/**
 * For a `Prompts.*` call: what the push prompt would ask. An opted-out person may be asked (Allow
 * is their opt-in); a blocked browser or a subscribed person without topics cannot.
 */
export function manualPushAsk(def: SlideInDef, i: RuleInputs, wantTopics: boolean): PushAsk | null {
  if (i.env.inAppBrowser) return null;
  if (iosTab(i.env)) return def.iosHomeScreen ? "home_screen" : null;
  if (i.pushBlocked) return null;
  if (i.status === "subscribed") return def.topics.length > 0 ? "topics" : null;
  if (i.permission === "denied") return null;
  if (!i.newRegistrations) return null;
  return wantTopics && def.topics.length === 0 ? null : "ask";
}

/** The email or phone prompt can offer at least one of its fields, and has its consent line. */
export function contactFields(def: EmailPhoneDef, channels: { email: boolean; phone: boolean }): ("email" | "phone")[] {
  if (!def.consent) return [];
  const want = def.fields === "both" ? (["email", "phone"] as const) : ([def.fields] as const);
  return want.filter((f) => channels[f]);
}

/** Page views and cooldown met (seconds are checked when the timer fires). */
function due(def: PromptDef, i: RuleInputs): boolean {
  return def.enabled && def.timing.auto && i.views >= def.timing.pageViews && !i.coolingDown(def.type);
}

/** The auto prompt that may show for this person now, page views and cooldown met. */
export function autoEligible(def: PromptDef, i: RuleInputs): boolean {
  if (!due(def, i)) return false;
  switch (def.type) {
    case "browser":
    case "slide_in":
      return autoPushAsk(def, i) !== null;
    case "email_phone":
      return contactFields(def, i.channels).length > 0 && !i.wasAccepted("email_phone");
    default:
      return false;
  }
}

/** The one auto prompt for this page, in auto prompt order; undefined when none applies. */
export function pickAuto(defs: readonly PromptDef[], i: RuleInputs): PromptDef | undefined {
  for (const type of AUTO_ORDER) {
    const def = defs.find((d) => d.type === type);
    if (def && autoEligible(def, i)) return def;
  }
  return undefined;
}

/** Milliseconds until the prompt's seconds are met. */
export function waitFor(def: PromptDef, i: RuleInputs): number {
  return Math.max(0, (def.timing.seconds - i.elapsed) * 1000);
}

/** The bell shows: push can work here, new subscriptions are possible, and not hidden for subscribed people. */
export function bellVisible(hideWhenSubscribed: boolean, i: RuleInputs): boolean {
  if (i.pushBlocked || i.env.inAppBrowser || iosTab(i.env) || !i.newRegistrations) return false;
  return !(hideWhenSubscribed && i.status === "subscribed");
}
