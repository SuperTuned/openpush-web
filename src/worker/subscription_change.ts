/**
 * `pushsubscriptionchange`: the browser replaced or dropped the push subscription while
 * no page may be open. Never sends `opt_in`: a row the server holds at −2 stays −2.
 */
import { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";
import { HttpClient, type FetchLike, type HttpResponse } from "../net/http";
import type { QueuedWrite } from "../net/queue";
import { isRetryableStatus } from "../net/retry";
import type { SdkDb } from "../storage/memory";
import type { CfgRow } from "../storage/types";
import { base64urlToBytes, bytesToBase64url, sameBase64 } from "../util/base64url";
import { SDK_VERSION } from "../version";
import { isRecord } from "../util/values";
import type { PushManagerLike, PushSubscriptionChangeEventLike, PushSubscriptionLike } from "./sw_types";

/** Queue kind of a registration the worker could not send; the page sends it on its next load. */
export const WORKER_REGISTRATION_KIND = "worker-registration";

export interface SubscriptionChangeDeps {
  db: SdkDb;
  fetch: FetchLike;
  log: Logger;
  now: () => number;
  pushManager: PushManagerLike;
  /** `Notification.permission` in the worker, when the browser has it. */
  permission: () => string | undefined;
}

export function registrationPath(app: string): string {
  return `/v1/apps/${encodeURIComponent(app)}/subscriptions`;
}

function permissionGone(error: unknown, permission: string | undefined): boolean {
  if (permission !== undefined && permission !== "granted") return true;
  return isRecord(error) && error.name === "NotAllowedError";
}

/** The subscription's key matches `cfg.publicKey`, so `cfg.keyId` names it. */
function keyIdFor(sub: PushSubscriptionLike, cfg: CfgRow): string | undefined {
  if (!cfg.keyId || !cfg.publicKey) return undefined;
  const key = sub.options?.applicationServerKey;
  if (!key) return undefined;
  try {
    return sameBase64(bytesToBase64url(key), cfg.publicKey) ? cfg.keyId : undefined;
  } catch {
    return undefined;
  }
}

/** Step 1: the browser's new subscription, else a new one with the app's key. */
async function newSubscription(event: PushSubscriptionChangeEventLike, cfg: CfgRow, deps: SubscriptionChangeDeps): Promise<PushSubscriptionLike> {
  if (event.newSubscription) return event.newSubscription;
  if (!cfg.publicKey) throw new Error("no public key");
  return deps.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: base64urlToBytes(cfg.publicKey) });
}

async function post(path: string, body: Record<string, unknown>, cfg: CfgRow, deps: SubscriptionChangeDeps): Promise<HttpResponse | "queued"> {
  const server = cfg.server as string;
  const key = cfg.sdkKey as string;
  const http = new HttpClient({ fetch: deps.fetch, serverUrl: () => server, sdkKey: () => key, log: deps.log, allowed: () => true });
  let res: HttpResponse | undefined;
  try {
    res = await http.send({ method: "POST", path, body });
  } catch (error) {
    if (error instanceof OpenPushError && error.code !== "network") throw error;
  }
  if (res && (res.status < 400 || !isRetryableStatus(res.status))) return res;
  // Step 5: keep it for the page's write queue on the next load.
  const write: QueuedWrite = { kind: WORKER_REGISTRATION_KIND, method: "POST", path, body, coalesce: "append", createdAt: deps.now() };
  await deps.db.add("queue", write);
  deps.log.debug("The subscription update will be sent on the next page load");
  return "queued";
}

/** Adopts what the server answered: the row id, a newly issued device secret, and an opt-out. */
async function adopt(res: HttpResponse, deps: SubscriptionChangeDeps): Promise<void> {
  if (!res.ok) {
    deps.log.warn(`The server refused the subscription update (${res.status})`);
    return;
  }
  if (!isRecord(res.body)) return;
  const patch: Partial<CfgRow> = {};
  if (typeof res.body.id === "string" && res.body.id) patch.subscriptionId = res.body.id;
  if (typeof res.body.device_secret === "string" && res.body.device_secret) {
    deps.log.addSecret(res.body.device_secret);
    patch.deviceSecret = res.body.device_secret;
  }
  if (Object.keys(patch).length > 0) await deps.db.mergeCfg(patch);
  if (res.body.status === -2) await deps.db.mergeState({ optedOut: true, lastStatus: -2 });
}

export async function handleSubscriptionChange(event: PushSubscriptionChangeEventLike, cfg: CfgRow | undefined, deps: SubscriptionChangeDeps): Promise<void> {
  const { log } = deps;
  if (!cfg?.app || !cfg.server || !cfg.sdkKey) {
    log.debug("The push subscription changed before the SDK stored its config; the next page load registers it");
    return;
  }
  const path = registrationPath(cfg.app);
  let sub: PushSubscriptionLike;
  try {
    sub = await newSubscription(event, cfg, deps);
  } catch (error) {
    if (!permissionGone(error, deps.permission())) {
      log.warn("The push subscription changed and a new one could not be made; the next page load tries again");
      return;
    }
    // Step 4: permission is gone.
    if (!cfg.token) return;
    const body: Record<string, unknown> = { platform: "web", token: cfg.token, status: 0, previous_token: cfg.token, sdk_version: SDK_VERSION };
    if (cfg.subscriptionId) body.subscription_id = cfg.subscriptionId;
    if (cfg.deviceSecret) body.device_secret = cfg.deviceSecret;
    const res = await post(path, body, cfg, deps);
    if (res !== "queued") await adopt(res, deps);
    return;
  }
  // Step 2: register the new subscription on the same row.
  const previous = event.oldSubscription?.endpoint || cfg.token;
  const body: Record<string, unknown> = { platform: "web", subscription: sub.toJSON(), sdk_version: SDK_VERSION };
  if (previous && previous !== sub.endpoint) body.previous_token = previous;
  if (cfg.subscriptionId) body.subscription_id = cfg.subscriptionId;
  if (cfg.deviceSecret) body.device_secret = cfg.deviceSecret;
  const keyId = keyIdFor(sub, cfg);
  if (keyId) body.vapid_key_id = keyId;
  // Step 3: the browser now has this subscription, whatever the server answers.
  await deps.db.mergeCfg({ token: sub.endpoint });
  const res = await post(path, body, cfg, deps);
  if (res !== "queued") await adopt(res, deps);
}
