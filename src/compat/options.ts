/**
 * `init` option shapes of the reference → `OpenPush.initialize` options. On a
 * Typical-site app the console values still win, as for OpenPush's own code (the core decides).
 */
import { markDefaulted, type InitOptions, type WebhookOptions, type WelcomeOptions } from "../core/options";
import type { ClickBehavior } from "../storage/types";
import { REF_WORKER_FILE } from "./names";
import { mapPrompts, obj } from "./prompts";

export interface InitMapping {
  options: InitOptions;
  /** Options that are not mapped and do nothing (logged once at warn). */
  ignored: string[];
  /** Options accepted and not supported (logged once at info). */
  unsupported: string[];
  /** The email or phone prompt uses the default consent line (logged once). */
  defaultConsent: boolean;
  displayPredicate?: () => unknown;
  /** A placed button renders into the reference's containers too. */
  placedButton: boolean;
}

/** Reference options mapped one to one. */
const SAME: Record<string, keyof InitOptions> = {
  requiresUserPrivacyConsent: "requiresConsent",
  allowLocalhostAsSecureOrigin: "allowLocalhost",
  autoResubscribe: "autoResubscribe",
  persistNotification: "keepOnScreen",
};

/** OpenPush option names a migrating site may also pass; they keep their meaning. */
const OWN: readonly (keyof InitOptions)[] = ["serverUrl", "logLevel", "language", "promptsLanguage", "nonce", "defaultUrl", "defaultTitle"];

/** Mapped by the code below. */
const HANDLED = new Set([
  "appId",
  "serviceWorkerPath",
  "serviceWorkerParam",
  "notifyButton",
  "promptOptions",
  "welcomeNotification",
  "webhooks",
  "notificationClickHandlerMatch",
  "notificationClickHandlerAction",
  "safari_web_id",
  ...Object.keys(SAME),
  ...OWN,
]);

/** "push/worker.js" → "/push/worker.js"; an absolute URL or a rooted path stays as it is. */
export function workerPath(value: unknown): string {
  if (typeof value !== "string" || value.trim() === "") return `/${REF_WORKER_FILE}`;
  const path = value.trim();
  if (path.startsWith("/") || /^[a-z][a-z0-9+.-]*:/i.test(path)) return path;
  return `/${path}`;
}

function str(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function welcome(value: unknown): WelcomeOptions | undefined {
  const w = obj(value);
  if (!w) return undefined;
  const out: WelcomeOptions = { enabled: w.disable !== true };
  const title = str(w.title);
  const message = str(w.message);
  const url = str(w.url);
  if (title !== undefined) out.title = title;
  if (message !== undefined) out.message = message;
  if (url !== undefined) out.url = url;
  return out;
}

function webhooks(value: unknown): WebhookOptions | undefined {
  const w = obj(value);
  if (!w) return undefined;
  const out: WebhookOptions = { cors: w.cors === true };
  const displayed = str(w["notification.willDisplay"]);
  const clicked = str(w["notification.clicked"]);
  const dismissed = str(w["notification.dismissed"]);
  if (displayed) out.displayed = displayed;
  if (clicked) out.clicked = clicked;
  if (dismissed) out.dismissed = dismissed;
  return out;
}

function click(match: unknown, action: unknown): Partial<ClickBehavior> | undefined {
  if (match === undefined && action === undefined) return undefined;
  const out: Partial<ClickBehavior> = {};
  if (match !== undefined) out.match = match as ClickBehavior["match"];
  if (action !== undefined) out.action = action as ClickBehavior["action"];
  return out;
}

/** Maps every reference `init` option above. Values are passed on as given; the core validates them. */
export function mapInitOptions(input: unknown): InitMapping {
  const ref = obj(input) ?? {};
  const options: InitOptions = { appId: typeof ref.appId === "string" ? ref.appId : "" };
  const set = options as unknown as Record<string, unknown>;

  for (const [from, to] of Object.entries(SAME)) if (ref[from] !== undefined) set[to] = ref[from];
  for (const name of OWN) if (ref[name] !== undefined) set[name] = ref[name];

  // The reference's default file at the root, so an unchanged site keeps its registration
  // (Custom code). Marked as a default: on a Typical site the console's path wins without the
  // "code options ignored" warning, since the site set nothing.
  options.serviceWorkerPath = workerPath(ref.serviceWorkerPath);
  if (typeof ref.serviceWorkerPath !== "string" || ref.serviceWorkerPath.trim() === "") markDefaulted(options, ["serviceWorkerPath"]);
  const scope = str(obj(ref.serviceWorkerParam)?.scope);
  if (scope) options.serviceWorkerScope = scope;

  const prompts = mapPrompts(ref.notifyButton, ref.promptOptions);
  if (prompts.prompts.length > 0) options.prompts = prompts.prompts;

  const w = welcome(ref.welcomeNotification);
  if (w) options.welcomeNotification = w;
  const hooks = webhooks(ref.webhooks);
  if (hooks) options.webhooks = hooks;
  const behavior = click(ref.notificationClickHandlerMatch, ref.notificationClickHandlerAction);
  if (behavior) options.clickBehavior = behavior;

  const unsupported = [...prompts.unsupported];
  if (ref.safari_web_id !== undefined) unsupported.unshift("safari_web_id");
  const ignored = Object.keys(ref).filter((key) => !HANDLED.has(key));

  const mapping: InitMapping = {
    options,
    ignored,
    unsupported,
    defaultConsent: prompts.defaultConsent,
    placedButton: prompts.placedButton,
  };
  if (prompts.displayPredicate) mapping.displayPredicate = prompts.displayPredicate;
  return mapping;
}
