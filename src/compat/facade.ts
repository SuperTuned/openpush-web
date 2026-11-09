/**
 * The compat object: the reference's web SDK shape, as a facade over `OpenPush`. It is
 * what deferred callbacks receive and what sits on the reference's global.
 */
import type { OpenPushApi } from "../core/sdk";
import type { Logger } from "../log/logger";
import type { LogLevel } from "../log/levels";
import type { PushSubscriptionChange } from "../push/state";
import type { TagValue } from "../user/api";
import type { UserChange } from "../user/user";
import { REF_USER_ID } from "./names";
import { toCompatNotification, type CompatNotification } from "./notification";
import { mapInitOptions } from "./options";
import { REMOVED_METHODS } from "./removed";

type Listener = (...args: never[]) => unknown;
type AnyFn = (...args: unknown[]) => unknown;

export type CompatLog = Pick<Logger, "warn" | "info" | "once">;

export interface CompatDeps {
  api: OpenPushApi;
  log: CompatLog;
  /** Calls `listener` just before the browser permission prompt; returns a remover. */
  onPermissionPrompt(listener: () => void): () => void;
  /** Marks the reference's placed-link containers so the placed button renders into them. */
  markLinkContainers?: () => void;
}

export interface CompatPushSubscriptionState {
  id: string | null;
  token: string | null;
  optedIn: boolean;
}

export interface CompatClickEvent {
  notification: CompatNotification;
  result: { actionId: string; url: string };
}

export interface CompatForegroundEvent {
  notification: CompatNotification;
  preventDefault(): void;
  display(): void;
}

/** The compat object. Members not listed here are the removed methods (warn and do nothing). */
export interface CompatSdk {
  init(options: Record<string, unknown>): Promise<void>;
  login(externalId: string): Promise<void>;
  logout(): Promise<void>;
  setConsentRequired(required: boolean): void;
  setConsentGiven(given: boolean): void;
  readonly User: CompatUser;
  readonly Notifications: CompatNotifications;
  readonly Slidedown: CompatSlidedown;
  readonly Session: { sendOutcome(name: string, value?: number): void; sendUniqueOutcome(name: string): void };
  readonly Debug: { setLogLevel(level: LogLevel): void };
  /** The reference's previous queue shape: a function runs after init; `[name, ...args]` calls a member. */
  push(item: unknown): void;
  [removed: string]: unknown;
}

export interface CompatUser {
  /** Not compatible: always null, with one warning per page. */
  readonly onesignalId: null;
  readonly externalId: string | null;
  readonly PushSubscription: CompatPushSubscription;
  addEventListener(event: "change", listener: (change: { current: { onesignalId: null; externalId: string | null } }) => void): void;
  removeEventListener(event: "change", listener: Listener): void;
  addAlias(label: string, id: string): void;
  addAliases(aliases: Record<string, string>): void;
  removeAlias(label: string): void;
  removeAliases(labels: string[]): void;
  addTag(key: string, value: TagValue): void;
  addTags(tags: Record<string, TagValue>): void;
  removeTag(key: string): void;
  removeTags(keys: string[]): void;
  getTags(): Record<string, string>;
  getLanguage(): string;
  setLanguage(code: string): void;
  addEmail(address: string): void;
  removeEmail(address: string): void;
  addSms(number: string): void;
  removeSms(number: string): void;
  trackEvent(name: string, properties?: Record<string, unknown>): void;
}

export interface CompatPushSubscription extends CompatPushSubscriptionState {
  optIn(): Promise<void>;
  optOut(): Promise<void>;
  addEventListener(event: "change", listener: (change: { previous: CompatPushSubscriptionState; current: CompatPushSubscriptionState }) => void): void;
  removeEventListener(event: "change", listener: Listener): void;
}

export type CompatNotificationEvent = "click" | "foregroundWillDisplay" | "dismiss" | "permissionChange" | "permissionPromptDisplay";

export interface CompatNotifications {
  readonly permission: boolean;
  readonly permissionNative: "default" | "granted" | "denied";
  isPushSupported(): boolean;
  requestPermission(): Promise<boolean>;
  setDefaultUrl(url: string): void;
  setDefaultTitle(title: string): void;
  addEventListener(event: CompatNotificationEvent, listener: Listener): void;
  removeEventListener(event: CompatNotificationEvent, listener: Listener): void;
}

export interface CompatSlidedown {
  promptPush(options?: { force?: boolean }): Promise<void>;
  promptPushCategories(options?: { force?: boolean }): Promise<void>;
  promptEmail(options?: { force?: boolean }): Promise<void>;
  promptSms(options?: { force?: boolean }): Promise<void>;
  promptSmsAndEmail(options?: { force?: boolean }): Promise<void>;
  addEventListener(event: "slidedownShown", listener: Listener): void;
  removeEventListener(event: "slidedownShown", listener: Listener): void;
}

/** Remembers the OpenPush listener made for each site listener, so `removeEventListener` works. */
class Registry {
  private readonly byEvent = new Map<string, Map<Listener, { remove: () => void }>>();

  add(event: string, listener: Listener, attach: () => () => void): void {
    if (typeof listener !== "function") return;
    let map = this.byEvent.get(event);
    if (!map) this.byEvent.set(event, (map = new Map()));
    if (map.has(listener)) return;
    map.set(listener, { remove: attach() });
  }

  remove(event: string, listener: Listener): void {
    const map = this.byEvent.get(event);
    const entry = map?.get(listener);
    if (!entry) return;
    map?.delete(listener);
    entry.remove();
  }
}

const PROMPT_SHOWN_TYPES = new Set(["slide_in", "email_phone"]);

function pushState(state: { id: string | null; token: string | null; optedIn: boolean }): CompatPushSubscriptionState {
  return { id: state.id, token: state.token, optedIn: state.optedIn };
}

function force(options: { force?: boolean } | undefined): { force: boolean } {
  return { force: options?.force === true };
}

/** Builds the compat object over `deps.api`. */
export function createCompat(deps: CompatDeps): CompatSdk {
  const { api, log } = deps;
  const registry = new Registry();
  let initCalled = false;
  const call = (fn: Listener, ...args: unknown[]): void => {
    (fn as AnyFn)(...args);
  };
  const unknownEvent = (owner: string, event: unknown): void =>
    log.once(`compat-event-${owner}-${String(event)}`, "warn", `${owner}.addEventListener: "${String(event)}" is not an event OpenPush maps; it never fires`);

  const init = async (options: Record<string, unknown>): Promise<void> => {
    if (initCalled) {
      log.warn("OpenPush is already initialized on this page; this init call changes nothing");
      return;
    }
    initCalled = true;
    const mapped = mapInitOptions(options);
    if (mapped.ignored.length > 0) {
      log.once("compat-ignored", "warn", `These init options have no OpenPush equivalent and were ignored: ${mapped.ignored.join(", ")}`);
    }
    if (mapped.unsupported.length > 0) {
      log.once("compat-unsupported", "info", `These init options are not supported and were ignored: ${mapped.unsupported.join(", ")}`);
    }
    if (mapped.defaultConsent) {
      log.once(
        "compat-consent",
        "warn",
        "The email or phone prompt shows OpenPush's default consent line. Set your own consent wording in the OpenPush console",
      );
    }
    if (mapped.displayPredicate) {
      let show: unknown = true;
      try {
        show = await mapped.displayPredicate();
      } catch (error) {
        log.warn(`notifyButton.displayPredicate failed, so the bell shows: ${error instanceof Error ? error.message : String(error)}`);
      }
      if (show === false) mapped.options.prompts = (mapped.options.prompts ?? []).filter((p) => p.type !== "bell");
    }
    if (mapped.placedButton) deps.markLinkContainers?.();
    await api.initialize(mapped.options);
  };

  const pushSubscription: CompatPushSubscription = {
    get id() {
      return api.PushSubscription.id;
    },
    get token() {
      return api.PushSubscription.token;
    },
    get optedIn() {
      return api.PushSubscription.optedIn;
    },
    optIn: () => api.PushSubscription.optIn(),
    optOut: () => api.PushSubscription.optOut(),
    addEventListener: (event, listener) => {
      if (event !== "change") return unknownEvent("User.PushSubscription", event);
      registry.add("push-change", listener as Listener, () => {
        const observer = (change: PushSubscriptionChange): void =>
          call(listener as Listener, { previous: pushState(change.previous), current: pushState(change.current) });
        api.PushSubscription.addObserver(observer);
        return () => api.PushSubscription.removeObserver(observer);
      });
    },
    removeEventListener: (event, listener) => registry.remove("push-change", listener),
  };

  const user: CompatUser = {
    get onesignalId(): null {
      log.once(
        "compat-user-id",
        "warn",
        `User.${REF_USER_ID} is always null in OpenPush. Use OpenPush.User.externalId for the person, or OpenPush.PushSubscription.id for this browser`,
      );
      return null;
    },
    get externalId() {
      return api.User.externalId;
    },
    PushSubscription: pushSubscription,
    addEventListener: (event, listener) => {
      if (event !== "change") return unknownEvent("User", event);
      registry.add("user-change", listener as Listener, () => {
        const observer = (change: UserChange): void => call(listener as Listener, { current: { [REF_USER_ID]: null, externalId: change.current.externalId } });
        api.User.addObserver(observer);
        return () => api.User.removeObserver(observer);
      });
    },
    removeEventListener: (event, listener) => registry.remove("user-change", listener),
    addAlias: (label, id) => api.User.addAlias(label, id),
    addAliases: (aliases) => api.User.addAliases(aliases),
    removeAlias: (label) => api.User.removeAlias(label),
    removeAliases: (labels) => api.User.removeAliases(labels),
    addTag: (key, value) => api.User.addTag(key, value),
    addTags: (tags) => api.User.addTags(tags),
    removeTag: (key) => api.User.removeTag(key),
    removeTags: (keys) => api.User.removeTags(keys),
    getTags: () => api.User.getTags(),
    getLanguage: () => api.User.getLanguage(),
    setLanguage: (code) => api.User.setLanguage(code),
    addEmail: (address) => {
      api.User.addEmail(address);
    },
    removeEmail: (address) => {
      api.User.removeEmail(address);
    },
    addSms: (number) => {
      api.User.addSms(number);
    },
    removeSms: (number) => {
      api.User.removeSms(number);
    },
    trackEvent: (name, properties) => api.trackEvent(name, properties),
  };

  const notifications: CompatNotifications = {
    get permission() {
      return api.Notifications.permission;
    },
    get permissionNative() {
      return api.Notifications.permissionStatus;
    },
    isPushSupported: () => api.Notifications.isPushSupported(),
    requestPermission: () => api.Notifications.requestPermission(),
    setDefaultUrl: (url) => api.Notifications.setDefaultUrl(url),
    setDefaultTitle: (title) => api.Notifications.setDefaultTitle(title),
    addEventListener: (event, listener) => {
      const n = api.Notifications;
      switch (event) {
        case "click":
          return registry.add(event, listener, () => {
            const fn = (e: Parameters<Parameters<typeof n.addClickListener>[0]>[0]): void =>
              call(listener, { notification: toCompatNotification(e.notification), result: { ...e.result } } satisfies CompatClickEvent);
            n.addClickListener(fn);
            return () => n.removeClickListener(fn);
          });
        case "foregroundWillDisplay":
          return registry.add(event, listener, () => {
            const fn = (e: Parameters<Parameters<typeof n.addForegroundLifecycleListener>[0]>[0]): void => {
              const display = (): void => e.display();
              call(listener, {
                notification: toCompatNotification(e.notification, display),
                preventDefault: () => e.preventDefault(),
                display,
              } satisfies CompatForegroundEvent);
            };
            n.addForegroundLifecycleListener(fn);
            return () => n.removeForegroundLifecycleListener(fn);
          });
        case "dismiss":
          return registry.add(event, listener, () => {
            const fn = (e: Parameters<Parameters<typeof n.addDismissListener>[0]>[0]): void =>
              call(listener, { notification: toCompatNotification(e.notification) });
            n.addDismissListener(fn);
            return () => n.removeDismissListener(fn);
          });
        case "permissionChange":
          return registry.add(event, listener, () => {
            const fn = (change: { permission: boolean }): void => call(listener, change.permission);
            n.addPermissionObserver(fn);
            return () => n.removePermissionObserver(fn);
          });
        case "permissionPromptDisplay":
          return registry.add(event, listener, () => deps.onPermissionPrompt(() => call(listener)));
        default:
          return unknownEvent("Notifications", event);
      }
    },
    removeEventListener: (event, listener) => registry.remove(event, listener),
  };

  const slidedown: CompatSlidedown = {
    promptPush: (options) => api.Prompts.showSlideIn(force(options)),
    promptPushCategories: (options) => api.Prompts.showTopics(force(options)),
    promptEmail: (options) => api.Prompts.showEmail(force(options)),
    promptSms: (options) => api.Prompts.showPhone(force(options)),
    promptSmsAndEmail: (options) => api.Prompts.showEmailOrPhone(force(options)),
    addEventListener: (event, listener) => {
      if (event !== "slidedownShown") return unknownEvent("Slidedown", event);
      registry.add(event, listener, () => {
        const fn = (e: { type: string }): void => {
          if (PROMPT_SHOWN_TYPES.has(e.type)) call(listener);
        };
        api.Prompts.addListener("shown", fn);
        return () => api.Prompts.removeListener("shown", fn);
      });
    },
    removeEventListener: (event, listener) => registry.remove(event, listener),
  };

  const compat: CompatSdk = {
    init,
    login: (externalId) => api.login(externalId),
    logout: () => api.logout(),
    setConsentRequired: (required) => api.setConsentRequired(required),
    setConsentGiven: (given) => api.setConsentGiven(given),
    User: user,
    Notifications: notifications,
    Slidedown: slidedown,
    Session: {
      sendOutcome: (name, value) => api.Session.sendOutcome(name, value),
      sendUniqueOutcome: (name) => api.Session.sendUniqueOutcome(name),
    },
    Debug: { setLogLevel: (level) => api.Debug.setLogLevel(level) },
    push: (item) => runLegacy(compat, item, log),
  };
  for (const [name, replacement] of Object.entries(REMOVED_METHODS)) {
    compat[name] = (): Promise<void> => {
      log.once(`compat-removed-${name}`, "warn", `${name}() was removed; use ${replacement}. This call does nothing`);
      return Promise.resolve();
    };
  }
  return compat;
}

/**
 * One item of the reference's previous array queue: a function (called with the compat object), or
 * `[methodName, ...args]`.
 */
export function runLegacy(compat: CompatSdk, item: unknown, log: CompatLog): unknown {
  if (typeof item === "function") return (item as AnyFn)(compat);
  if (Array.isArray(item) && typeof item[0] === "string") {
    const member = compat[item[0]];
    if (typeof member === "function") return (member as AnyFn)(...item.slice(1));
    log.warn(`${item[0]} is not a method OpenPush maps; this call does nothing`);
    return undefined;
  }
  log.warn("push needs a function");
  return undefined;
}
