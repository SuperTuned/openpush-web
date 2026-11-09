/** Builds the compat object for a page's `OpenPush` object (the script tag and npm entries share it). */
import { internalOf } from "../core/internal";
import type { OpenPushApi } from "../core/sdk";
import { createCompat, type CompatSdk } from "./facade";
import { installGlobals, markLinkContainers } from "./loading";

export interface CompatSetup {
  compat: CompatSdk;
  /** Puts the compat object on the reference's global and drains its queues. */
  install(win: object): void;
}

export function setupCompat(api: OpenPushApi, doc: () => Document | undefined): CompatSetup {
  const internal = internalOf(api);
  if (!internal) throw new Error("[OpenPush] The compatibility layer needs OpenPush Web SDK 2");
  let marked = false;
  const compat = createCompat({
    api,
    log: internal.log,
    onPermissionPrompt: (listener) => internal.onPermissionPrompt(listener),
    markLinkContainers: () => {
      if (marked) return;
      marked = true;
      markLinkContainers(doc());
    },
  });
  return {
    compat,
    install: (win) => installGlobals(win, compat, () => internal.initialized(), internal.log),
  };
}
