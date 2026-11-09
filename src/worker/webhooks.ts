/**
 * Client webhooks: the worker posts to the site's own URLs on displayed, clicked
 * and dismissed. Fire and forget, one try.
 */
import type { Logger } from "../log/logger";
import type { FetchLike } from "../net/http";
import type { OpenPushNotification } from "../notification";
import type { CfgRow } from "../storage/types";
import { httpsUrl } from "../util/values";

export type WebhookEvent = "displayed" | "clicked" | "dismissed";

export const WEBHOOK_EVENT_HEADER = "X-OpenPush-Event";

export interface WebhookRequest {
  url: string;
  init: RequestInit;
}

/**
 * The request for one webhook, or undefined when none is set for `event`. Without CORS headers
 * it is a simple `no-cors` request with a `text/plain` body (no preflight). With them it is a
 * `cors` JSON request with `X-OpenPush-Event` and the subscription id.
 */
export function webhookRequest(
  event: WebhookEvent,
  cfg: CfgRow | undefined,
  n: OpenPushNotification,
  extra: { url: string; actionId?: string },
): WebhookRequest | undefined {
  const target = httpsUrl(cfg?.webhooks?.[event]);
  if (!target) return undefined;
  const name = `notification.${event}`;
  const body: Record<string, unknown> = {
    event: name,
    message_id: n.id,
    title: n.title,
    body: n.body,
    data: n.data,
    url: extra.url,
  };
  if (event === "clicked") body.action_id = extra.actionId ?? "";
  if (cfg?.webhooks?.cors) {
    if (cfg.subscriptionId) body.subscription_id = cfg.subscriptionId;
    return {
      url: target,
      init: {
        method: "POST",
        mode: "cors",
        credentials: "omit",
        headers: { "Content-Type": "application/json", [WEBHOOK_EVENT_HEADER]: name },
        body: JSON.stringify(body),
      },
    };
  }
  return {
    url: target,
    init: {
      method: "POST",
      mode: "no-cors",
      credentials: "omit",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
    },
  };
}

/** Sends the webhook if one is set. Never rejects. */
export async function fireWebhook(
  fetch: FetchLike,
  log: Logger,
  event: WebhookEvent,
  cfg: CfgRow | undefined,
  n: OpenPushNotification,
  extra: { url: string; actionId?: string },
): Promise<void> {
  const req = webhookRequest(event, cfg, n, extra);
  if (!req) return;
  try {
    await fetch(req.url, req.init);
  } catch {
    log.debug(`The ${event} webhook could not be sent`);
  }
}
