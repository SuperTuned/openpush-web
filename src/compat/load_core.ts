/** Loads `openpush.js` for the compatibility layer's script-tag build. */
import { SDK_ORIGIN } from "../config/build";
import type { OpenPushApi } from "../core/sdk";
import { VERSION } from "../version";

const CORE_FILE = "openpush.js";

export interface PageGlobals {
  OpenPush?: OpenPushApi;
}

/** `openpush.js` beside this file; else the hosted path of this version. */
export function coreUrl(scriptSrc: string | undefined): string {
  if (scriptSrc) {
    try {
      return new URL(CORE_FILE, scriptSrc).href;
    } catch {
      // Fall through to the hosted path.
    }
  }
  return `${SDK_ORIGIN}/sdk/web/${VERSION}/${CORE_FILE}`;
}

function present(win: PageGlobals): OpenPushApi | undefined {
  const api = win.OpenPush;
  return api && typeof api.initialize === "function" && typeof api.version === "string" ? api : undefined;
}

/** Resolves with `window.OpenPush`, loading `openpush.js` when it is not on the page yet. */
export function loadCore(win: PageGlobals & typeof globalThis, doc: Document, script: HTMLScriptElement | null): Promise<OpenPushApi> {
  const ready = present(win);
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve, reject) => {
    const tag = doc.createElement("script");
    tag.src = coreUrl(script?.src || undefined);
    tag.async = true;
    if (script?.nonce) tag.nonce = script.nonce;
    tag.addEventListener("load", () => {
      const api = present(win);
      if (api) resolve(api);
      else reject(new Error("the SDK file loaded but did not start"));
    });
    tag.addEventListener("error", () => reject(new Error("the SDK file could not be loaded")));
    (doc.head ?? doc.documentElement).appendChild(tag);
  });
}
