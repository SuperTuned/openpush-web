/**
 * The push subscription lifecycle on the page: page-load reconciliation, auto
 * resubscribe and the silent move, the status model and its observers, the opt-in
 * rule, and the push members of `PushSubscription` and `Notifications`.
 *
 * Every push operation runs one at a time (`serial`). The page-load work runs in the background
 * so `initialize` never waits for subscribe retries or the server.
 */
import type { InitContext, LifecycleHooks } from "../core/hooks";
import { browserInfo } from "../env/browser";
import { detectEnv } from "../env/detect";
import { looksLikePrivateMode } from "../env/features";
import { OpenPushError } from "../errors";
import { maskEndpoint } from "../log/redact";
import type { Logger } from "../log/logger";
import type { HttpResponse } from "../net/http";
import type { QueuedWrite } from "../net/queue";
import type { PermissionValue, Platform } from "../platform/types";
import type { LocalStore } from "../storage/local";
import type { CfgRow, PendingMove, StateRow } from "../storage/types";
import { sameBase64 } from "../util/base64url";
import { configMessage, postToWorker } from "../worker/channel";
import type { PagePushManager, PagePushSubscription } from "../worker/registration";
import { registrationPath } from "../worker/subscription_change";
import {
  errorName,
  fingerprint,
  moveFailedBody,
  subscriptionBody,
  subscriptionJson,
  tokenBody,
  type BodyContributor,
  type DeviceFields,
  type PreviousIdentity,
  type RequestBody,
} from "./body";
import { hasDirectRow, otherAppId, planReconcile, type ReconcileInputs, type ReconcilePlan } from "./plan";
import {
  isOptedIn,
  ListenerSet,
  pushStatus,
  sameState,
  type PermissionChange,
  type PushSubscriptionChange,
  type PushSubscriptionState,
  type StatusInputs,
} from "./state";
import { keyOf, madeWithKey, subscribeWithRetries } from "./subscribe";
import { errorText, isRecord } from "../util/values";

/** Queue kind of the page's registrations; a later one merges into a waiting one (tags merge). */
export const REGISTRATION_KIND = "registration";
/** Queue kind of a failed-move report. */
export const MOVE_FAILED_KIND = "move-failed";

export interface PushControllerDeps {
  platform: Platform;
  log: Logger;
  local: LocalStore;
  /** The `initialize` promise; undefined before `initialize` is called. */
  initialized: () => Promise<void> | undefined;
  /** `sdk_wrapper`, when a framework wrapper set it. */
  sdkWrapper?: () => string | undefined;
  /** The language set with `User.setLanguage`, which overrides the browser's. */
  language?: () => string | undefined;
}

/** What a gesture flow ended with. */
export interface GestureResult {
  permission: PermissionValue;
  /** A browser subscription exists and a registration was queued for it. */
  subscribed: boolean;
}

export interface GestureOptions {
  /** Send `opt_in: true` (the person tapped Subscribe, or called `optIn()`). */
  optIn: boolean;
  /** Send `opt_in: true` only when this call moved permission from default to granted. */
  optInIfGranted?: boolean;
}

interface ExecuteOptions {
  optIn: boolean;
  /** Register even when nothing changed (a person's action). */
  force: boolean;
}

interface ExecuteResult {
  subscribed: boolean;
  error?: unknown;
}

function rejectedStatus(error: unknown): number | undefined {
  if (!(error instanceof OpenPushError)) return undefined;
  const status = error.detail?.status;
  return typeof status === "number" ? status : undefined;
}

export class PushController {
  readonly subscriptionObservers: ListenerSet<PushSubscriptionChange>;
  readonly permissionObservers: ListenerSet<PermissionChange>;
  /** Called just before the browser permission prompt is requested. */
  readonly promptObservers: ListenerSet<void>;
  private ctx: InitContext | undefined;
  private chain: Promise<unknown> = Promise.resolve();
  private work: Promise<unknown> = Promise.resolve();
  private pending = false;
  private privateWindow = false;
  private optedOut = false;
  private lastStatus: number | undefined;
  private lastSent: string | undefined;
  private hasSubscription = false;
  private token: string | null = null;
  private subscriptionId: string | null = null;
  private permissionSeen: PermissionValue | undefined;
  private state: PushSubscriptionState;
  private readonly contributors: BodyContributor[] = [];
  private defaultUrl: string | undefined;
  private defaultTitle: string | undefined;
  private device: Promise<DeviceFields> | undefined;
  private refusedOnce = false;
  private reconciledFor: string | undefined;
  private supportCache: { supported: boolean; error: OpenPushError | undefined } | undefined;

  constructor(private readonly deps: PushControllerDeps) {
    this.subscriptionObservers = new ListenerSet(deps.log, "push subscription");
    this.permissionObservers = new ListenerSet(deps.log, "permission");
    this.promptObservers = new ListenerSet(deps.log, "permission prompt");
    this.state = this.compute();
  }

  /** The lifecycle steps this module adds (fresh config). */
  hooks(): LifecycleHooks {
    return {
      reconcilePush: (ctx) => this.start(ctx),
      configChanged: (ctx) => this.configChanged(ctx),
    };
  }

  // ------------------------------------------------------------------ public reads

  get id(): string | null {
    return this.subscriptionId;
  }

  get currentToken(): string | null {
    return this.token;
  }

  get optedIn(): boolean {
    return isOptedIn(this.inputs());
  }

  /**
   * This browser opted out, whatever the browser permission is now. `status` says
   * `not_asked` once permission is back at default; the prompts read this so an opted-out person
   * never gets an auto push prompt again.
   */
  get optedOutLocally(): boolean {
    return this.optedOut;
  }

  get status(): PushSubscriptionState["status"] {
    return pushStatus(this.inputs());
  }

  snapshot(): PushSubscriptionState {
    return this.compute();
  }

  /** Raw browser permission; "default" when the browser has no Notification API. */
  get permissionStatus(): PermissionValue {
    return this.deps.platform.notificationPermission() ?? "default";
  }

  get permission(): boolean {
    return this.permissionStatus === "granted";
  }

  get canRequestPermission(): boolean {
    return this.isPushSupported() && this.deps.platform.notificationPermission() === "default";
  }

  isPushSupported(): boolean {
    return this.support().supported;
  }

  /**
   * True after `subscribe()` failed in what looks like a private window this session.
   * Prompts read it: such a failure is not a dismissal, and nothing is shown again this session.
   */
  get privateMode(): boolean {
    return this.privateWindow;
  }

  /** Adds identity, tags, aliases or a verify code to every registration (later modules). */
  addBodyContributor(contributor: BodyContributor): void {
    this.contributors.push(contributor);
  }

  /** Resolves when the background push work started so far has finished (tests, later modules). */
  whenIdle(): Promise<void> {
    return this.work.then(
      () => undefined,
      () => undefined,
    );
  }

  // ------------------------------------------------------------------ public actions

  /** `Notifications.requestPermission()`: `opt_in` only when this call moved default to granted. */
  requestPermission(): Promise<boolean> {
    return this.subscribeFromGesture({ optIn: false, optInIfGranted: true }).then((r) => r.permission === "granted");
  }

  /** `PushSubscription.optIn()`: clears the opt-out and registers `status: 1` with `opt_in: true`. */
  optIn(): Promise<void> {
    return this.subscribeFromGesture({ optIn: true }).then(() => undefined);
  }

  /**
   * The gesture entry for `requestPermission()`, `optIn()` and a tap on an OpenPush prompt
   * (`{optIn: true}`). The browser prompt is started before anything is awaited, so the person's
   * gesture still counts in browsers that require one.
   */
  subscribeFromGesture(options: GestureOptions): Promise<GestureResult> {
    const support = this.support();
    if (support.error) return Promise.reject(support.error);
    const init = this.deps.initialized();
    if (!init) return Promise.reject(new OpenPushError("not_initialized", "Call OpenPush.initialize first"));
    const ctx = this.ctx;
    if (ctx?.pushBlocked) return Promise.reject(ctx.pushBlocked);
    const before = this.deps.platform.notificationPermission() ?? "default";
    if (ctx && !this.newRegistrations(ctx) && !hasDirectRow(ctx.cfg)) {
      this.deps.log.info("New web push subscriptions are off for this app");
      return Promise.resolve({ permission: before, subscribed: false });
    }
    let prompt: Promise<PermissionValue>;
    try {
      if (before === "default") this.promptObservers.emit();
      prompt = before === "default" ? this.deps.platform.requestNotificationPermission() : Promise.resolve(before);
    } catch (error) {
      prompt = Promise.reject(error);
    }
    return this.afterPrompt(prompt, before, init, options);
  }

  /** `PushSubscription.optOut()`: `status: -2`; the browser subscription is kept. */
  async optOut(): Promise<void> {
    const ctx = await this.ready();
    this.setOptedOut(true);
    await this.serial(async () => {
      const token = ctx.cfg.token;
      if (!token) return;
      this.send(ctx, tokenBody(token, -2, await this.deviceFields(ctx), ctx.cfg.deviceSecret));
    });
    this.refresh();
  }

  /** Registers the current subscription again (later modules, after a tag or identity change). */
  async register(): Promise<HttpResponse | undefined> {
    const ctx = await this.ready();
    return this.serial(async () => {
      const manager = ctx.registration?.pushManager;
      if (ctx.pushBlocked || !manager || this.deps.platform.notificationPermission() !== "granted") return undefined;
      const sub = await this.currentSubscription(manager);
      if (!sub || madeWithKey(sub, ctx.cfg.publicKey) === false) return undefined;
      const body = await this.buildBody(ctx, sub, { move: ctx.cfg.move, optIn: false });
      return body ? this.send(ctx, body) : undefined;
    });
  }

  setDefaultUrl(url: string): void {
    if (typeof url !== "string") throw new OpenPushError("invalid_argument", "setDefaultUrl needs a URL");
    this.defaultUrl = url;
    void this.applyDefaults();
  }

  setDefaultTitle(title: string): void {
    if (typeof title !== "string") throw new OpenPushError("invalid_argument", "setDefaultTitle needs text");
    this.defaultTitle = title;
    void this.applyDefaults();
  }

  /** Closes this site's shown notifications. */
  async clearAll(): Promise<void> {
    const ctx = await this.ready();
    const reg = ctx.registration;
    if (!reg?.getNotifications) return;
    for (const shown of await reg.getNotifications()) shown.close();
  }

  /** Closes the notification with that tag or topic. */
  async remove(tag: string): Promise<void> {
    if (typeof tag !== "string" || tag === "") throw new OpenPushError("invalid_argument", "remove needs a tag");
    const ctx = await this.ready();
    const reg = ctx.registration;
    if (!reg?.getNotifications) return;
    for (const shown of await reg.getNotifications()) {
      const topic = isRecord(shown.data) ? shown.data.topic : undefined;
      if (shown.tag === tag || topic === tag) shown.close();
    }
  }

  // ------------------------------------------------------------------ lifecycle

  private async start(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    this.supportCache = undefined;
    const log = this.deps.log;
    const stored = await ctx.db.readState().catch((): StateRow | undefined => undefined);
    this.optedOut = stored?.optedOut === true;
    this.lastStatus = stored?.lastStatus;
    this.lastSent = stored?.lastSent;
    this.permissionSeen = stored?.lastPermission;

    const other = otherAppId(ctx.options.appId, ctx.previousCfg);
    if (other) {
      log.once(
        "other_app_subscription",
        "warn",
        `other_app_subscription: this browser has a push subscription stored for the app ${other}; it is now subscribed for ${ctx.options.appId}. One site address belongs to one app`,
      );
      await this.mergeCfg(ctx, {
        token: undefined,
        subscriptionId: undefined,
        deviceSecret: undefined,
        move: undefined,
        subKeyId: undefined,
        subPublicKey: undefined,
      });
      this.lastStatus = undefined;
      this.lastSent = undefined;
      await ctx.db.mergeState({ lastStatus: undefined, lastSent: undefined }).catch(() => undefined);
    }
    if (ctx.cfg.deviceSecret) log.addSecret(ctx.cfg.deviceSecret);
    this.subscriptionId = ctx.cfg.subscriptionId ?? null;
    this.token = ctx.cfg.token ?? null;
    this.hasSubscription = !!ctx.cfg.token;
    // The state observers compare against: as it was when the page last looked.
    this.state = this.compute(this.permissionSeen);

    ctx.queue.onResponse(REGISTRATION_KIND, (write, res) => this.adopt(write, res));
    ctx.queue.onResponse(MOVE_FAILED_KIND, (_write, res) => this.adoptOptOut(res));
    this.deps.platform.onVisible(() => this.onVisible());
    await this.applyDefaults();
    this.track(this.serial(() => this.reconcile(ctx)));
  }

  private async configChanged(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    await this.applyDefaults();
    if (this.reconcileKey(ctx) !== this.reconciledFor) this.track(this.serial(() => this.reconcile(ctx)));
  }

  private onVisible(): void {
    const ctx = this.ctx;
    const now = this.deps.platform.notificationPermission();
    if (!ctx || now === this.permissionSeen) return;
    this.track(this.serial(() => this.reconcile(ctx)));
  }

  /** Page-load reconciliation of the push subscription. Never sends `opt_in`. */
  private async reconcile(ctx: InitContext): Promise<void> {
    this.reconciledFor = this.reconcileKey(ctx);
    const permission = this.deps.platform.notificationPermission();
    this.notePermission(permission);
    const manager = ctx.registration?.pushManager;
    if (ctx.pushBlocked || !manager) {
      this.refresh();
      return;
    }
    const sub = await this.currentSubscription(manager);
    this.hasSubscription = !!sub;
    const plan = planReconcile(this.planInputs(ctx, permission, sub));
    if (plan.kind === "nothing") this.deps.log.debug(`Push subscription: nothing to do (${plan.reason})`);
    await this.execute(ctx, plan, sub, { optIn: false, force: false });
    this.refresh();
  }

  private planInputs(ctx: InitContext, permission: PermissionValue | undefined, sub: PagePushSubscription | null): ReconcileInputs {
    return {
      appId: ctx.options.appId,
      permission,
      subscription: sub ? { endpoint: sub.endpoint, activeKey: this.activeKey(ctx.cfg, sub) } : null,
      cfg: ctx.cfg,
      previousCfg: ctx.previousCfg,
      v1: this.deps.local.readV1(),
      optedOut: this.optedOut,
      lastStatus: this.lastStatus,
      autoResubscribe: ctx.options.autoResubscribe,
      newRegistrations: this.newRegistrations(ctx),
      fromFirebase: ctx.bootstrap?.move?.from_firebase !== false,
    };
  }

  private async execute(ctx: InitContext, plan: ReconcilePlan, sub: PagePushSubscription | null, options: ExecuteOptions): Promise<ExecuteResult> {
    switch (plan.kind) {
      case "nothing":
        return { subscribed: false };
      case "permission_lost": {
        this.deps.log.debug("Browser permission is gone; telling the server (status 0)");
        this.send(ctx, tokenBody(plan.token, 0, await this.deviceFields(ctx), ctx.cfg.deviceSecret));
        return { subscribed: false };
      }
      case "update": {
        if (!sub) return { subscribed: false };
        const body = await this.buildBody(ctx, sub, { move: plan.move, optIn: options.optIn });
        if (!body) return { subscribed: false };
        const changed = fingerprint(body) !== this.lastSent || !ctx.cfg.subscriptionId || body.previous_token !== undefined;
        if (options.force || options.optIn || changed) this.send(ctx, body);
        return { subscribed: true };
      }
      case "subscribe":
        return this.move(ctx, plan.move, plan.unsubscribe ? sub : null, options);
    }
  }

  /**
   * The silent move and auto resubscribe: unsubscribe (key differs), subscribe with the
   * active key (3 more tries after 1, 4 and 15 s), then register with the move's proof.
   */
  private async move(ctx: InitContext, move: PendingMove | undefined, old: PagePushSubscription | null, options: ExecuteOptions): Promise<ExecuteResult> {
    const log = this.deps.log;
    const manager = ctx.registration?.pushManager;
    const publicKey = ctx.cfg.publicKey;
    if (!manager || !publicKey) {
      log.warn("No web push key is known for this app yet; the next page load subscribes this browser");
      return { subscribed: false };
    }
    if (move && !sameMove(move, ctx.cfg.move)) await this.mergeCfg(ctx, { move });
    const oldKey = old ? (keyOf(old) ?? ctx.cfg.subPublicKey) : undefined;
    const oldKeyId = this.keyIdOf(ctx, oldKey);
    if (old) {
      log.debug(`Moving this browser's push subscription (${maskEndpoint(old.endpoint)}) to the app's key`);
      try {
        await old.unsubscribe();
      } catch (error) {
        log.debug(`Could not unsubscribe the old push subscription: ${errorText(error, true)}`);
      }
    }
    this.pending = true;
    this.refresh();
    const outcome = await subscribeWithRetries(manager, publicKey, {
      timers: this.deps.platform.timers,
      giveUp: (error) => looksLikePrivateMode(error),
      onRetry: (attempt, error) => log.debug(`Subscribing failed (try ${attempt}): ${errorText(error, true)}; trying again`),
    });
    this.pending = false;
    if (outcome.ok) {
      const sub = outcome.subscription;
      await this.mergeCfg(ctx, { subPublicKey: publicKey, subKeyId: ctx.cfg.keyId });
      this.hasSubscription = true;
      this.token = sub.endpoint;
      const body = await this.buildBody(ctx, sub, { move, optIn: options.optIn });
      if (body) this.send(ctx, body);
      this.refresh();
      return { subscribed: true };
    }

    const error = outcome.error;
    this.hasSubscription = false;
    if (looksLikePrivateMode(error)) this.markPrivate();
    log.warn(`Could not subscribe this browser to web push after ${outcome.tries} tries: ${errorText(error, true)}`);
    const proof = move ? this.proof(ctx, move) : undefined;
    if (move?.kind === "firebase" && proof) {
      // The Firebase subscription is gone and cannot be restored: report it; the row is held as
      // moving, and the move is tried again on the next page load (cfg.move is kept).
      this.sendMoveFailed(ctx, proof, error);
    } else if (move?.kind === "openpush" && proof) {
      if (oldKey && oldKeyId && !sameBase64(oldKey, publicKey)) await this.fallBackToOldKey(ctx, manager, oldKey, oldKeyId, proof);
      this.sendMoveFailed(ctx, proof, error);
    }
    this.refresh();
    return { subscribed: false, error };
  }

  /** Move between OpenPush keys failed: subscribe again with the old key, a normal update. */
  private async fallBackToOldKey(ctx: InitContext, manager: PagePushManager, oldKey: string, oldKeyId: string, proof: PreviousIdentity): Promise<void> {
    const back = await subscribeWithRetries(manager, oldKey, { timers: this.deps.platform.timers, delays: [] });
    if (!back.ok) {
      this.deps.log.warn(`Could not subscribe again with the earlier key: ${errorText(back.error, true)}`);
      return;
    }
    await this.mergeCfg(ctx, { subPublicKey: oldKey, subKeyId: oldKeyId });
    this.hasSubscription = true;
    this.token = back.subscription.endpoint;
    const body = await this.buildBody(ctx, back.subscription, { move: undefined, optIn: false, keyId: oldKeyId });
    if (!body) return;
    if (proof.token !== back.subscription.endpoint) body.previous_token = proof.token;
    if (proof.deviceSecret) body.device_secret = proof.deviceSecret;
    this.send(ctx, body);
  }

  // ------------------------------------------------------------------ gestures

  private async afterPrompt(prompt: Promise<PermissionValue>, before: PermissionValue, init: Promise<void>, options: GestureOptions): Promise<GestureResult> {
    let after: PermissionValue;
    try {
      after = await prompt;
    } catch (error) {
      this.deps.log.debug(`The permission prompt failed: ${errorText(error, true)}`);
      after = this.deps.platform.notificationPermission() ?? "default";
    }
    this.notePermission(after);
    await init.catch(() => undefined);
    const ctx = this.ctx;
    if (!ctx) throw new OpenPushError("not_initialized", "Call OpenPush.initialize first");
    if (ctx.pushBlocked) throw ctx.pushBlocked;
    if (after !== "granted") {
      if (after === "denied") await this.serial(() => this.reconcile(ctx));
      this.refresh();
      return { permission: after, subscribed: false };
    }
    const optIn = options.optIn || (options.optInIfGranted === true && before === "default");
    if (optIn) this.setOptedOut(false);
    else if (this.optedOut) {
      this.refresh();
      return { permission: after, subscribed: false };
    }
    const result = await this.serial(async () => {
      const manager = ctx.registration?.pushManager;
      if (!manager) return { subscribed: false } as ExecuteResult;
      const sub = await this.currentSubscription(manager);
      this.hasSubscription = !!sub;
      const inputs = { ...this.planInputs(ctx, "granted", sub), autoResubscribe: true, optedOut: false };
      return this.execute(ctx, planReconcile(inputs), sub, { optIn, force: true });
    });
    this.refresh();
    if (!result.subscribed && result.error !== undefined && this.privateWindow) {
      throw new OpenPushError("not_supported", "Private windows cannot receive web push", { reason: "private_mode" });
    }
    return { permission: after, subscribed: result.subscribed };
  }

  // ------------------------------------------------------------------ registrations

  private async buildBody(
    ctx: InitContext,
    sub: PagePushSubscription,
    opts: { move: PendingMove | undefined; optIn: boolean; keyId?: string },
  ): Promise<RequestBody | undefined> {
    let subscription;
    try {
      subscription = subscriptionJson(sub);
    } catch (error) {
      this.deps.log.warn(`The browser's push subscription cannot be registered: ${errorText(error, true)}`);
      return undefined;
    }
    this.deps.log.addSecret(subscription.keys.p256dh);
    this.deps.log.addSecret(subscription.keys.auth);
    const keyId = opts.keyId ?? this.keyIdOf(ctx, keyOf(sub) ?? ctx.cfg.subPublicKey);
    const proof = opts.move ? this.proof(ctx, opts.move) : undefined;
    const sameRow = proof === undefined || proof.token === ctx.cfg.token;
    return subscriptionBody({
      subscription,
      vapidKeyId: keyId,
      status: this.optedOut ? -2 : 1,
      device: await this.deviceFields(ctx),
      previous: proof && proof.token !== subscription.endpoint ? proof : undefined,
      deviceSecret: sameRow ? ctx.cfg.deviceSecret : undefined,
      optIn: opts.optIn,
      welcome: ctx.options.setupType === "custom" ? ctx.options.welcomeNotification : null,
      contributors: this.contributors,
    });
  }

  /** The proof a move sends: Firebase token + subscription id; endpoint + device secret. */
  private proof(ctx: InitContext, move: PendingMove): PreviousIdentity {
    const proof: PreviousIdentity = { token: move.previousToken };
    if (move.kind === "firebase" && move.subscriptionId) proof.subscriptionId = move.subscriptionId;
    if (move.kind === "openpush" && ctx.cfg.deviceSecret) proof.deviceSecret = ctx.cfg.deviceSecret;
    return proof;
  }

  /** Queues a registration. A refused move (409) registers once as a new row. */
  private send(ctx: InitContext, body: RequestBody): Promise<HttpResponse | undefined> {
    const write = ctx.queue.enqueue({ kind: REGISTRATION_KIND, method: "POST", path: registrationPath(ctx.options.appId), body, coalesce: "merge" });
    return write.catch((error: unknown) => this.refused(ctx, body, error));
  }

  private async refused(ctx: InitContext, body: RequestBody, error: unknown): Promise<HttpResponse | undefined> {
    const status = rejectedStatus(error);
    if (status !== 409 || body.previous_token === undefined) {
      if (status !== undefined) this.deps.log.debug(`The server did not accept the registration (${status})`);
      return undefined;
    }
    this.deps.log.once(
      "move_refused",
      "warn",
      "move_refused: the server could not confirm this browser's earlier subscription, so it is registered as a new one; the site's next login() links it",
    );
    await this.mergeCfg(ctx, { move: undefined });
    if (this.refusedOnce) return undefined;
    this.refusedOnce = true;
    // `undefined` also clears these fields from a waiting registration it merges into.
    const fresh: RequestBody = { ...body, previous_token: undefined, subscription_id: undefined, device_secret: undefined };
    return ctx.queue
      .enqueue({ kind: REGISTRATION_KIND, method: "POST", path: registrationPath(ctx.options.appId), body: fresh, coalesce: "merge" })
      .catch(() => undefined);
  }

  private sendMoveFailed(ctx: InitContext, proof: PreviousIdentity, error: unknown): void {
    ctx.queue
      .enqueue({ kind: MOVE_FAILED_KIND, method: "POST", path: registrationPath(ctx.options.appId), body: moveFailedBody(proof, errorName(error)), coalesce: "replace" })
      .catch(() => undefined);
  }

  /** The server accepted a registration (this page's or one left from an earlier page). */
  private async adopt(write: QueuedWrite, res: HttpResponse): Promise<void> {
    const ctx = this.ctx;
    if (!ctx) return;
    const body = write.body ?? {};
    const answer = isRecord(res.body) ? res.body : {};
    const patch: Partial<CfgRow> = {};
    if (typeof answer.id === "string" && answer.id) patch.subscriptionId = answer.id;
    if (typeof answer.device_secret === "string" && answer.device_secret) {
      this.deps.log.addSecret(answer.device_secret);
      patch.deviceSecret = answer.device_secret;
    }
    const sent = isRecord(body.subscription) ? body.subscription.endpoint : body.token;
    if (typeof sent === "string" && sent) patch.token = sent;
    const move = ctx.cfg.move;
    const finishedMove = !!move && body.previous_token === move.previousToken;
    if (finishedMove) {
      patch.move = undefined;
      // Firebase fields of v1 are dropped once the browser has moved.
      if (move.kind === "firebase") patch.firebase = undefined;
    }
    if (answer.moved === true) this.deps.log.info("This browser's subscription moved to direct web push");
    await this.mergeCfg(ctx, patch);

    const statePatch: Partial<StateRow> = { lastSent: fingerprint(body) };
    const sentStatus = typeof body.status === "number" ? body.status : undefined;
    const serverStatus = answer.status;
    if (serverStatus === -2) {
      statePatch.optedOut = true;
      statePatch.lastStatus = -2;
      this.optedOut = true;
    } else {
      if (typeof serverStatus === "number" && serverStatus < 0) {
        this.deps.log.warn(`The server holds this browser at status ${serverStatus}; the SDK does not adopt it`);
      }
      if (sentStatus !== undefined) statePatch.lastStatus = sentStatus;
    }
    if (finishedMove && move.kind === "firebase") {
      const stored = await ctx.db.readState().catch((): StateRow | undefined => undefined);
      const v1Id = this.deps.local.readV1()?.externalId;
      if (v1Id && stored?.externalId === undefined) statePatch.externalId = v1Id;
    }
    this.lastSent = statePatch.lastSent;
    if (statePatch.lastStatus !== undefined) this.lastStatus = statePatch.lastStatus;
    await ctx.db.mergeState(statePatch).catch(() => undefined);
    // v1's localStorage state has done its job once a direct subscription is registered (a
    // finished move, or a new row when there was nothing to move); its external id is in the state
    // row by now (above, or the user module's load).
    if (isRecord(body.subscription) && this.deps.local.readV1()) this.deps.local.removeV1();

    if (patch.subscriptionId) this.subscriptionId = patch.subscriptionId;
    if (patch.token) {
      this.token = patch.token;
      if (isRecord(body.subscription)) this.hasSubscription = true;
    }
    this.refresh();
  }

  /** A `-2` in any response sets the local opt-out. */
  private async adoptOptOut(res: HttpResponse): Promise<void> {
    if (!isRecord(res.body) || res.body.status !== -2 || this.optedOut) return;
    this.optedOut = true;
    this.lastStatus = -2;
    await this.ctx?.db.mergeState({ optedOut: true, lastStatus: -2 }).catch(() => undefined);
    this.refresh();
  }

  // ------------------------------------------------------------------ state

  private inputs(permission: PermissionValue | undefined = this.deps.platform.notificationPermission()): StatusInputs {
    return {
      supported: this.support().supported,
      permission,
      hasSubscription: this.hasSubscription,
      pending: this.pending,
      optedOut: this.optedOut,
    };
  }

  private compute(permission?: PermissionValue): PushSubscriptionState {
    const inputs = this.inputs(permission ?? this.deps.platform.notificationPermission());
    return { id: this.subscriptionId, token: this.token, optedIn: isOptedIn(inputs), status: pushStatus(inputs) };
  }

  /** Fires the push subscription observers when the state changed. */
  private refresh(): void {
    const current = this.compute();
    const previous = this.state;
    if (sameState(previous, current)) return;
    this.state = current;
    this.subscriptionObservers.emit({ previous: { ...previous }, current: { ...current } });
  }

  /** Fires the permission observers on a change, including one made in browser settings. */
  private notePermission(permission: PermissionValue | undefined): void {
    if (permission === undefined) return;
    const seen = this.permissionSeen;
    this.permissionSeen = permission;
    if (seen === permission) return;
    this.ctx?.db.mergeState({ lastPermission: permission }).catch(() => undefined);
    if (seen !== undefined) this.permissionObservers.emit({ permission: permission === "granted", status: permission });
  }

  private setOptedOut(value: boolean): void {
    this.optedOut = value;
    this.ctx?.db.mergeState({ optedOut: value }).catch(() => undefined);
  }

  private markPrivate(): void {
    this.privateWindow = true;
    this.supportCache = undefined;
    this.deps.log.once("private-mode", "info", "This looks like a private window, which cannot receive web push; no prompt is shown again on this visit");
  }

  private support(): { supported: boolean; error: OpenPushError | undefined } {
    if (this.privateWindow) {
      return {
        supported: false,
        error: new OpenPushError("not_supported", "Private windows cannot receive web push", { reason: "private_mode" }),
      };
    }
    if (this.supportCache) return this.supportCache;
    const env = this.ctx?.env ?? detectEnv(this.deps.platform);
    const result = env.support.supported
      ? { supported: true, error: undefined }
      : {
          supported: false,
          error: new OpenPushError("not_supported", "This browser cannot receive web push here", { reason: env.support.reason }),
        };
    this.supportCache = result;
    return result;
  }

  // ------------------------------------------------------------------ helpers

  private newRegistrations(ctx: InitContext): boolean {
    return ctx.bootstrap?.direct?.new_registrations !== false;
  }

  private reconcileKey(ctx: InitContext): string {
    return `${ctx.cfg.keyId ?? ""}|${this.newRegistrations(ctx) ? 1 : 0}|${ctx.pushBlocked?.code ?? ""}`;
  }

  /** Whether `sub` uses the active key; when the browser does not say, what `cfg` recorded. */
  private activeKey(cfg: CfgRow, sub: PagePushSubscription): boolean | undefined {
    const said = madeWithKey(sub, cfg.publicKey);
    if (said !== undefined) return said;
    if (sub.endpoint === cfg.token && cfg.subKeyId !== undefined && cfg.keyId !== undefined) return cfg.subKeyId === cfg.keyId;
    return undefined;
  }

  /** The key id of a public key: the active one, else the one the subscription was made with. */
  private keyIdOf(ctx: InitContext, publicKey: string | undefined): string | undefined {
    const cfg = ctx.cfg;
    if (!publicKey) return cfg.keyId;
    if (cfg.publicKey && sameBase64(publicKey, cfg.publicKey)) return cfg.keyId;
    if (cfg.subPublicKey && sameBase64(publicKey, cfg.subPublicKey)) return cfg.subKeyId;
    const prev = ctx.previousCfg;
    if (prev?.publicKey && sameBase64(publicKey, prev.publicKey)) return prev.keyId;
    return undefined;
  }

  private async currentSubscription(manager: PagePushManager): Promise<PagePushSubscription | null> {
    try {
      return await manager.getSubscription();
    } catch (error) {
      this.deps.log.debug(`Could not read the browser's push subscription: ${errorText(error, true)}`);
      return null;
    }
  }

  private deviceFields(ctx: InitContext): Promise<DeviceFields> {
    this.device ??= (async () => {
      const nav = this.deps.platform.navigator();
      const browser = await browserInfo(nav?.userAgent ?? "", nav?.maxTouchPoints ?? 0, ctx.env.standalone, nav?.userAgentData);
      return { browser, language: ctx.options.language, timezone: this.deps.platform.timezone() };
    })();
    return this.device.then((d) => {
      const wrapper = this.deps.sdkWrapper?.();
      return { ...d, language: this.deps.language?.() ?? ctx.options.language, ...(wrapper ? { sdkWrapper: wrapper } : {}) };
    });
  }

  private async mergeCfg(ctx: InitContext, patch: Partial<CfgRow>): Promise<void> {
    if (Object.keys(patch).length === 0) return;
    try {
      ctx.cfg = await ctx.db.mergeCfg(patch);
    } catch {
      const next: CfgRow = { ...ctx.cfg };
      for (const [key, value] of Object.entries(patch)) {
        if (value === undefined) delete next[key];
        else next[key] = value;
      }
      ctx.cfg = next;
    }
    // The worker needs the token, id and secret for `pushsubscriptionchange` and receipts.
    postToWorker(ctx.registration, configMessage(ctx.cfg));
  }

  private async applyDefaults(): Promise<void> {
    const ctx = this.ctx;
    if (!ctx || (this.defaultUrl === undefined && this.defaultTitle === undefined)) return;
    const patch: Partial<CfgRow> = {};
    if (this.defaultUrl !== undefined) {
      patch.defaultUrl = this.defaultUrl;
      ctx.options.defaultUrl = this.defaultUrl;
    }
    if (this.defaultTitle !== undefined) {
      patch.defaultTitle = this.defaultTitle;
      ctx.options.defaultTitle = this.defaultTitle;
    }
    await this.mergeCfg(ctx, patch);
  }

  /** Waits for `initialize`; rejects when it was never called. */
  private async ready(): Promise<InitContext> {
    const init = this.deps.initialized();
    if (!init) throw new OpenPushError("not_initialized", "Call OpenPush.initialize first");
    await init.catch(() => undefined);
    if (!this.ctx) throw new OpenPushError("not_initialized", "Call OpenPush.initialize first");
    return this.ctx;
  }

  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(fn, fn);
    this.chain = run.catch(() => undefined);
    return run;
  }

  private track(work: Promise<unknown>): void {
    const tracked = work.catch((error: unknown) => this.deps.log.error(`Push subscription work failed: ${errorText(error, true)}`));
    this.work = Promise.all([this.work, tracked]);
  }
}

function sameMove(a: PendingMove, b: PendingMove | undefined): boolean {
  return !!b && a.kind === b.kind && a.previousToken === b.previousToken && a.subscriptionId === b.subscriptionId;
}
