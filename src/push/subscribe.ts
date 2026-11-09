/**
 * `pushManager.subscribe()` with the same-visit retries of a silent move, and the key
 * checks around it.
 */
import type { Timers } from "../net/queue";
import type { PagePushManager, PagePushSubscription } from "../worker/registration";
import { base64urlToBytes, bytesToBase64url, sameBase64 } from "../util/base64url";

/** After the first try fails: 3 more tries, after 1 s, 4 s and 15 s. */
export const SUBSCRIBE_RETRY_DELAYS_MS: readonly number[] = [1_000, 4_000, 15_000];

export type SubscribeOutcome =
  | { ok: true; subscription: PagePushSubscription }
  | { ok: false; error: unknown; tries: number };

export interface SubscribeOptions {
  /** Retry delays; empty for a single try. */
  delays?: readonly number[];
  timers: Timers;
  /** Stops retrying (for example in a private window, where retries cannot help). */
  giveUp?: (error: unknown) => boolean;
  onRetry?: (attempt: number, error: unknown) => void;
}

function wait(timers: Timers, ms: number): Promise<void> {
  return new Promise((resolve) => {
    timers.setTimeout(resolve, ms);
  });
}

/** Subscribes with `publicKey` (base64url), retrying per `delays`. Never throws. */
export async function subscribeWithRetries(manager: PagePushManager, publicKey: string, options: SubscribeOptions): Promise<SubscribeOutcome> {
  const delays = options.delays ?? SUBSCRIBE_RETRY_DELAYS_MS;
  let key: Uint8Array<ArrayBuffer>;
  try {
    key = base64urlToBytes(publicKey);
  } catch (error) {
    return { ok: false, error, tries: 0 };
  }
  let tries = 0;
  for (;;) {
    tries += 1;
    try {
      const subscription = await manager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      return { ok: true, subscription };
    } catch (error) {
      const delay = delays[tries - 1];
      if (delay === undefined || options.giveUp?.(error)) return { ok: false, error, tries };
      options.onRetry?.(tries, error);
      await wait(options.timers, delay);
    }
  }
}

/**
 * Whether `sub` was made with `publicKey`: true or false when the browser says which key it used,
 * undefined when it does not.
 */
export function madeWithKey(sub: PagePushSubscription, publicKey: string | undefined): boolean | undefined {
  const key = sub.options?.applicationServerKey;
  if (!key || !publicKey) return undefined;
  try {
    return sameBase64(bytesToBase64url(key), publicKey);
  } catch {
    return undefined;
  }
}

/** The key a subscription was made with, as base64url, when the browser says. */
export function keyOf(sub: PagePushSubscription): string | undefined {
  const key = sub.options?.applicationServerKey;
  if (!key) return undefined;
  try {
    return bytesToBase64url(key);
  } catch {
    return undefined;
  }
}
