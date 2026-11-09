import type { LogLevel } from "../log/levels";
import type { RequestHeadersOption } from "../net/request_headers";
import type { ClickBehavior, Webhooks } from "../storage/types";
import type { Bootstrap } from "./bootstrap";
import { httpsUrl } from "../util/values";

/** A prompt definition; the prompt UI reads and checks its fields. */
export type PromptOption = Record<string, unknown>;

export interface WelcomeOptions {
  enabled?: boolean;
  title?: string;
  message?: string;
  url?: string;
}

export interface WebhookOptions {
  displayed?: string;
  clicked?: string;
  dismissed?: string;
  cors?: boolean;
}

/** Options for `OpenPush.initialize`. */
export interface InitOptions {
  appId: string;
  serverUrl?: string;
  serviceWorkerPath?: string;
  serviceWorkerScope?: string;
  autoResubscribe?: boolean;
  prompts?: PromptOption[];
  welcomeNotification?: WelcomeOptions;
  clickBehavior?: Partial<ClickBehavior>;
  keepOnScreen?: boolean;
  webhooks?: WebhookOptions;
  requiresConsent?: boolean;
  allowLocalhost?: boolean;
  defaultUrl?: string;
  defaultTitle?: string;
  logLevel?: LogLevel;
  language?: string;
  nonce?: string;
  promptsLanguage?: string;
  /**
   * Extra headers for the SDK's requests to the OpenPush server: an object of header names and
   * text values, or a function (sync or async) that returns one, called before each request.
   * Headers the SDK or the browser sets (Content-Type, Authorization, Cookie, Host, Origin,
   * X-OP-SDK-Key and others) are left out with a console warning. The service worker sends
   * delivery receipts with the same headers, from a copy kept in this site's IndexedDB.
   */
  requestHeaders?: RequestHeadersOption;
}

export type SetupType = "typical" | "custom";

/**
 * Setup types of a site-builder integration. They behave as a Typical site, except that
 * the integration hosts the worker file itself, so the `serviceWorkerPath` and `serviceWorkerScope`
 * it passes in code win over the console's.
 */
const INTEGRATION_SETUP_TYPES: readonly string[] = ["wordpress"];

const INTEGRATION_WORKER_OPTIONS: readonly ConsoleOption[] = ["serviceWorkerPath", "serviceWorkerScope"];

export interface ResolvedWelcome {
  enabled: boolean;
  title: string;
  message: string;
  url: string;
}

export interface ResolvedOptions {
  appId: string;
  setupType: SetupType;
  serviceWorkerPath: string;
  serviceWorkerScope: string;
  autoResubscribe: boolean;
  prompts: PromptOption[];
  /** Custom code only; on Typical site the server sends the welcome. */
  welcomeNotification: ResolvedWelcome | null;
  clickBehavior: ClickBehavior;
  keepOnScreen: boolean;
  webhooks: Webhooks;
  allowLocalhost: boolean;
  defaultUrl: string;
  defaultTitle: string;
  language: string;
  promptsLanguage: string;
  nonce?: string;
}

export const DEFAULTS = {
  serviceWorkerPath: "/openpush-sw.js",
  serviceWorkerScope: "/",
  autoResubscribe: true,
  keepOnScreen: true,
  clickBehavior: { match: "exact", action: "navigate" } as ClickBehavior,
  welcomeMessage: "Thanks for subscribing",
} as const;

/** Options whose value comes from the console on a Typical site. */
const CONSOLE_OPTIONS = [
  "serviceWorkerPath",
  "serviceWorkerScope",
  "autoResubscribe",
  "prompts",
  "welcomeNotification",
  "clickBehavior",
  "keepOnScreen",
  "webhooks",
] as const;

type ConsoleOption = (typeof CONSOLE_OPTIONS)[number];

export interface Resolution {
  options: ResolvedOptions;
  /** Code options ignored because the console value wins (Typical site). */
  conflicts: ConsoleOption[];
  /** Code values that were not valid and fell back to the default. */
  invalid: string[];
}

function clickFrom(value: { match?: unknown; action?: unknown } | undefined): ClickBehavior | undefined {
  if (!value) return undefined;
  const match = value.match ?? DEFAULTS.clickBehavior.match;
  const action = value.action ?? DEFAULTS.clickBehavior.action;
  if ((match !== "exact" && match !== "origin") || (action !== "navigate" && action !== "focus")) return undefined;
  return { match, action };
}

function webhooksFrom(value: WebhookOptions | Bootstrap["webhooks"] | undefined, invalid: string[]): Webhooks {
  const out: Webhooks = { displayed: null, clicked: null, dismissed: null, cors: false };
  if (!value) return out;
  for (const event of ["displayed", "clicked", "dismissed"] as const) {
    const raw = value[event];
    const url = httpsUrl(raw);
    if (raw && !url) invalid.push(`webhooks.${event}`);
    out[event] = url;
  }
  out.cors = value.cors === true;
  return out;
}

/**
 * Marks options a wrapper filled with its own default rather than the site's code (the
 * compatibility layer's worker path). On a Typical site they are not reported as ignored
 * code options. A `Symbol.for` key, so it crosses from the compat file to `openpush.js`; it is not
 * part of `InitOptions`.
 */
const DEFAULTED = Symbol.for("openpush.defaulted-options");

export function markDefaulted(options: InitOptions, names: readonly (keyof InitOptions)[]): void {
  Object.defineProperty(options, DEFAULTED, { value: [...names], enumerable: false, configurable: true });
}

function defaulted(code: InitOptions): readonly unknown[] {
  const names = (code as unknown as Record<symbol, unknown>)[DEFAULTED];
  return Array.isArray(names) ? names : [];
}

function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Effective options per setup type. Typical site: the console values in the bootstrap win
 * and a conflicting code value is reported (one warning per page). Custom code: code values, with
 * the defaults table.
 */
export function resolveOptions(code: InitOptions, boot: Bootstrap, env: { language: string }): Resolution {
  const integration = INTEGRATION_SETUP_TYPES.includes(boot.setup_type ?? "");
  const setupType: SetupType = boot.setup_type === "typical" || integration ? "typical" : "custom";
  const siteOrigin = boot.site?.origin ?? "";
  const siteName = boot.site?.name ?? "";
  const invalid: string[] = [];

  const codeClick = code.clickBehavior === undefined ? undefined : clickFrom(code.clickBehavior);
  if (code.clickBehavior !== undefined && !codeClick) invalid.push("clickBehavior");

  const fromCode = {
    serviceWorkerPath: code.serviceWorkerPath ?? DEFAULTS.serviceWorkerPath,
    serviceWorkerScope: code.serviceWorkerScope ?? DEFAULTS.serviceWorkerScope,
    autoResubscribe: code.autoResubscribe ?? DEFAULTS.autoResubscribe,
    prompts: code.prompts ?? [],
    welcomeNotification: {
      enabled: code.welcomeNotification?.enabled ?? true,
      title: code.welcomeNotification?.title ?? siteName,
      message: code.welcomeNotification?.message ?? DEFAULTS.welcomeMessage,
      url: code.welcomeNotification?.url ?? siteOrigin,
    } as ResolvedWelcome | null,
    clickBehavior: codeClick ?? { ...DEFAULTS.clickBehavior },
    keepOnScreen: code.keepOnScreen ?? DEFAULTS.keepOnScreen,
    webhooks: webhooksFrom(code.webhooks, invalid),
  };

  let picked = fromCode;
  const conflicts: ConsoleOption[] = [];
  if (setupType === "typical") {
    const fromConsole: typeof fromCode = {
      serviceWorkerPath: boot.worker?.path || DEFAULTS.serviceWorkerPath,
      serviceWorkerScope: boot.worker?.scope || DEFAULTS.serviceWorkerScope,
      autoResubscribe: boot.auto_resubscribe ?? DEFAULTS.autoResubscribe,
      prompts: Array.isArray(boot.prompts) ? (boot.prompts as PromptOption[]) : [],
      welcomeNotification: null,
      clickBehavior: clickFrom(boot.click) ?? { ...DEFAULTS.clickBehavior },
      keepOnScreen: boot.keep_on_screen ?? DEFAULTS.keepOnScreen,
      webhooks: webhooksFrom(boot.webhooks, []),
    };
    if (integration) {
      if (code.serviceWorkerPath) fromConsole.serviceWorkerPath = code.serviceWorkerPath;
      if (code.serviceWorkerScope) fromConsole.serviceWorkerScope = code.serviceWorkerScope;
    }
    const filled = defaulted(code);
    for (const name of CONSOLE_OPTIONS) {
      if (code[name] === undefined || filled.includes(name)) continue;
      if (integration && INTEGRATION_WORKER_OPTIONS.includes(name)) continue;
      if (name === "welcomeNotification" || !sameValue(fromCode[name], fromConsole[name])) conflicts.push(name);
    }
    picked = fromConsole;
  }

  const language = code.language || env.language || "en";
  const options: ResolvedOptions = {
    appId: code.appId,
    setupType,
    ...picked,
    allowLocalhost: code.allowLocalhost === true,
    defaultUrl: code.defaultUrl || siteOrigin,
    defaultTitle: code.defaultTitle || siteName,
    language,
    promptsLanguage: code.promptsLanguage || language,
  };
  if (code.nonce) options.nonce = code.nonce;
  return { options, conflicts, invalid };
}
