import { describe, expect, it } from "vitest";
import { browserInfo, parseUserAgent } from "../src/env/browser";
import { detectPushSupport, looksLikePrivateMode, type FeatureInputs } from "../src/env/features";
import { isInAppBrowser } from "../src/env/in_app";
import { detectOs, versionAtLeast } from "../src/env/platform";

const UA = {
  chromeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
  edgeWin: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36 Edg/131.0.0.0",
  firefoxMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 14.1; rv:132.0) Gecko/20100101 Firefox/132.0",
  safariMac: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15",
  iphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1",
  oldIphone: "Mozilla/5.0 (iPhone; CPU iPhone OS 16_3 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.3 Mobile/15E148 Safari/604.1",
  instagram: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Mobile Safari/537.36 Instagram 300.0.0.0",
  facebookIos: "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0]",
  androidWebView: "Mozilla/5.0 (Linux; Android 14; Pixel 8; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/131.0.0.0 Mobile Safari/537.36",
};

const base: FeatureInputs = {
  userAgent: UA.chromeWin,
  maxTouchPoints: 0,
  standalone: false,
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
};

describe("browser and OS", () => {
  it("parses browser names", () => {
    expect(parseUserAgent(UA.chromeWin)).toEqual({ name: "chrome", version: "131.0.0.0" });
    expect(parseUserAgent(UA.edgeWin).name).toBe("edge");
    expect(parseUserAgent(UA.firefoxMac).name).toBe("firefox");
    expect(parseUserAgent(UA.safariMac)).toEqual({ name: "safari", version: "17.4" });
  });

  it("treats a touch-capable Mac as iPadOS", () => {
    expect(detectOs(UA.safariMac, 5)).toEqual({ os: "ipados", version: "17.4" });
    expect(detectOs(UA.safariMac, 0)).toEqual({ os: "macos", version: "10.15.7" });
    expect(detectOs(UA.iphone)).toEqual({ os: "ios", version: "17.4" });
  });

  it("compares versions", () => {
    expect(versionAtLeast("16.4", "16.4")).toBe(true);
    expect(versionAtLeast("17.0", "16.4")).toBe(true);
    expect(versionAtLeast("16.3.1", "16.4")).toBe(false);
  });

  it("prefers Client Hints when present", async () => {
    const info = await browserInfo(UA.chromeWin, 0, false, {
      brands: [{ brand: "Microsoft Edge", version: "131" }],
      platform: "Windows",
      getHighEntropyValues: async () => ({ platformVersion: "15.0.0", fullVersionList: [{ brand: "Microsoft Edge", version: "131.0.2903.70" }] }),
    });
    expect(info).toEqual({ name: "edge", version: "131.0.2903.70", os: "windows", os_version: "15.0.0", standalone: false });
  });
});

describe("push support", () => {
  it("supports a desktop browser with the Push API", () => {
    expect(detectPushSupport(base)).toEqual({ supported: true });
  });

  it("finds in-app browsers", () => {
    expect(isInAppBrowser(UA.instagram)).toBe(true);
    expect(isInAppBrowser(UA.facebookIos)).toBe(true);
    expect(isInAppBrowser(UA.androidWebView)).toBe(true);
    expect(isInAppBrowser(UA.chromeWin)).toBe(false);
    expect(detectPushSupport({ ...base, userAgent: UA.instagram })).toEqual({ supported: false, reason: "in_app_browser" });
  });

  it("needs the Home Screen and 16.4+ on iPhone and iPad", () => {
    expect(detectPushSupport({ ...base, userAgent: UA.iphone })).toEqual({ supported: false, reason: "ios_needs_home_screen" });
    expect(detectPushSupport({ ...base, userAgent: UA.iphone, standalone: true })).toEqual({ supported: true });
    expect(detectPushSupport({ ...base, userAgent: UA.oldIphone, standalone: true })).toEqual({ supported: false, reason: "ios_needs_home_screen" });
    expect(detectPushSupport({ ...base, userAgent: UA.safariMac, maxTouchPoints: 5 })).toEqual({ supported: false, reason: "ios_needs_home_screen" });
  });

  it("reports no_push_api without a worker or Push API", () => {
    expect(detectPushSupport({ ...base, hasPushManager: false })).toEqual({ supported: false, reason: "no_push_api" });
  });

  it("guesses private windows from the subscribe error only", () => {
    expect(looksLikePrivateMode(new Error("Push is not available in incognito mode"))).toBe(true);
    expect(looksLikePrivateMode(new Error("Registration failed - permission denied"))).toBe(false);
  });
});
