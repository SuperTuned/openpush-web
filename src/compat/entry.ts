/**
 * `openpush-compat.js`: the compatibility layer for the script tag. It loads
 * `openpush.js` from beside itself (unless `window.OpenPush` is already on the page), then puts the
 * compat object on the reference's global and drains the reference's queues.
 */
import { LOG_PREFIX } from "../log/logger";
import { loadCore, type PageGlobals } from "./load_core";
import { setupCompat } from "./runtime";

function boot(win: PageGlobals & typeof globalThis): void {
  const doc = win.document;
  const script = doc.currentScript as HTMLScriptElement | null;
  loadCore(win, doc, script).then(
    (api) => setupCompat(api, () => win.document).install(win),
    (error: unknown) => win.console?.error(`${LOG_PREFIX} The compatibility layer cannot start: ${error instanceof Error ? error.message : String(error)}`),
  );
}

boot(window as PageGlobals & typeof globalThis);
