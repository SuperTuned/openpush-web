/**
 * Email, SMS and WhatsApp subscriptions of the user, as on mobile: each is its own
 * registration with `platform` "email", "sms" or "whatsapp" and the address as `token`, owned by
 * the user logged in when the call is made. A new number is not verified until a phone code
 * proves it; removing sends `status: -2`.
 */
import type { InitContext } from "../core/hooks";
import type { Logger } from "../log/logger";
import { maskEmail, maskPhone } from "../log/redact";
import type { RequestBody } from "../push/body";
import { registrationPath } from "../worker/subscription_change";
import { hash32 } from "../util/hash";
import { emailAddress, phoneNumber } from "./validate";

export type Channel = "email" | "sms" | "whatsapp";

/** The consent wording the person saw, recorded with the address (used by OpenPush prompts). */
export interface ChannelConsent {
  text: string;
  origin: string;
}

export interface ChannelDeps {
  log: Logger;
  /** The `initialize` promise; undefined before `initialize` is called. */
  initialized: () => Promise<void> | undefined;
  context: () => InitContext | undefined;
  identity: () => RequestBody;
}

export class ChannelWriter {
  constructor(private readonly deps: ChannelDeps) {}

  /** True when the value is valid and the write was queued; false (with a log line) otherwise. */
  write(channel: Channel, value: unknown, remove: boolean, consent?: ChannelConsent): boolean {
    const log = this.deps.log;
    const clean = channel === "email" ? emailAddress(value) : phoneNumber(value);
    if (!clean) {
      log.warn(channel === "email" ? "Not an email address; nothing was sent" : "Not a phone number in international form (+ and 8 to 15 digits); nothing was sent");
      return false;
    }
    const init = this.deps.initialized();
    if (!init) {
      log.warn("Call OpenPush.initialize before adding an email address or a phone number");
      return false;
    }
    const masked = channel === "email" ? maskEmail(clean) : maskPhone(clean);
    const body: RequestBody = { platform: channel, token: clean, ...this.deps.identity() };
    if (remove) body.status = -2;
    if (consent && typeof consent.text === "string" && typeof consent.origin === "string") {
      body.consent = { text: consent.text.slice(0, 300), origin: consent.origin.slice(0, 255) };
    }
    void init
      .catch(() => undefined)
      .then(() => this.send(this.deps.context(), channel, clean, body))
      .then(
        (answer) => {
          if (channel === "email" && !remove && answer?.status === -2) log.info(`${masked} is on this app's unsubscribe list; nothing will be sent to it`);
          else log.debug(`${channel} ${masked} ${remove ? "removed" : "added"}`);
        },
        () => log.warn(`The server did not accept ${masked}`),
      );
    return true;
  }

  private async send(ctx: InitContext | undefined, channel: Channel, value: string, body: RequestBody): Promise<Record<string, unknown> | undefined> {
    if (!ctx) throw new Error("not initialized");
    // A later write for the same address replaces one still waiting.
    const res = await ctx.queue.enqueue({
      kind: `${channel}:${hash32(value)}`,
      method: "POST",
      path: registrationPath(ctx.options.appId),
      body,
      coalesce: "replace",
    });
    return res.body && typeof res.body === "object" ? (res.body as Record<string, unknown>) : undefined;
  }
}
