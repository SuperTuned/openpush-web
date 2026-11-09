/**
 * `OpenPush.Verify`: phone codes over the public routes, with the mobile names.
 * `start` posts `{to, channel, locale?}` to `/v1/apps/{app}/verify`, `check` posts `{to, code}`
 * to `/verify/{id}/check`, `resend` posts `{to, channel}` to `/verify/{id}/resend`. Each call is
 * one request and is not retried. The full number stays in memory, for `check` and `resend` only.
 */
import type { InitContext } from "../core/hooks";
import { OpenPushError } from "../errors";
import { phoneNumber } from "../user/validate";

export type VerifyChannel = "auto" | "sms" | "whatsapp" | "call";

/** A phone code in progress. The number itself is not on this object. */
export interface Verification {
  readonly id: string;
  /** The number with most digits hidden, as the server writes it. */
  readonly maskedNumber: string;
  /** The channel the server used. */
  readonly channel: string;
  /** "pending" (also after a wrong code), "approved", "expired" or "max_attempts". */
  readonly status: string;
  readonly attempts: number;
  /** Seconds since the epoch, when the server says. */
  readonly expiresAt: number | null;
}

export interface VerifyApi {
  start(phone: string, channel?: VerifyChannel, locale?: string): Promise<Verification>;
  check(verification: Verification, code: string): Promise<Verification>;
  resend(verification: Verification, channel?: VerifyChannel): Promise<Verification>;
}

const CHANNELS: readonly string[] = ["auto", "sms", "whatsapp", "call"];
const numbers = new WeakMap<Verification, string>();

function channelOf(value: unknown, fallback: VerifyChannel): VerifyChannel {
  if (value === undefined) return fallback;
  if (typeof value !== "string" || !CHANNELS.includes(value)) throw new OpenPushError("invalid_argument", `Unknown channel "${String(value)}"`);
  return value as VerifyChannel;
}

/**
 * The server's refusals keep their reason in `detail.reason` (`opted_out`, `credit`, `no_rate`,
 * `too_soon`, `not_pending`, `provider`, …): 429 is `rate_limited`, a 5xx or no answer is
 * `network`, any other refusal `invalid_argument`.
 */
function refusal(status: number, body: unknown): OpenPushError {
  const detail = body && typeof body === "object" ? (body as { detail?: unknown }).detail : undefined;
  const info = detail && typeof detail === "object" ? (detail as { code?: unknown; message?: unknown }) : {};
  const reason = typeof info.code === "string" ? info.code : "refused";
  const message = typeof info.message === "string" ? info.message : typeof detail === "string" ? detail : `The phone code request was refused (${status})`;
  const code = status === 429 ? "rate_limited" : status >= 500 ? "network" : "invalid_argument";
  return new OpenPushError(code, message, { reason, status });
}

export function verifyApi(ready: () => Promise<InitContext>): VerifyApi {
  const call = async (path: string, body: Record<string, unknown>, number: string): Promise<Verification> => {
    const ctx = await ready();
    const res = await ctx.http.send({ method: "POST", path: `/v1/apps/${encodeURIComponent(ctx.options.appId)}/verify${path}`, body });
    const out = res.body as Record<string, unknown> | undefined;
    if (!res.ok) throw refusal(res.status, res.body);
    if (!out || typeof out.id !== "string") throw new OpenPushError("network", "The phone code answer could not be read");
    const verification: Verification = Object.freeze({
      id: out.id,
      maskedNumber: typeof out.to === "string" ? out.to : "",
      channel: typeof out.channel === "string" ? out.channel : "",
      status: typeof out.status === "string" ? out.status : "pending",
      attempts: typeof out.attempts === "number" ? out.attempts : 0,
      expiresAt: typeof out.expires_at === "number" ? out.expires_at : null,
    });
    numbers.set(verification, number);
    return verification;
  };
  const numberOf = (verification: Verification): string => {
    const number = verification && numbers.get(verification);
    if (!number) throw new OpenPushError("invalid_argument", "Pass the verification that start returned");
    return number;
  };
  return {
    async start(phone, channel, locale) {
      const to = phoneNumber(phone);
      if (!to) throw new OpenPushError("invalid_argument", "Not a phone number in international form (+ and 8 to 15 digits)");
      const body: Record<string, unknown> = { to, channel: channelOf(channel, "auto") };
      if (typeof locale === "string" && locale) body.locale = locale;
      return call("", body, to);
    },
    async check(verification, code) {
      const to = numberOf(verification);
      if (typeof code !== "string" || !/^\d{3,10}$/.test(code.trim())) throw new OpenPushError("invalid_argument", "The code must be digits");
      return call(`/${encodeURIComponent(verification.id)}/check`, { to, code: code.trim() }, to);
    },
    async resend(verification, channel) {
      const to = numberOf(verification);
      return call(`/${encodeURIComponent(verification.id)}/resend`, { to, channel: channelOf(channel, "call") }, to);
    },
  };
}
