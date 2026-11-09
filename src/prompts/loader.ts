/**
 * The prompt loader in `openpush.js`. It counts the page view, decides
 * whether any prompt or the verify bar can apply to this page, and only then loads the prompt UI
 * chunk (`openpush-prompts.js`). `OpenPush.Prompts.*` calls load it on demand. Prompt event
 * listeners live here, so they can be added before the chunk loads.
 *
 * The chunk comes from, in order: a loader set with `setLoader`; `globalThis.OpenPushPrompts`
 * when it is already on the page (a bundle that imported the prompts entry); else a `<script>`
 * from the path `openpush.js` was loaded from (hosted and self-hosted builds), or the versioned
 * hosted path for bundled builds.
 */
import { SDK_ORIGIN } from "../config/build";
import type { InitContext, LifecycleHooks } from "../core/hooks";
import { detectEnv } from "../env/detect";
import { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";
import type { Platform } from "../platform/types";
import type { PushController } from "../push/controller";
import { hasDirectRow } from "../push/plan";
import type { LocalStore } from "../storage/local";
import type { ChannelWriter } from "../user/channels";
import type { UserController } from "../user/user";
import type { VerifyApi } from "../verify/verify";
import { VERSION } from "../version";
import { PromptStore } from "./store";
import {
  AUTO_ORDER,
  PROMPT_EVENTS,
  VERIFY_PARAM,
  type ChunkLoader,
  type HostView,
  type PromptDom,
  type PromptEvent,
  type PromptEventName,
  type PromptListener,
  type PromptsApi,
  type PromptsChunk,
  type PromptsHost,
  type PromptsUi,
  type ShowKind,
  type ShowOptions,
} from "./types";

export const CHUNK_FILE = "openpush-prompts.js";

export interface PromptsHubDeps {
  platform: Platform;
  log: Logger;
  local: LocalStore;
  push: PushController;
  user: UserController;
  channels: ChannelWriter;
  verify: VerifyApi;
  context: () => InitContext | undefined;
  ready: () => Promise<InitContext>;
  /** `document.currentScript.src` of `openpush.js`, for the script-tag build. */
  scriptSrc?: string;
  /** When this page loaded (ms). */
  pageStart: number;
}

/** Where the chunk is loaded from: beside `openpush.js`, else the versioned hosted path. */
export function chunkUrl(scriptSrc: string | undefined): string {
  if (scriptSrc) {
    try {
      return new URL(CHUNK_FILE, scriptSrc).href;
    } catch {
      // Fall through to the hosted path.
    }
  }
  return `${SDK_ORIGIN}/sdk/web/${VERSION}/${CHUNK_FILE}`;
}

export function hasVerifyParam(href: string): boolean {
  try {
    return new URL(href).searchParams.has(VERIFY_PARAM);
  } catch {
    return false;
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : undefined;
}

/**
 * True when a raw prompt could show on this page: the bell and buttons always; an auto prompt
 * whose page views are reached and that is not in its cooldown. The chunk checks the rest.
 */
export function mayApply(raw: unknown, views: number, coolingDown: (type: string) => boolean): boolean {
  const p = record(raw);
  if (!p || p.enabled === false) return false;
  if (p.type === "bell" || p.type === "button") return true;
  if (!(AUTO_ORDER as readonly unknown[]).includes(p.type)) return false;
  const timing = record(p.timing) ?? {};
  if (timing.auto === false) return false;
  const need = typeof timing.page_views === "number" ? timing.page_views : 1;
  return views >= need && !coolingDown(p.type as string);
}

/** Loads the chunk with a `<script>` (CSP nonce when given) and reads `globalThis.OpenPushPrompts`. */
export function scriptLoader(doc: () => Document | undefined, url: string, nonce: () => string | undefined): ChunkLoader {
  return () =>
    new Promise<PromptsChunk>((resolve, reject) => {
      const d = doc();
      if (!d) {
        reject(new OpenPushError("not_supported", "Prompts need a page document"));
        return;
      }
      const script = d.createElement("script");
      script.src = url;
      script.async = true;
      const n = nonce();
      if (n) script.nonce = n;
      script.addEventListener("load", () => {
        const chunk = globalChunk();
        if (chunk) resolve(chunk);
        else reject(new OpenPushError("network", "The prompt file loaded but did not start"));
      });
      script.addEventListener("error", () => reject(new OpenPushError("network", "The prompt file could not be loaded")));
      (d.head ?? d.documentElement).appendChild(script);
    });
}

function globalChunk(): PromptsChunk | undefined {
  const chunk = (globalThis as { OpenPushPrompts?: Partial<PromptsChunk> }).OpenPushPrompts;
  return chunk && typeof chunk.create === "function" ? (chunk as PromptsChunk) : undefined;
}

export class PromptsHub {
  readonly store: PromptStore;
  private readonly listeners = new Map<PromptEventName, Set<PromptListener>>();
  private loader: ChunkLoader | undefined;
  private ui: Promise<PromptsUi> | undefined;
  private started = false;
  private verifyCode: string | undefined;
  /**
   * The page address as it arrived with `?openpush-verify=`, kept for the verify bar after the
   * parameter was removed from the address bar on load (so it cannot leak through `Referer`).
   */
  private verifyHref: string | undefined;
  private verifyClean: string | undefined;

  constructor(private readonly deps: PromptsHubDeps) {
    this.store = new PromptStore(deps.local);
    this.takeVerifyHref();
    // The verify code rides the next push registration only.
    deps.push.addBodyContributor(() => {
      const code = this.verifyCode;
      if (!code) return undefined;
      this.verifyCode = undefined;
      return { verify_code: code };
    });
  }

  /**
   * Removes `?openpush-verify=` from the address as soon as the SDK loads, before the
   * prompt file (or anything the site loads later) runs; the bar reads the kept address.
   */
  private takeVerifyHref(): void {
    const { platform } = this.deps;
    const href = platform.location()?.href ?? "";
    if (!hasVerifyParam(href) || !platform.replaceUrl) return;
    const url = new URL(href);
    url.searchParams.delete(VERIFY_PARAM);
    this.verifyHref = href;
    this.verifyClean = url.href;
    platform.replaceUrl(url.href);
  }

  /** Replaces how the chunk is loaded (bundlers, tests). */
  setLoader(loader: ChunkLoader): void {
    this.loader = loader;
  }

  hooks(): LifecycleHooks {
    return {
      afterInitialize: (ctx) => this.afterInitialize(ctx),
      configChanged: (ctx) => this.configChanged(ctx),
    };
  }

  api(): PromptsApi {
    const show =
      (kind: ShowKind) =>
      (options?: ShowOptions): Promise<void> =>
        this.show(kind, options);
    return {
      showSlideIn: show("slide_in"),
      showTopics: show("topics"),
      showEmail: show("email"),
      showPhone: show("phone"),
      showEmailOrPhone: show("email_or_phone"),
      showBell: show("bell"),
      addListener: (event, listener) => {
        this.check(event);
        if (typeof listener !== "function") throw new OpenPushError("invalid_argument", "addListener needs a function");
        let set = this.listeners.get(event);
        if (!set) this.listeners.set(event, (set = new Set()));
        set.add(listener);
      },
      removeListener: (event, listener) => {
        this.check(event);
        this.listeners.get(event)?.delete(listener);
      },
    };
  }

  /** After `initialize`: counts the page view, then loads the prompt UI when a prompt or the verify bar applies. */
  private async afterInitialize(ctx: InitContext): Promise<void> {
    this.store.countView();
    if (!this.applies(ctx)) return;
    await this.startUi();
  }

  private async configChanged(ctx: InitContext): Promise<void> {
    if (this.ui) {
      (await this.ui.catch(() => undefined))?.refresh();
      return;
    }
    if (this.applies(ctx)) await this.startUi();
  }

  private applies(ctx: InitContext): boolean {
    if (!ctx.promptsAllowed) return false;
    if (!ctx.pushBlocked && hasVerifyParam(this.verifyHref ?? this.deps.platform.location()?.href ?? "")) return true;
    const now = this.deps.platform.now();
    const views = this.store.views;
    return ctx.options.prompts.some((p) => mayApply(p, views, (type) => this.store.coolingDown(type, now)));
  }

  private async startUi(): Promise<PromptsUi | undefined> {
    try {
      const ui = await this.load();
      if (!this.started) {
        this.started = true;
        ui.start();
      }
      return ui;
    } catch (error) {
      this.deps.log.warn(`Prompts are not shown: ${error instanceof Error ? error.message : String(error)}`);
      return undefined;
    }
  }

  private async show(kind: ShowKind, options: ShowOptions | undefined): Promise<void> {
    const ctx = await this.deps.ready();
    if (!ctx.promptsAllowed) {
      throw ctx.pushBlocked ?? new OpenPushError("config_unavailable", "Prompts cannot show without the app's config");
    }
    const ui = await this.startUi();
    if (!ui) throw new OpenPushError("network", "The prompt file could not be loaded");
    await ui.show(kind, { force: options?.force === true });
  }

  private load(): Promise<PromptsUi> {
    if (!this.ui) {
      const loader = this.loader ?? (globalChunk() ? () => Promise.resolve(globalChunk()!) : this.defaultLoader());
      this.ui = loader().then((chunk) => {
        if (chunk.version !== VERSION) this.deps.log.debug(`The prompt file is version ${chunk.version}; the SDK is ${VERSION}`);
        const host = this.host();
        if (!host) throw new OpenPushError("not_supported", "Prompts need a page document");
        return chunk.create(host);
      });
      // A failed load may be tried again by a later call.
      this.ui.catch(() => {
        this.ui = undefined;
      });
    }
    return this.ui;
  }

  private defaultLoader(): ChunkLoader {
    const platform = this.deps.platform;
    return scriptLoader(() => platform.document?.(), chunkUrl(this.deps.scriptSrc), () => this.deps.context()?.options.nonce);
  }

  private check(event: unknown): asserts event is PromptEventName {
    if (!PROMPT_EVENTS.includes(event as PromptEventName)) {
      throw new OpenPushError("invalid_argument", `Unknown prompt event "${String(event)}"`);
    }
  }

  private emit(name: PromptEventName, event: PromptEvent): void {
    this.deps.log.trace(`Prompt ${event.type} ${name}`);
    for (const listener of [...(this.listeners.get(name) ?? [])]) {
      try {
        listener({ ...event });
      } catch (error) {
        this.deps.log.warn(`A prompt listener threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }

  private dom(): PromptDom | undefined {
    const platform = this.deps.platform;
    const document = platform.document?.();
    if (!document) return undefined;
    return {
      document,
      // The kept verify address until the bar took it; the address bar is already clean then.
      href: () => this.verifyHref ?? platform.location()?.href ?? "",
      replaceUrl: (url) => {
        if (this.verifyHref !== undefined && url === this.verifyClean) {
          // The bar took the code; the address was cleaned on load.
          this.verifyHref = undefined;
          return;
        }
        platform.replaceUrl?.(url);
      },
      onPageHide: (listener) => platform.onPageHide?.(listener),
    };
  }

  private view(): HostView {
    const { platform } = this.deps;
    const ctx = this.deps.context();
    const boot = ctx?.bootstrap;
    const options = ctx?.options;
    const origin = boot?.site?.origin || platform.location()?.origin || "";
    const view: HostView = {
      prompts: options?.prompts ?? [],
      language: options?.promptsLanguage || "en",
      site: { name: boot?.site?.name || options?.defaultTitle || "", origin, icon: boot?.site?.icon || null },
      channels: { email: boot?.channels?.email === true, phone: boot?.channels?.phone === true },
      env: ctx?.env ?? detectEnv(platform),
      allowed: ctx?.promptsAllowed === true,
      pushBlocked: ctx?.pushBlocked,
      newRegistrations: boot?.direct?.new_registrations !== false || (ctx ? hasDirectRow(ctx.cfg) : false),
    };
    if (options?.nonce) view.nonce = options.nonce;
    return view;
  }

  private host(): PromptsHost | undefined {
    const dom = this.dom();
    if (!dom) return undefined;
    const { platform, push, user, channels } = this.deps;
    return {
      log: this.deps.log,
      timers: platform.timers,
      now: () => platform.now(),
      pageStart: this.deps.pageStart,
      store: this.store,
      dom,
      view: () => this.view(),
      settled: () => push.whenIdle(),
      status: () => push.status,
      optedOut: () => push.optedOutLocally,
      permission: () => push.permissionStatus,
      canRequestPermission: () => push.canRequestPermission,
      privateMode: () => push.privateMode,
      subscribe: () => push.subscribeFromGesture({ optIn: true }),
      requestDirect: () => push.subscribeFromGesture({ optIn: false }),
      optOut: () => push.optOut(),
      onPushChange: (listener) => {
        const fire = (): void => listener();
        push.subscriptionObservers.add(fire);
        push.permissionObservers.add(fire);
        return () => {
          push.subscriptionObservers.remove(fire);
          push.permissionObservers.remove(fire);
        };
      },
      getTags: () => user.getTags(),
      addTags: (tags) => user.addTags(tags),
      addEmail: (address, consent) => channels.write("email", address, false, consent),
      addSms: (number, consent) => channels.write("sms", number, false, consent),
      verify: this.deps.verify,
      setVerifyCode: (code) => {
        this.verifyCode = code;
      },
      emit: (name, event) => this.emit(name, event),
      error: (code, message, detail) => new OpenPushError(code, message, detail),
    };
  }
}
