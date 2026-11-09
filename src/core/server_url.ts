import { SDK_ORIGIN, PRODUCTION_API_ORIGIN } from "../config/build";
import { OpenPushError } from "../errors";

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

/**
 * The OpenPush server: the `serverUrl` option; else the origin the script was loaded from
 * (a self-hosted server serves the SDK itself); else, for the hosted files and for bundled npm
 * builds, the production API origin.
 */
export function resolveServerUrl(option: string | undefined, scriptSrc: string | undefined): string {
  if (option !== undefined) {
    let parsed: URL;
    try {
      parsed = new URL(option);
    } catch {
      throw new OpenPushError("invalid_argument", "serverUrl must be an absolute URL");
    }
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new OpenPushError("invalid_argument", "serverUrl must be an http or https URL");
    }
    return trimSlash(parsed.origin + parsed.pathname);
  }
  if (scriptSrc) {
    try {
      const origin = new URL(scriptSrc).origin;
      if (origin !== "null" && origin !== SDK_ORIGIN) return origin;
    } catch {
      // Fall through to the production origin.
    }
  }
  return PRODUCTION_API_ORIGIN;
}
