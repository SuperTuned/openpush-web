import { OpenPushError } from "../errors";

export interface PageLocation {
  origin: string;
  protocol: string;
  hostname: string;
}

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

export function isLocalhostHost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || hostname.endsWith(".localhost");
}

export function isLocalhostOrigin(origin: string): boolean {
  try {
    return isLocalhostHost(new URL(origin).hostname);
  } catch {
    return false;
  }
}

/**
 * HTTPS check: push needs HTTPS, or a localhost page with `allowLocalhost`.
 */
export function checkSecureOrigin(page: PageLocation, allowLocalhost: boolean): OpenPushError | undefined {
  if (isLocalhostHost(page.hostname)) {
    if (allowLocalhost) return undefined;
    return new OpenPushError("insecure_origin", "Push on localhost needs allowLocalhost: true");
  }
  if (page.protocol !== "https:") {
    return new OpenPushError("insecure_origin", "Web push needs an https page");
  }
  return undefined;
}

/**
 * Site address check: the page must be on the app's site origin. A localhost page
 * passes when `allowLocalhost` is set and the app's site address is a localhost origin.
 */
export function checkSiteOrigin(page: PageLocation, siteOrigin: string, allowLocalhost: boolean): OpenPushError | undefined {
  if (isLocalhostHost(page.hostname) && allowLocalhost && isLocalhostOrigin(siteOrigin)) return undefined;
  if (page.origin === siteOrigin) return undefined;
  return new OpenPushError("wrong_origin", `This app is set up for ${siteOrigin}`, {
    expected: siteOrigin,
    actual: page.origin,
  });
}
