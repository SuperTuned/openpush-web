/**
 * The user on this browser: identity (`login`, `logout`, identity verification), tags,
 * aliases, language and the user change observers. Like the mobile SDKs, tags, aliases
 * and identity ride the next registration: this module adds them to every registration body
 * through a `BodyContributor`, and asks the push module to register again after a change.
 */
import type { InitContext, LifecycleHooks } from "../core/hooks";
import { OpenPushError } from "../errors";
import type { Logger } from "../log/logger";
import type { HttpResponse } from "../net/http";
import type { QueuedWrite, Timers } from "../net/queue";
import type { RequestBody } from "../push/body";
import { REGISTRATION_KIND, type PushController } from "../push/controller";
import { ListenerSet } from "../push/state";
import type { StateRow } from "../storage/types";
import { hash32 } from "../util/hash";
import { aliasLabel, languageTag, nonEmpty, record, tagKey, tagValue } from "./validate";

/** What the user observers see. */
export interface UserState {
  externalId: string | null;
  subscriptionId: string | null;
}

export interface UserChange {
  previous: UserState;
  current: UserState;
}

export type UserObserver = (change: UserChange) => void;

/** Returns the identity hash for this external ID (made on the site's server), or null. */
export type IdentityVerificationHandler = (externalId: string) => Promise<string | null> | string | null;

export interface UserDeps {
  push: PushController;
  log: Logger;
  timers: Timers;
  /** Waits for `initialize`; rejects with `not_initialized` when it was never called. */
  ready: () => Promise<InitContext>;
  /** The browser's language when no override is set. */
  defaultLanguage: () => string;
}

/** Tag and alias changes are sent together after this pause (mobile: a 300 ms window). */
export const SYNC_DELAY_MS = 300;

type Map = Record<string, string>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const sorted = (map: unknown): [string, unknown][] => (isRecord(map) ? Object.entries(map).sort(([a], [b]) => (a < b ? -1 : 1)) : []);

/** A short hash of the user part of a registration body; "" when it has none. */
function userKey(body: RequestBody | undefined): string {
  if (!body || (body.external_id === undefined && !isRecord(body.tags) && !isRecord(body.aliases))) return "";
  return hash32(JSON.stringify([body.external_id ?? null, !!body.external_id_auth_hash, sorted(body.tags), sorted(body.aliases)]));
}

/** Tags from a registration response: non-empty text and number values, as text. */
function serverTags(value: Record<string, unknown>): Map {
  const out: Map = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" && raw !== "") out[key] = raw;
    else if (typeof raw === "number" && Number.isFinite(raw)) out[key] = String(raw);
  }
  return out;
}

const rejected = (): OpenPushError =>
  new OpenPushError("identity_rejected", "The server did not accept this external ID without a valid identity hash");

export class UserController {
  readonly observers: ListenerSet<UserChange>;
  /** A string: logged in. null: logged out (registrations detach). undefined: no claim. */
  private externalId: string | null | undefined;
  /** Memory only: a bearer proof, never stored. */
  private hash: string | undefined;
  private verified = false;
  private ivRequired = false;
  private tags: Map = {};
  private aliases: Map = {};
  private language: string | undefined;
  private userSent: string | undefined;
  private handler: IdentityVerificationHandler | undefined;
  /** An identity waiting for a hash until a handler is set. */
  private waitingFor: string | undefined;
  private rejectedId: string | undefined;
  private recovering: Promise<void> = Promise.resolve();
  private ctx: InitContext | undefined;
  private timer: unknown;

  constructor(private readonly deps: UserDeps) {
    this.observers = new ListenerSet(deps.log, "user");
    deps.push.addBodyContributor(() => this.contribution());
    deps.push.subscriptionObservers.add(({ previous, current }) => {
      if (previous.id === current.id) return;
      const externalId = this.publicId();
      this.observers.emit({ previous: { externalId, subscriptionId: previous.id }, current: { externalId, subscriptionId: current.id } });
    });
  }

  /**
   * Runs before the push module's step 6, so page-load reconciliation carries the user; it
   * registers when the user part changed since the last accepted registration.
   */
  hooks(): LifecycleHooks {
    return { reconcilePush: (ctx) => this.load(ctx) };
  }

  // ------------------------------------------------------------------ identity

  get currentExternalId(): string | null {
    return this.publicId();
  }

  async login(externalId: string, authHash?: string): Promise<void> {
    const id = nonEmpty(externalId, "login needs an external ID", 1024);
    if (authHash != null && typeof authHash !== "string") throw new OpenPushError("invalid_argument", "The identity hash must be text");
    await this.deps.ready();
    const same = id === this.externalId;
    let hash = authHash || (same ? this.hash : undefined);
    if (same && !authHash && !this.dirty()) return;
    if (!hash && this.ivRequired && this.handler) {
      hash = (await this.ask(id)) ?? undefined;
      if (!hash) throw rejected();
    }
    const previous = this.state();
    if (!same) {
      // The earlier user's tags and aliases are never written onto the new one.
      this.tags = {};
      this.aliases = {};
    }
    this.externalId = id;
    this.hash = hash;
    this.verified = !!hash;
    this.rejectedId = undefined;
    this.changed(previous, false);
    const before = this.recovering;
    await this.sendNow();
    // The server refused the identity while this login was out (adopt started a recovery). The
    // recovery may already have its hash and have cleared `rejectedId`, so wait for it either way:
    // login resolves once the registration with the hash is accepted.
    if (this.recovering !== before) {
      await this.recovering;
      if (this.externalId !== id || !this.hash) throw rejected();
    }
  }

  async logout(): Promise<void> {
    await this.deps.ready();
    const previous = this.state();
    const was = this.externalId;
    // Identity is detached on the server (`external_id: ""`), unlike v1; an install that was
    // never identified sends nothing. Local tags and aliases always go.
    if (was !== undefined) this.externalId = null;
    this.hash = undefined;
    this.verified = false;
    this.waitingFor = undefined;
    this.tags = {};
    this.aliases = {};
    this.changed(previous, false);
    if (was !== undefined && this.dirty()) await this.sendNow();
  }

  setIdentityHandler(handler: IdentityVerificationHandler): void {
    if (typeof handler !== "function") throw new OpenPushError("invalid_argument", "onIdentityVerificationRequired needs a function");
    this.handler = handler;
    if (this.waitingFor) void this.recover(this.waitingFor);
  }

  /** `external_id` and its hash for email and phone registrations (the logged-in user). */
  identityFields(): RequestBody {
    if (typeof this.externalId !== "string" || (this.verified && !this.hash)) return {};
    return this.hash ? { external_id: this.externalId, external_id_auth_hash: this.hash } : { external_id: this.externalId };
  }

  // ------------------------------------------------------------------ tags, aliases, language

  addTags(tags: Record<string, unknown>): void {
    const clean: Map = {};
    for (const [key, value] of Object.entries(record(tags, "addTags"))) clean[tagKey(key)] = tagValue(key, value);
    Object.assign(this.tags, clean);
    this.changed();
  }

  removeTags(keys: readonly string[]): void {
    if (!Array.isArray(keys)) throw new OpenPushError("invalid_argument", "removeTags needs a list of keys");
    // An empty value removes the tag on the server (mobile pattern).
    for (const key of keys) this.tags[tagKey(key)] = "";
    this.changed();
  }

  getTags(): Map {
    const out: Map = {};
    for (const [key, value] of Object.entries(this.tags)) if (value !== "") out[key] = value;
    return out;
  }

  addAliases(aliases: Record<string, unknown>): void {
    const clean: Map = {};
    for (const [label, id] of Object.entries(record(aliases, "addAliases"))) clean[aliasLabel(label)] = nonEmpty(id, `Alias "${label}"`);
    Object.assign(this.aliases, clean);
    this.changed();
  }

  removeAliases(labels: readonly string[]): void {
    if (!Array.isArray(labels)) throw new OpenPushError("invalid_argument", "removeAliases needs a list of labels");
    for (const label of labels) this.aliases[aliasLabel(label)] = "";
    this.changed();
  }

  getLanguage(): string {
    return this.language ?? this.deps.defaultLanguage();
  }

  /** The language override for registrations; undefined when the browser's language is used. */
  languageOverride(): string | undefined {
    return this.language;
  }

  setLanguage(code: string): void {
    this.language = languageTag(code);
    this.changed();
  }

  // ------------------------------------------------------------------ lifecycle

  private async load(ctx: InitContext): Promise<void> {
    this.ctx = ctx;
    const stored: StateRow = (await ctx.db.readState().catch(() => undefined)) ?? {};
    // Tags, aliases and a language set before `initialize` win over what was stored.
    this.tags = { ...(isRecord(stored.tags) ? (stored.tags as Map) : {}), ...this.tags };
    this.aliases = { ...(isRecord(stored.aliases) ? (stored.aliases as Map) : {}), ...this.aliases };
    this.language ??= typeof stored.language === "string" ? stored.language : undefined;
    // A v1 browser keeps its external id as the login state.
    this.externalId = stored.externalId === undefined ? ctx.local.readV1()?.externalId : stored.externalId;
    this.verified = stored.verified === true;
    this.ivRequired = stored.ivRequired === true;
    this.userSent = stored.userSent;
    ctx.queue.onResponse(REGISTRATION_KIND, (write, res) => this.adopt(write, res));
    this.persist();
    // A verified identity restored without its hash: registrations leave it out until a hash
    // comes from the handler or the next login.
    if (typeof this.externalId === "string" && this.verified) void this.recover(this.externalId);
  }

  /** Identity, tags and aliases for a registration body. */
  private contribution(): RequestBody | undefined {
    const out: RequestBody = {};
    const id = this.externalId;
    if (id === null) out.external_id = "";
    else if (typeof id === "string") {
      // Tags and aliases ride with the identity; without the hash all three would be refused.
      if (this.verified && !this.hash) return undefined;
      Object.assign(out, this.identityFields());
    }
    if (Object.keys(this.tags).length > 0) out.tags = { ...this.tags };
    if (Object.keys(this.aliases).length > 0) out.aliases = { ...this.aliases };
    return out;
  }

  private dirty(): boolean {
    return userKey(this.contribution()) !== (this.userSent ?? "");
  }

  /** The server accepted a registration (this page's or one left from an earlier page). */
  private adopt(write: QueuedWrite, res: HttpResponse): void {
    const body = write.body ?? {};
    const answer = isRecord(res.body) ? res.body : {};
    const sentId = body.external_id;
    if (answer.identity_rejected !== undefined) {
      this.ivRequired = true;
      if (typeof sentId === "string" && sentId !== "" && sentId === this.externalId) {
        this.deps.log.warn("identity_rejected: the external ID needs a valid identity hash; this browser stays anonymous for now");
        const previous = this.state();
        // Not null: an empty external_id would detach the row, which the server kept.
        this.externalId = undefined;
        this.hash = undefined;
        this.verified = false;
        this.rejectedId = sentId;
        this.changed(previous, false);
        this.recovering = this.recover(sentId);
      } else this.persist();
      return;
    }
    const current = userKey(this.contribution());
    for (const [field, map] of [
      ["tags", this.tags],
      ["aliases", this.aliases],
    ] as const) {
      const sent = body[field];
      if (!isRecord(sent)) continue;
      for (const [key, value] of Object.entries(sent)) if (value === "" && map[key] === "") delete map[key];
    }
    const inSync = userKey(body) === current;
    // The server's copy of the tags (sent only to a browser that proved its row). Taken only
    // when nothing changed here while the body was out and nothing is held back (a verified
    // identity waiting for its hash), so a local change is never lost.
    if (inSync && isRecord(answer.tags) && this.contribution() !== undefined) this.tags = serverTags(answer.tags);
    // When nothing changed while the body was out, the server now holds the current state.
    this.userSent = inSync ? userKey(this.contribution()) : userKey(body);
    this.persist();
  }

  /** Asks the handler for a hash for `id` (or waits for a handler), then registers with it. */
  private async recover(id: string): Promise<void> {
    if (!this.handler) {
      this.waitingFor = id;
      return;
    }
    this.waitingFor = undefined;
    const hash = await this.ask(id);
    const current = this.externalId === id || this.rejectedId === id;
    if (!current) return;
    const previous = this.state();
    if (hash) {
      this.externalId = id;
      this.hash = hash;
      this.verified = true;
      this.rejectedId = undefined;
      this.changed(previous, false);
      await this.sendNow();
    } else if (this.externalId === id) {
      this.externalId = undefined;
      this.changed(previous, false);
    }
  }

  private async ask(id: string): Promise<string | null> {
    try {
      const hash = await this.handler?.(id);
      return typeof hash === "string" && hash !== "" ? hash : null;
    } catch (error) {
      this.deps.log.error(`The identity verification handler failed: ${error instanceof Error ? error.message : String(error)}`);
      return null;
    }
  }

  // ------------------------------------------------------------------ helpers

  private publicId(): string | null {
    return typeof this.externalId === "string" ? this.externalId : null;
  }

  private state(): UserState {
    return { externalId: this.publicId(), subscriptionId: this.deps.push.id };
  }

  /** Stores the change, tells the observers, and (unless the caller sends now) schedules a sync. */
  private changed(previous?: UserState, sync = true): void {
    this.persist();
    if (previous) {
      const current = this.state();
      if (previous.externalId !== current.externalId) this.observers.emit({ previous, current });
    }
    if (sync) this.schedule(SYNC_DELAY_MS);
  }

  private persist(): void {
    this.ctx?.db
      .mergeState({
        externalId: this.externalId,
        tags: this.tags,
        aliases: this.aliases,
        language: this.language,
        verified: this.verified,
        ivRequired: this.ivRequired,
        userSent: this.userSent,
      })
      .catch(() => undefined);
  }

  private schedule(delay: number): void {
    if (!this.ctx || this.timer !== undefined) return;
    this.timer = this.deps.timers.setTimeout(() => {
      this.timer = undefined;
      void this.sendNow();
    }, delay);
  }

  /** Registers again now; resolves once the server accepted it (or when there is no row yet). */
  private async sendNow(): Promise<void> {
    if (this.timer !== undefined) this.deps.timers.clearTimeout(this.timer);
    this.timer = undefined;
    await this.deps.push.register().catch(() => undefined);
  }
}
