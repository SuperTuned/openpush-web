import type { Platform } from "../platform/types";
import { browserFromUserAgent, type BrowserInfo } from "./browser";
import { detectPushSupport, type PushSupport } from "./features";
import { isInAppBrowser } from "./in_app";

export interface EnvInfo {
  userAgent: string;
  language: string;
  standalone: boolean;
  inAppBrowser: boolean;
  /** From the user agent string; registrations use the async Client Hints version. */
  browser: BrowserInfo;
  support: PushSupport;
}

/** Feature check from the live platform. */
export function detectEnv(platform: Platform): EnvInfo {
  const nav = platform.navigator();
  const userAgent = nav?.userAgent ?? "";
  const maxTouchPoints = nav?.maxTouchPoints ?? 0;
  const standalone = platform.isStandalone();
  return {
    userAgent,
    language: nav?.language ?? "",
    standalone,
    inAppBrowser: isInAppBrowser(userAgent),
    browser: browserFromUserAgent(userAgent, maxTouchPoints, standalone),
    support: detectPushSupport({
      userAgent,
      maxTouchPoints,
      standalone,
      hasServiceWorker: !!platform.serviceWorker(),
      hasPushManager: platform.hasPushManager(),
      hasNotification: platform.hasNotification(),
    }),
  };
}
