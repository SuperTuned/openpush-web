/**
 * Script-tag build (`openpush.js`, IIFE): defines `window.OpenPush` and drains
 * `window.OpenPushDeferred`.
 */
import { installDeferred } from "../core/deferred";
import { createOpenPush, type OpenPushApi } from "../core/sdk";
import { LOG_PREFIX } from "../log/logger";
import { browserPlatform } from "../platform/browser";

interface PageGlobals {
  OpenPush?: OpenPushApi;
  OpenPushDeferred?: unknown;
}

function currentScriptSrc(): string | undefined {
  try {
    const script = document.currentScript as HTMLScriptElement | null;
    return script?.src || undefined;
  } catch {
    return undefined;
  }
}

function boot(win: PageGlobals & typeof globalThis, scriptSrc: string | undefined): void {
  const existing = win.OpenPush;
  if (existing && typeof existing.initialize === "function" && typeof existing.version === "string") {
    win.console?.warn(`${LOG_PREFIX} The SDK script is on this page twice; the second copy does nothing`);
    return;
  }
  const { api, runtime } = createOpenPush({ platform: browserPlatform(), scriptSrc });
  win.OpenPush = api;
  installDeferred(win, api, () => runtime.initialized, runtime.log);
}

boot(window as PageGlobals & typeof globalThis, currentScriptSrc());
