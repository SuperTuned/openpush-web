import type { EnvInfo } from "../env/detect";
import type { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";
import type { HttpClient } from "../net/http";
import type { WriteQueue } from "../net/queue";
import type { LocalStore } from "../storage/local";
import type { SdkDb } from "../storage/memory";
import type { CfgRow } from "../storage/types";
import type { RegistrationLike } from "../worker/registration";
import type { Bootstrap } from "./bootstrap";
import type { ResolvedOptions } from "./options";

/** What a lifecycle step can see. Built during `initialize`; refreshed when a fresh config arrives. */
export interface InitContext {
  options: ResolvedOptions;
  bootstrap: Bootstrap | undefined;
  /** The `cfg` row as it was before this page load changed it (the other-app check needs it). */
  previousCfg: CfgRow | undefined;
  cfg: CfgRow;
  env: EnvInfo;
  /** Why push features are stopped on this page, if they are. */
  pushBlocked: OpenPushError | undefined;
  /** False when prompts must stay hidden (wrong origin, web push off, no config). */
  promptsAllowed: boolean;
  registration: RegistrationLike | undefined;
  db: SdkDb;
  local: LocalStore;
  http: HttpClient;
  queue: WriteQueue;
  log: Logger;
}

/**
 * Seams for the steps later modules fill. Each runs inside `initialize`; an error is logged
 * and never fails `initialize`.
 */
export interface LifecycleHooks {
  /** Step 6: permission and subscription reconcile, auto resubscribe and the silent move. */
  reconcilePush?(ctx: InitContext): Promise<void>;
  /** Step 7: page view count and sessions. */
  startSessions?(ctx: InitContext): Promise<void> | void;
  /** Steps 10 and 11, after `initialize` resolved: prompts and the verify bar. Not awaited. */
  afterInitialize?(ctx: InitContext): Promise<void> | void;
  /** A fresh config replaced the cached one after `initialize` (stale-while-revalidate). */
  configChanged?(ctx: InitContext): Promise<void> | void;
}

/**
 * Combines several hook sets. `reconcilePush`, `startSessions` and `configChanged` run one set
 * after another, in order; `afterInitialize` steps are independent and run side by side. A
 * failure in one set does not skip the others; the first failure is rethrown for the log.
 */
export function composeHooks(...sets: readonly (LifecycleHooks | undefined)[]): LifecycleHooks {
  const list = sets.filter((s): s is LifecycleHooks => !!s);
  const sequential =
    (name: keyof LifecycleHooks) =>
    async (ctx: InitContext): Promise<void> => {
      let failure: unknown;
      for (const hooks of list) {
        try {
          await hooks[name]?.(ctx);
        } catch (error) {
          failure ??= error;
        }
      }
      if (failure !== undefined) throw failure;
    };
  const parallel =
    (name: keyof LifecycleHooks) =>
    async (ctx: InitContext): Promise<void> => {
      const results = await Promise.allSettled(list.map(async (hooks) => hooks[name]?.(ctx)));
      const failed = results.find((r): r is PromiseRejectedResult => r.status === "rejected");
      if (failed) throw failed.reason;
    };
  return {
    reconcilePush: sequential("reconcilePush"),
    startSessions: sequential("startSessions"),
    afterInitialize: parallel("afterInitialize"),
    configChanged: sequential("configChanged"),
  };
}
