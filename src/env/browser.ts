import { detectOs, type OsName } from "./platform";

export type BrowserName = "chrome" | "edge" | "firefox" | "safari" | "opera" | "samsung" | "other";

/** The `browser` object sent with a registration. */
export interface BrowserInfo {
  name: BrowserName;
  version: string;
  os: OsName;
  os_version: string;
  standalone: boolean;
}

interface Brand {
  brand: string;
  version: string;
}

/** The parts of `navigator.userAgentData` the SDK reads. */
export interface UserAgentDataLike {
  brands?: readonly Brand[];
  platform?: string;
  getHighEntropyValues?(hints: string[]): Promise<{ platformVersion?: string; fullVersionList?: readonly Brand[] }>;
}

export function parseUserAgent(userAgent: string): { name: BrowserName; version: string } {
  const rules: [BrowserName, RegExp][] = [
    ["edge", /(?:Edg|EdgA|EdgiOS)\/([\d.]+)/],
    ["opera", /(?:OPR|OPT)\/([\d.]+)/],
    ["samsung", /SamsungBrowser\/([\d.]+)/],
    ["firefox", /(?:Firefox|FxiOS)\/([\d.]+)/],
    ["chrome", /(?:Chrome|CriOS)\/([\d.]+)/],
    ["safari", /Version\/([\d.]+).*Safari\//],
  ];
  for (const [name, re] of rules) {
    const match = re.exec(userAgent);
    if (match) return { name, version: match[1] ?? "" };
  }
  return { name: "other", version: "" };
}

const BRAND_NAMES: [RegExp, BrowserName][] = [
  [/Microsoft Edge/i, "edge"],
  [/Opera/i, "opera"],
  [/Samsung Internet/i, "samsung"],
  [/Google Chrome/i, "chrome"],
];

function fromBrands(brands: readonly Brand[] | undefined): { name: BrowserName; version: string } | undefined {
  if (!brands) return undefined;
  for (const [re, name] of BRAND_NAMES) {
    const brand = brands.find((b) => re.test(b.brand));
    if (brand) return { name, version: brand.version };
  }
  return undefined;
}

const UACH_OS: Record<string, OsName> = {
  Windows: "windows",
  macOS: "macos",
  Android: "android",
  "Chrome OS": "chromeos",
  ChromeOS: "chromeos",
  Linux: "linux",
};

/** Browser details from the user agent string alone (synchronous). */
export function browserFromUserAgent(userAgent: string, maxTouchPoints: number, standalone: boolean): BrowserInfo {
  const { name, version } = parseUserAgent(userAgent);
  const os = detectOs(userAgent, maxTouchPoints);
  return { name, version, os: os.os, os_version: os.version, standalone };
}

/**
 * Browser details, preferring User-Agent Client Hints where the browser has them, else the
 * user agent string.
 */
export async function browserInfo(
  userAgent: string,
  maxTouchPoints: number,
  standalone: boolean,
  uaData?: UserAgentDataLike,
): Promise<BrowserInfo> {
  const fallback = browserFromUserAgent(userAgent, maxTouchPoints, standalone);
  if (!uaData) return fallback;
  const info = { ...fallback };
  const low = fromBrands(uaData.brands);
  if (low) {
    info.name = low.name;
    info.version = low.version;
  }
  const os = uaData.platform ? UACH_OS[uaData.platform] : undefined;
  if (os) info.os = os;
  if (uaData.getHighEntropyValues) {
    try {
      const high = await uaData.getHighEntropyValues(["platformVersion", "fullVersionList"]);
      const full = fromBrands(high.fullVersionList);
      if (full) info.version = full.version;
      if (high.platformVersion) info.os_version = high.platformVersion;
    } catch {
      // Hints refused: keep the user agent values.
    }
  }
  return info;
}
