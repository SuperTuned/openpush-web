export type OsName = "windows" | "macos" | "ios" | "ipados" | "android" | "chromeos" | "linux" | "other";

export interface OsInfo {
  os: OsName;
  /** Dotted version, "" when unknown. */
  version: string;
}

function dotted(raw: string | undefined): string {
  return raw ? raw.replace(/_/g, ".") : "";
}

/**
 * Operating system from the user agent. A "Macintosh" user agent on a touch device is an iPad
 * asking for the desktop site, so it counts as iPadOS.
 */
export function detectOs(userAgent: string, maxTouchPoints = 0): OsInfo {
  const ua = userAgent;
  if (/iPad/.test(ua)) return { os: "ipados", version: dotted(/OS (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua)?.[1]) };
  if (/iPhone|iPod/.test(ua)) return { os: "ios", version: dotted(/OS (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua)?.[1]) };
  if (/Macintosh|Mac OS X/.test(ua)) {
    if (maxTouchPoints > 1) return { os: "ipados", version: /Version\/(\d+(?:\.\d+)*)/.exec(ua)?.[1] ?? "" };
    return { os: "macos", version: dotted(/Mac OS X (\d+[_.]\d+(?:[_.]\d+)?)/.exec(ua)?.[1]) };
  }
  if (/Android/.test(ua)) return { os: "android", version: /Android (\d+(?:\.\d+)*)/.exec(ua)?.[1] ?? "" };
  if (/CrOS/.test(ua)) return { os: "chromeos", version: "" };
  if (/Windows/.test(ua)) return { os: "windows", version: /Windows NT (\d+\.\d+)/.exec(ua)?.[1] ?? "" };
  if (/Linux/.test(ua)) return { os: "linux", version: "" };
  return { os: "other", version: "" };
}

export function isAppleMobile(os: OsName): boolean {
  return os === "ios" || os === "ipados";
}

/** Compares dotted versions: true when `version` is at least `min`. Unknown counts as too old. */
export function versionAtLeast(version: string, min: string): boolean {
  if (!version) return false;
  const a = version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const b = min.split(".").map((part) => Number.parseInt(part, 10) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}
