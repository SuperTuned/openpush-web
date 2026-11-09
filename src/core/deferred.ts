import type { Logger } from "../log/logger";

export type DeferredCallback<T> = (sdk: T) => unknown;

/** What `window.OpenPushDeferred` becomes once the SDK has loaded. */
export interface DeferredQueue<T> {
  push(...callbacks: DeferredCallback<T>[]): number;
}

/**
 * Drains `OpenPushDeferred`, or the global queue called `name`. Callbacks run
 * one at a time, in order, each awaited. Once one of them has called `initialize`, every later callback waits for it to
 * resolve, so tags pushed after the init snippet run after init. Callbacks pushed later run at
 * once (after any still running).
 */
export function installDeferred<T>(
  target: object,
  sdk: T,
  initPromise: () => Promise<void> | undefined,
  log: Logger,
  name = "OpenPushDeferred",
): DeferredQueue<T> {
  const slot = target as Record<string, unknown>;
  const queued = Array.isArray(slot[name]) ? (slot[name] as unknown[]) : [];
  let chain: Promise<void> = Promise.resolve();
  let count = 0;

  const run = async (callback: unknown): Promise<void> => {
    const init = initPromise();
    if (init) await init.catch(() => undefined);
    if (typeof callback !== "function") {
      log.warn(`${name}.push needs a function`);
      return;
    }
    try {
      await (callback as DeferredCallback<T>)(sdk);
    } catch (error) {
      log.error(`A ${name} callback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const queue: DeferredQueue<T> = {
    push(...callbacks) {
      for (const callback of callbacks) {
        count += 1;
        chain = chain.then(() => run(callback));
      }
      return count;
    },
  };
  queue.push(...(queued as DeferredCallback<T>[]));
  slot[name] = queue;
  return queue;
}
