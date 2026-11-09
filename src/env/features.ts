import { isInAppBrowser } from "./in_app";
import { detectOs, isAppleMobile, versionAtLeast } from "./platform";

/** `detail.reason` values of a `not_supported` error. */
export type UnsupportedReason = "no_push_api" | "in_app_browser" | "ios_needs_home_screen" | "private_mode";

export type PushSupport = { supported: true } | { supported: false; reason: UnsupportedReason };

export interface FeatureInputs {
  userAgent: string;
  maxTouchPoints: number;
  /** Running as an installed (Home Screen) web app. */
  standalone: boolean;
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
}

/** Lowest iOS / iPadOS version with web push in a Home Screen web app. */
export const MIN_APPLE_MOBILE_VERSION = "16.4";

/** Feature check for web push. */
export function detectPushSupport(input: FeatureInputs): PushSupport {
  if (isInAppBrowser(input.userAgent)) return { supported: false, reason: "in_app_browser" };
  const os = detectOs(input.userAgent, input.maxTouchPoints);
  if (isAppleMobile(os.os)) {
    // Push only works in a Home Screen web app on 16.4 or later. An unknown version is left to
    // the API check below.
    const tooOld = os.version !== "" && !versionAtLeast(os.version, MIN_APPLE_MOBILE_VERSION);
    if (!input.standalone || tooOld) return { supported: false, reason: "ios_needs_home_screen" };
  }
  if (!input.hasServiceWorker || !input.hasPushManager || !input.hasNotification) {
    return { supported: false, reason: "no_push_api" };
  }
  return { supported: true };
}

/**
 * Best-effort private window detection after `subscribe()` fails. Firefox private windows
 * have no push and Chrome incognito refuses it; browsers do not say so plainly, so this only
 * reads the error.
 */
export function looksLikePrivateMode(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const { name, message } = error as { name?: unknown; message?: unknown };
  const text = `${typeof name === "string" ? name : ""} ${typeof message === "string" ? message : ""}`;
  return /incognito|private (?:browsing|mode|window)/i.test(text);
}
