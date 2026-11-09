/**
 * v1 bridge script (`dist/cdn/bridge/openpush.js`): served at `/sdk/web/v1/openpush.js` when
 * the bridge is on. The v2 core with v1's call shapes on `window.OpenPush`. The prompt UI comes
 * from the v2 path beside it (`/sdk/web/v2/openpush-prompts.js`).
 */
import { installDeferred } from "../core/deferred";
import { createOpenPush } from "../core/sdk";
import { LOG_PREFIX } from "../log/logger";
import { browserPlatform } from "../platform/browser";
import { CHUNK_FILE, chunkUrl, scriptLoader } from "../prompts/loader";
import { bridgeApi, type BridgeApi } from "./v1";

interface PageGlobals {
  OpenPush?: { initialize?: unknown; version?: unknown };
  OpenPushDeferred?: unknown;
}

/** `/sdk/web/v1/openpush.js` → `/sdk/web/v2/openpush-prompts.js`; else the hosted path. */
export function bridgePromptsUrl(scriptSrc: string | undefined): string {
  if (scriptSrc) {
    try {
      const url = new URL(scriptSrc);
      if (/\/v1\/[^/]*$/.test(url.pathname)) return new URL(`../v2/${CHUNK_FILE}`, url).href;
    } catch {
      // Fall through.
    }
  }
  return chunkUrl(scriptSrc);
}

function currentScriptSrc(): string | undefined {
  try {
    return (document.currentScript as HTMLScriptElement | null)?.src || undefined;
  } catch {
    return undefined;
  }
}

export function bootBridge(win: PageGlobals & typeof globalThis, scriptSrc: string | undefined): BridgeApi | undefined {
  const existing = win.OpenPush;
  if (existing && typeof existing.initialize === "function" && typeof existing.version === "string") {
    win.console?.warn(`${LOG_PREFIX} The SDK script is on this page twice; the second copy does nothing`);
    return undefined;
  }
  const platform = browserPlatform();
  const { api, runtime } = createOpenPush({ platform, scriptSrc });
  runtime.prompts.setLoader(scriptLoader(() => platform.document?.(), bridgePromptsUrl(scriptSrc), () => runtime.context?.options.nonce));
  const bridge = bridgeApi(api, runtime.log);
  win.OpenPush = bridge;
  installDeferred(win, bridge, () => runtime.initialized, runtime.log);
  return bridge;
}

bootBridge(window as PageGlobals & typeof globalThis, currentScriptSrc());
