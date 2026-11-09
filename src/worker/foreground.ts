/** The foreground handshake, worker side. */
import type { OpenPushNotification } from "../notification";
import { isRecord } from "../util/values";
import { message, WORKER_TO_PAGE } from "./channel";
import type { MessageChannelLike, WindowClientLike } from "./sw_types";

export const FOREGROUND_TIMEOUT_MS = 1_000;

export interface ForegroundDeps {
  channel: (() => MessageChannelLike) | undefined;
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

/** Reads `{display}` from the page's answer (a protocol message or the bare object). */
export function readAnswer(data: unknown): boolean | undefined {
  if (!isRecord(data)) return undefined;
  const source = isRecord(data.payload) ? data.payload : data;
  return typeof source.display === "boolean" ? source.display : undefined;
}

/**
 * Asks the focused SDK page whether to show the push. Resolves with the page's answer, or
 * undefined when it does not answer within the timeout (or cannot be asked).
 */
export function askForeground(
  client: WindowClientLike,
  notification: OpenPushNotification,
  deps: ForegroundDeps,
  timeoutMs = FOREGROUND_TIMEOUT_MS,
): Promise<boolean | undefined> {
  if (!deps.channel) return Promise.resolve(undefined);
  return new Promise((resolve) => {
    let done = false;
    let channel: MessageChannelLike;
    try {
      channel = deps.channel!();
    } catch {
      resolve(undefined);
      return;
    }
    const finish = (value: boolean | undefined): void => {
      if (done) return;
      done = true;
      deps.clearTimeout(timer);
      channel.port1.onmessage = null;
      try {
        channel.port1.close?.();
      } catch {
        // Ignore.
      }
      resolve(value);
    };
    const timer = deps.setTimeout(() => finish(undefined), timeoutMs);
    channel.port1.onmessage = (event) => {
      const answer = readAnswer(event.data);
      if (answer !== undefined) finish(answer);
    };
    try {
      client.postMessage(message(WORKER_TO_PAGE.foreground, { notification }), [channel.port2]);
    } catch {
      finish(undefined);
    }
  });
}
