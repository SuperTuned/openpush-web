import { detectEnv, type EnvInfo } from "../env/detect";
import { OpenPushError } from "../errors";
import { DEFAULT_LOG_LEVEL, isLogLevel, levelFromQuery, type LogLevel } from "../log/levels";
import { Logger, type LogListener } from "../log/logger";
import { HttpClient } from "../net/http";
import { IdbQueueStorage, WriteQueue } from "../net/queue";
import type { Platform } from "../platform/types";
import { Db } from "../storage/idb";
import { LOCAL_KEY, LocalStore } from "../storage/local";
import { MemoryDb, type SdkDb } from "../storage/memory";
import type { CfgRow } from "../storage/types";
import { EventTracker } from "../events/events";
import { addNotificationPushApi, pushSubscriptionApi, type NotificationPushApi, type PushSubscriptionApi } from "../push/api";
import { SessionTracker } from "../session/sessions";
import { sessionApi, userApi, type SessionApi, type UserApi } from "../user/api";
import { ChannelWriter } from "../user/channels";
import { UserController, type IdentityVerificationHandler } from "../user/user";
import { verifyApi, type VerifyApi } from "../verify/verify";
import { PromptsHub } from "../prompts/loader";
import type { PromptsApi } from "../prompts/types";
import { PushController } from "../push/controller";
import { configMessage, logLevelMessage, postToWorker } from "../worker/channel";
import { registerWorker, type RegistrationLike } from "../worker/registration";
import { VERSION } from "../version";
import { hasSite, type Bootstrap } from "./bootstrap";
import { ConfigLoader } from "./config";
import { ConsentGate } from "./consent";
import { composeHooks, type InitContext, type LifecycleHooks } from "./hooks";
import {
  NotificationEvents,
  WorkerBridge,
  type ClickListener,
  type DismissListener,
  type ForegroundLifecycleListener,
  type NotificationListenersApi,
} from "./notification_events";
import { resolveOptions, type InitOptions, type ResolvedOptions } from "./options";
import { checkSecureOrigin, checkSiteOrigin } from "./origin";
import { v1Api, type V1ClickPayload, type V1InitResult, type V1PermissionResult } from "./v1";
import { resolveServerUrl } from "./server_url";
import { attachInternal } from "./internal";

export interface DebugApi {
  /** Persisted for later page loads; also reaches the worker. */
  setLogLevel(level: LogLevel): void;
  addLogListener(listener: LogListener): void;
  removeLogListener(listener: LogListener): void;
}

/** `OpenPush.Notifications`. */
export interface NotificationsApi extends NotificationListenersApi, NotificationPushApi {}

/** The public SDK object (`window.OpenPush`, default export of `@openpush/web`). */
export interface OpenPushApi {
  readonly version: string;
  /** Starts the SDK. Once per page; a second call resolves with a warning and changes nothing. */
  initialize(options: InitOptions): Promise<void>;
  /** v1 name of `initialize`; also resolves with v1's `{needsLinkCode, permission}`. */
  init(options: InitOptions): Promise<V1InitResult>;
  /**
   * Sets the external ID on this browser's row. Call on every page load once the user is known.
   * `authHash` is made on your server when the app has identity verification on.
   */
  login(externalId: string, authHash?: string): Promise<void>;
  /** Detaches the user on the server and clears the local identity, tags and aliases. */
  logout(): Promise<void>;
  /** Gives the identity hash for an external ID when the app requires one; null stays anonymous. */
  onIdentityVerificationRequired(handler: IdentityVerificationHandler): void;
  /** Call before `initialize`. While consent is required and not given, nothing is stored or sent. */
  setConsentRequired(required: boolean): void;
  /** `true` starts the SDK; `false` stops all later writes. */
  setConsentGiven(given: boolean): void;
  /** Records a custom event; sent in batches. */
  trackEvent(name: string, properties?: Record<string, unknown>, idempotencyKey?: string): void;
  readonly User: UserApi;
  readonly Session: SessionApi;
  readonly Verify: VerifyApi;
  readonly Debug: DebugApi;
  readonly Notifications: NotificationsApi;
  readonly PushSubscription: PushSubscriptionApi;
  /** Prompts: show one yourself, and hear what people do with them. */
  readonly Prompts: PromptsApi;
  /** v1: `Notifications.requestPermission()`, resolving with `{permission, subscriptionId}`. */
  requestPermission(): Promise<V1PermissionResult>;
  /** v1: `PushSubscription.id`, or "". */
  getSubscriptionId(): Promise<string>;
  /** v1: a click listener with the v1 payload `{op, message_id, action_id, url}`. */
  onClick(listener: (payload: V1ClickPayload) => void): void;
  /** v1: kept so v1 code runs; it never fires (browsers get no background pushes). */
  onBackground(listener: (data: unknown) => void): void;
}

export interface SdkDeps {
  platform: Platform;
  /** `document.currentScript.src` for the script-tag build; undefined for bundled builds. */
  scriptSrc?: string;
  hooks?: LifecycleHooks;
}

export const INITIALIZED_EVENT = "openpush:initialized";

const noop = (): void => undefined;

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Holds the SDK's state for one page. Later modules reach the init context through `context` and
 * add their steps through `hooks`.
 */
export class Runtime {
  readonly log: Logger;
  readonly consent = new ConsentGate();
  readonly local: LocalStore;
  /** Click, foreground lifecycle and dismiss listeners. */
  readonly notificationEvents: NotificationEvents;
  /** Push subscription lifecycle, status and permission. */
  readonly push: PushController;
  /** Identity, tags, aliases and language. */
  readonly user: UserController;
  readonly channels: ChannelWriter;
  readonly sessions: SessionTracker;
  readonly events: EventTracker;
  readonly verify: VerifyApi;
  /** The prompt loader and prompt event listeners. */
  readonly prompts: PromptsHub;
  /** `sdk_wrapper` for registrations, set by a framework wrapper ("react/1.1.0"). */
  sdkWrapper: string | undefined;
  hooks: LifecycleHooks;
  context: InitContext | undefined;
  private initPromise: Promise<void> | undefined;
  private readonly sessionLevel: LogLevel | undefined;
  private optionLevel: LogLevel | undefined;
  private pendingLevel: LogLevel | undefined;
  private sdkKey: string | undefined;
  private readonly bridge: WorkerBridge;

  constructor(private readonly deps: SdkDeps) {
    const platform = deps.platform;
    const pageStart = platform.now();
    this.log = new Logger(platform.console, () => platform.now());
    this.notificationEvents = new NotificationEvents(this.log);
    this.bridge = new WorkerBridge({
      events: this.notificationEvents,
      log: this.log,
      timers: platform.timers,
      now: () => platform.now(),
      container: () => platform.serviceWorker(),
    });
    this.local = new LocalStore(platform.localStorage(), () => this.consent.allowed());
    this.push = new PushController({
      platform,
      log: this.log,
      local: this.local,
      initialized: () => this.initPromise,
      sdkWrapper: () => this.sdkWrapper,
      language: () => this.user.languageOverride(),
    });
    const ready = (): Promise<InitContext> => this.ready();
    this.user = new UserController({
      push: this.push,
      log: this.log,
      timers: platform.timers,
      ready,
      defaultLanguage: () => this.context?.options.language ?? platform.navigator()?.language ?? "",
    });
    this.channels = new ChannelWriter({
      log: this.log,
      initialized: () => this.initPromise,
      context: () => this.context,
      identity: () => this.user.identityFields(),
    });
    this.sessions = new SessionTracker({
      local: this.local,
      timers: platform.timers,
      now: () => platform.now(),
      isVisible: () => platform.isVisible?.() === true,
      onVisible: (listener) => platform.onVisible(listener),
      onHidden: (listener) => platform.onHidden?.(listener),
      rowToken: () => (this.push.id && this.push.currentToken) || null,
    });
    this.events = new EventTracker({
      log: this.log,
      timers: platform.timers,
      now: () => platform.now(),
      allowed: () => this.consent.allowed(),
      context: () => this.context,
      subscriptionId: () => this.push.id,
      externalId: () => this.user.currentExternalId,
      device: () => {
        const browser = (this.context?.env ?? detectEnv(platform)).browser;
        return { browser: browser.name, os: browser.os };
      },
      attribution: { lastPush: async () => (await this.context?.db.readCfg())?.lastPush },
    });
    this.verify = verifyApi(() => this.ready());
    this.prompts = new PromptsHub({
      platform,
      log: this.log,
      local: this.local,
      push: this.push,
      user: this.user,
      channels: this.channels,
      verify: this.verify,
      context: () => this.context,
      ready: () => this.ready(),
      scriptSrc: deps.scriptSrc,
      pageStart,
    });
    // After `initialize`, the worker bridge fires a click kept for this page (beside the other
    // steps). The user loads before the push step, so the first registration carries it.
    this.hooks = composeHooks(
      { afterInitialize: (ctx) => this.bridge.afterInitialize(ctx) },
      this.user.hooks(),
      this.push.hooks(),
      { startSessions: (ctx) => this.sessions.start(ctx), afterInitialize: () => this.events.start() },
      this.prompts.hooks(),
      deps.hooks,
    );
    this.sessionLevel = levelFromQuery(platform.location()?.search);
    this.log.setLevel(this.effectiveLevel());
    this.consent.onChange((allowed) => this.consentChanged(allowed));
  }

  /** Adds lifecycle steps after the ones already set (later modules use this, not assignment). */
  addHooks(extra: LifecycleHooks): void {
    this.hooks = composeHooks(this.hooks, extra);
  }

  get initialized(): Promise<void> | undefined {
    return this.initPromise;
  }

  /** Waits for `initialize`; rejects with `not_initialized` when it was never called. */
  async ready(): Promise<InitContext> {
    const init = this.initPromise;
    if (!init) throw new OpenPushError("not_initialized", "Call OpenPush.initialize first");
    await init.catch(() => undefined);
    if (!this.context) throw new OpenPushError("not_initialized", "Call OpenPush.initialize first");
    return this.context;
  }

  initialize(options: InitOptions): Promise<void> {
    if (this.initPromise) {
      this.log.warn("initialize was already called on this page; this call changes nothing");
      return this.initPromise.then(noop, noop);
    }
    try {
      this.validate(options);
    } catch (error) {
      return Promise.reject(error);
    }
    this.initPromise = this.run(options);
    return this.initPromise;
  }

  setLogLevel(level: LogLevel): void {
    if (!isLogLevel(level)) throw new OpenPushError("invalid_argument", `Unknown log level "${String(level)}"`);
    this.log.setLevel(level);
    if (!this.local.setString(LOCAL_KEY.debug, level)) this.pendingLevel = level;
    const ctx = this.context;
    if (ctx) {
      postToWorker(ctx.registration, logLevelMessage(level));
      if (this.consent.allowed()) ctx.db.mergeCfg({ logLevel: level }).catch(noop);
    }
  }

  private validate(options: InitOptions): void {
    if (!options || typeof options !== "object") throw new OpenPushError("invalid_argument", "initialize needs an options object");
    if (typeof options.appId !== "string" || options.appId.trim() === "") {
      throw new OpenPushError("invalid_argument", "initialize needs appId");
    }
    if (options.logLevel !== undefined && !isLogLevel(options.logLevel)) {
      throw new OpenPushError("invalid_argument", `Unknown log level "${String(options.logLevel)}"`);
    }
    resolveServerUrl(options.serverUrl, this.deps.scriptSrc);
  }

  /** `?openpush_debug=` for this page, else the persisted level, else the option, else "warn". */
  private effectiveLevel(): LogLevel {
    const persisted = this.local.getString(LOCAL_KEY.debug);
    return this.sessionLevel ?? (isLogLevel(persisted) ? persisted : undefined) ?? this.optionLevel ?? DEFAULT_LOG_LEVEL;
  }

  private consentChanged(allowed: boolean): void {
    if (!allowed) return;
    if (this.pendingLevel && this.local.setString(LOCAL_KEY.debug, this.pendingLevel)) this.pendingLevel = undefined;
    this.context?.queue.resume();
  }

  private async run(code: InitOptions): Promise<void> {
    const platform = this.deps.platform;
    const log = this.log;
    if (code.requiresConsent) this.consent.setRequired(true);
    if (code.logLevel) {
      this.optionLevel = code.logLevel;
      log.setLevel(this.effectiveLevel());
    }

    // Step 1: consent.
    if (!this.consent.allowed()) {
      log.info("Waiting for consent before starting");
      await this.consent.whenAllowed();
    }
    const allowed = (): boolean => this.consent.allowed();
    this.bridge.attach();
    const serverUrl = resolveServerUrl(code.serverUrl, this.deps.scriptSrc);

    // Step 2: feature check.
    const env = detectEnv(platform);
    let pushBlocked = this.unsupportedError(env);
    const page = platform.location();
    if (!pushBlocked && page) pushBlocked = checkSecureOrigin(page, code.allowLocalhost === true);
    if (pushBlocked) log.info(`Web push is not available on this page: ${pushBlocked.message}`);

    // Step 3: stored config, then the bootstrap.
    const factory = platform.indexedDB();
    const db: SdkDb = factory ? new Db(factory, allowed, log) : new MemoryDb(allowed);
    const previousCfg = await db.readCfg().catch(() => undefined);
    const http = new HttpClient({ fetch: platform.fetch, serverUrl: () => serverUrl, sdkKey: () => this.sdkKey, log, allowed });
    const queue = new WriteQueue({
      storage: new IdbQueueStorage(db),
      http,
      timers: platform.timers,
      now: () => platform.now(),
      log,
      canSend: () => allowed() && !!this.sdkKey,
      canWrite: allowed,
    });
    const loader = new ConfigLoader({ http, store: db, log, now: () => platform.now() });

    let bootstrap: Bootstrap | undefined;
    let refresh: Promise<Bootstrap | undefined> | undefined;
    try {
      const loaded = await loader.load(code.appId, previousCfg);
      bootstrap = loaded.bootstrap;
      refresh = loaded.refresh;
    } catch (error) {
      const failure = error instanceof OpenPushError ? error : new OpenPushError("config_unavailable", errorMessage(error));
      log.error(failure.message);
      pushBlocked = failure;
    }

    // Step 4: site checks and effective options.
    const applied = await this.applyBootstrap(code, bootstrap, env, db, serverUrl);
    pushBlocked = pushBlocked ?? applied.blocked;
    const ctx: InitContext = {
      options: applied.options,
      bootstrap,
      previousCfg,
      cfg: applied.cfg,
      env,
      pushBlocked,
      promptsAllowed: applied.promptsAllowed && bootstrap !== undefined,
      registration: undefined,
      db,
      local: this.local,
      http,
      queue,
      log,
    };
    this.context = ctx;

    // Step 5: the worker.
    if (!ctx.pushBlocked) await this.registerWorker(ctx);

    // Steps 6 and 7: filled by later modules.
    await this.runHook("push reconcile", () => this.hooks.reconcilePush?.(ctx));
    await this.runHook("sessions", () => this.hooks.startSessions?.(ctx));

    // Step 8: drain the write queue.
    queue.start();
    if (this.consent.isRequired()) db.mergeState({ consent: { given: true, at: platform.now() } }).catch(noop);

    // Step 9: initialized.
    this.announce(ctx);
    if (refresh) void refresh.then((fresh) => (fresh ? this.applyFresh(code, fresh, serverUrl) : undefined));
    void Promise.resolve().then(() => this.runHook("after initialize", () => this.hooks.afterInitialize?.(ctx)));
  }

  private unsupportedError(env: EnvInfo): OpenPushError | undefined {
    if (env.support.supported) return undefined;
    const reason = env.support.reason;
    const text: Record<typeof reason, string> = {
      no_push_api: "this browser has no web push",
      in_app_browser: "in-app browsers cannot receive web push",
      ios_needs_home_screen: "on iPhone and iPad, web push works only after adding the site to the Home Screen",
      private_mode: "private windows cannot receive web push",
    };
    return new OpenPushError("not_supported", text[reason], { reason });
  }

  private async applyBootstrap(
    code: InitOptions,
    boot: Bootstrap | undefined,
    env: EnvInfo,
    db: SdkDb,
    serverUrl: string,
  ): Promise<{ options: ResolvedOptions; cfg: CfgRow; blocked: OpenPushError | undefined; promptsAllowed: boolean }> {
    const log = this.log;
    const fallback: Bootstrap = { app: code.appId, enabled: true };
    const { options, conflicts, invalid } = resolveOptions(code, boot ?? fallback, { language: env.language });
    let blocked: OpenPushError | undefined;
    let promptsAllowed = true;
    if (boot) {
      if (!boot.enabled) {
        blocked = new OpenPushError("web_push_off", "Web push is turned off for this app");
        promptsAllowed = false;
        log.warn(blocked.message);
      } else if (!hasSite(boot)) {
        blocked = new OpenPushError("config_unavailable", "This app has no website set up for this SDK version", { reason: "no_site" });
        promptsAllowed = false;
        log.error(blocked.message);
      } else {
        const page = this.deps.platform.location();
        blocked = page ? checkSiteOrigin(page, boot.site.origin, options.allowLocalhost) : undefined;
        if (blocked) {
          promptsAllowed = false;
          log.error(`${blocked.message}; this page is ${page?.origin ?? "unknown"}. Push and prompts are off here`);
        }
      }
      if (conflicts.length > 0) {
        log.once(
          "option-conflicts",
          "warn",
          `This site is set up in the OpenPush console, so these code options were ignored: ${conflicts.join(", ")}`,
        );
      }
      if (invalid.length > 0) log.warn(`These options were not valid and use their defaults: ${invalid.join(", ")}`);
      if (boot.sdk_key) {
        this.sdkKey = boot.sdk_key;
        log.addSecret(boot.sdk_key);
      }
    }
    const patch: Partial<CfgRow> = {
      app: code.appId,
      server: serverUrl,
      click: options.clickBehavior,
      webhooks: options.webhooks,
      keepOnScreen: options.keepOnScreen,
      defaultUrl: options.defaultUrl,
      defaultTitle: options.defaultTitle,
      workerPath: options.serviceWorkerPath,
      workerScope: options.serviceWorkerScope,
      logLevel: log.level,
    };
    if (boot?.sdk_key) patch.sdkKey = boot.sdk_key;
    if (boot?.web_push) {
      patch.publicKey = boot.web_push.public_key;
      patch.keyId = boot.web_push.key_id;
    }
    if (boot?.site) {
      patch.siteName = boot.site.name;
      patch.siteIcon = boot.site.icon ?? null;
    }
    let cfg: CfgRow;
    try {
      cfg = await db.mergeCfg(patch);
    } catch (error) {
      log.debug(`Could not save the config: ${errorMessage(error)}`);
      cfg = { ...patch };
    }
    if (cfg.deviceSecret) log.addSecret(cfg.deviceSecret);
    return { options, cfg, blocked, promptsAllowed };
  }

  private async registerWorker(ctx: InitContext): Promise<void> {
    const container = this.deps.platform.serviceWorker();
    const page = this.deps.platform.location();
    if (!container || !page) return;
    const result = await registerWorker(container, page.href, ctx.options.serviceWorkerPath, ctx.options.serviceWorkerScope, ctx.log);
    if (result.state === "ok") {
      ctx.registration = result.registration;
    } else {
      ctx.pushBlocked = result.error;
    }
    try {
      ctx.cfg = await ctx.db.mergeCfg({ workerState: result.state });
    } catch {
      ctx.cfg = { ...ctx.cfg, workerState: result.state };
    }
    if (ctx.registration) postToWorker(ctx.registration, configMessage(ctx.cfg));
  }

  private async applyFresh(code: InitOptions, fresh: Bootstrap, serverUrl: string): Promise<void> {
    const ctx = this.context;
    if (!ctx) return;
    const applied = await this.applyBootstrap(code, fresh, ctx.env, ctx.db, serverUrl);
    ctx.bootstrap = fresh;
    ctx.options = applied.options;
    ctx.cfg = applied.cfg;
    ctx.promptsAllowed = applied.promptsAllowed;
    // A fresh config can stop push on this page; turning it back on waits for the next load.
    if (applied.blocked) ctx.pushBlocked = applied.blocked;
    if (this.sdkKey) ctx.queue.resume();
    postToWorker(ctx.registration, configMessage(ctx.cfg));
    this.log.debug("Applied the updated config");
    await this.runHook("config change", () => this.hooks.configChanged?.(ctx));
  }

  private announce(ctx: InitContext): void {
    const platform = this.deps.platform;
    const win = platform.window();
    if (!win) return;
    const event = platform.customEvent(INITIALIZED_EVENT, { version: VERSION, subscriptionId: ctx.cfg.subscriptionId ?? null });
    if (event) {
      try {
        win.dispatchEvent(event);
      } catch {
        // A listener's error is the site's own.
      }
    }
    const layer = win.dataLayer as { push?: (entry: unknown) => unknown } | undefined;
    if (layer && typeof layer.push === "function") {
      try {
        layer.push({ event: "openpush.initialized" });
      } catch {
        // Ignore.
      }
    }
  }

  private async runHook(name: string, fn: () => Promise<void> | void | undefined): Promise<void> {
    try {
      await fn();
    } catch (error) {
      this.log.error(`The ${name} step failed: ${errorMessage(error)}`);
    }
  }
}

/** Builds the SDK object and the runtime behind it. */
export function createOpenPush(deps: SdkDeps): { api: OpenPushApi; runtime: Runtime } {
  const runtime = new Runtime(deps);
  const initialize = (options: InitOptions): Promise<void> => runtime.initialize(options);
  const push = runtime.push;
  const pushSubscription = pushSubscriptionApi(push);
  const v1 = v1Api({
    push,
    log: runtime.log,
    initialize,
    bootstrap: () => runtime.context?.bootstrap,
    addClickListener: (listener) => runtime.notificationEvents.addClickListener(listener),
    timers: deps.platform.timers,
    permission: () => deps.platform.notificationPermission(),
  });
  const api: OpenPushApi = {
    version: VERSION,
    initialize,
    ...v1,
    login: (externalId, authHash) => runtime.user.login(externalId, authHash),
    logout: () => runtime.user.logout(),
    onIdentityVerificationRequired: (handler) => runtime.user.setIdentityHandler(handler),
    setConsentRequired: (required) => runtime.consent.setRequired(required === true),
    setConsentGiven: (given) => runtime.consent.setGiven(given === true),
    trackEvent: (name, properties, idempotencyKey) => runtime.events.track(name, properties, idempotencyKey),
    User: userApi(runtime.user, runtime.channels, pushSubscription),
    Session: sessionApi(runtime.events),
    Verify: runtime.verify,
    Debug: {
      setLogLevel: (level) => runtime.setLogLevel(level),
      addLogListener: (listener) => runtime.log.addListener(listener),
      removeLogListener: (listener) => runtime.log.removeListener(listener),
    },
    Notifications: addNotificationPushApi(
      {
        addClickListener: (listener: ClickListener) => runtime.notificationEvents.addClickListener(listener),
        removeClickListener: (listener: ClickListener) => runtime.notificationEvents.removeClickListener(listener),
        addForegroundLifecycleListener: (listener: ForegroundLifecycleListener) =>
          runtime.notificationEvents.addForegroundLifecycleListener(listener),
        removeForegroundLifecycleListener: (listener: ForegroundLifecycleListener) =>
          runtime.notificationEvents.removeForegroundLifecycleListener(listener),
        addDismissListener: (listener: DismissListener) => runtime.notificationEvents.addDismissListener(listener),
        removeDismissListener: (listener: DismissListener) => runtime.notificationEvents.removeDismissListener(listener),
      },
      push,
    ),
    PushSubscription: pushSubscription,
    Prompts: runtime.prompts.api(),
  };
  attachInternal(api, {
    log: runtime.log,
    initialized: () => runtime.initialized,
    setSdkWrapper: (value) => {
      runtime.sdkWrapper = value;
    },
    onPermissionPrompt: (listener) => {
      const fire = (): void => listener();
      push.promptObservers.add(fire);
      return () => {
        push.promptObservers.remove(fire);
      };
    },
  });
  return { api, runtime };
}

export type { RegistrationLike };
