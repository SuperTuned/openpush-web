/** Click URL rules. */

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1"]);

/**
 * The absolute URL for `raw` when a browser may open it from a notification: `https://`,
 * `http://localhost…` or a `/path` on the site. Anything else (a custom scheme, `javascript:`,
 * a protocol-relative URL) gives null.
 */
export function routableUrl(raw: unknown, origin: string): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim();
  if (value === "") return null;
  try {
    if (value.startsWith("/")) {
      if (value.startsWith("//") || value.startsWith("/\\")) return null;
      return new URL(value, origin).href;
    }
    const url = new URL(value);
    if (url.protocol === "https:") return url.href;
    if (url.protocol === "http:" && LOCAL_HOSTS.has(url.hostname)) return url.href;
  } catch {
    return null;
  }
  return null;
}

/** The first routable candidate, else the site origin. */
export function resolveUrl(candidates: readonly unknown[], origin: string): string {
  for (const candidate of candidates) {
    const url = routableUrl(candidate, origin);
    if (url) return url;
  }
  return new URL("/", origin).href;
}

/** A link with `op_open=0` in its query only records the click; nothing opens. */
export function opensNothing(url: string): boolean {
  try {
    return new URL(url).searchParams.get("op_open") === "0";
  } catch {
    return false;
  }
}

export function sameOrigin(url: string, origin: string): boolean {
  try {
    return new URL(url).origin === origin;
  } catch {
    return false;
  }
}
