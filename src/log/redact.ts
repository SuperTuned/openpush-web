/**
 * Redaction for log lines. Nothing logged may contain the SDK key, push keys, the device
 * secret, a full endpoint (host plus last 8 characters only), a full email (first letter and
 * domain only) or a full phone number (last 4 digits only).
 */

const HIDDEN = "[hidden]";

/** Push service hosts whose URLs are endpoints (capability URLs). */
const PUSH_HOST = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/i;

export function maskEndpoint(endpoint: string): string {
  let host = "";
  try {
    host = new URL(endpoint).host;
  } catch {
    host = "";
  }
  const tail = endpoint.length > 8 ? endpoint.slice(-8) : "";
  return host ? `${host}/…${tail}` : `…${tail}`;
}

export function maskEmail(address: string): string {
  const at = address.lastIndexOf("@");
  if (at < 1) return HIDDEN;
  return `${address.charAt(0)}…@${address.slice(at + 1)}`;
}

export function maskPhone(number: string): string {
  const digits = number.replace(/\D/g, "");
  return digits.length > 4 ? `…${digits.slice(-4)}` : HIDDEN;
}

const URL_RE = /https?:\/\/[^\s"'<>]+/g;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE_RE = /(?:\+|\btel:)\d[\d\s().-]{5,}\d/g;
const LONG_TOKEN_RE = /[A-Za-z0-9_-]{40,}={0,2}/g;

function isPushEndpoint(url: string): boolean {
  try {
    return PUSH_HOST.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

/**
 * Masks anything secret-looking in a finished log line: known secrets, push endpoints, emails,
 * phone numbers and long key-like tokens. Callers should still mask values on purpose; this is
 * the safety net.
 */
export function scrub(text: string, secrets: Iterable<string> = []): string {
  let out = text;
  for (const secret of secrets) {
    if (secret && secret.length >= 6) out = out.split(secret).join(HIDDEN);
  }
  out = out.replace(URL_RE, (url) => (isPushEndpoint(url) ? maskEndpoint(url) : url));
  out = out.replace(EMAIL_RE, (email) => maskEmail(email));
  out = out.replace(PHONE_RE, (phone) => maskPhone(phone));
  out = out.replace(LONG_TOKEN_RE, HIDDEN);
  return out;
}
