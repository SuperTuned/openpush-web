/**
 * A fake `OpenPush` object for the compatibility layer tests: every member is a spy, and the
 * observer and listener sets can be fired by hand.
 */
import { vi } from "vitest";
import type { OpenPushApi } from "../../src/core/sdk";
import { Logger, type LogEntry } from "../../src/log/logger";
import type { OpenPushNotification } from "../../src/notification";

type Fn = (...args: never[]) => unknown;

export interface FakeApi {
  api: OpenPushApi;
  state: { externalId: string | null; id: string | null; token: string | null; optedIn: boolean; permission: boolean; permissionStatus: "default" | "granted" | "denied" };
  /** Listener sets by name: click, foreground, dismiss, permission, push, user, prompt:<event>, permissionPrompt. */
  sets: Record<string, Set<Fn>>;
  fire(name: string, value?: unknown): void;
  /** A function that calls the permission prompt listeners (the core's `onPermissionPrompt`). */
  onPermissionPrompt(listener: () => void): () => void;
}

export function fakeApi(): FakeApi {
  const sets: Record<string, Set<Fn>> = {};
  const set = (name: string): Set<Fn> => (sets[name] ??= new Set());
  const adder = (name: string) => vi.fn((fn: Fn) => void set(name).add(fn));
  const remover = (name: string) => vi.fn((fn: Fn) => void set(name).delete(fn));
  const state: FakeApi["state"] = { externalId: null, id: null, token: null, optedIn: false, permission: false, permissionStatus: "default" };
  const api = {
    version: "2.0.0-test",
    initialize: vi.fn(async () => undefined),
    login: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    setConsentRequired: vi.fn(),
    setConsentGiven: vi.fn(),
    trackEvent: vi.fn(),
    User: {
      get externalId() {
        return state.externalId;
      },
      addTag: vi.fn(),
      addTags: vi.fn(),
      removeTag: vi.fn(),
      removeTags: vi.fn(),
      getTags: vi.fn(() => ({ level: "7" })),
      addAlias: vi.fn(),
      addAliases: vi.fn(),
      removeAlias: vi.fn(),
      removeAliases: vi.fn(),
      addEmail: vi.fn(() => true),
      removeEmail: vi.fn(() => true),
      addSms: vi.fn(() => true),
      removeSms: vi.fn(() => true),
      getLanguage: vi.fn(() => "fr"),
      setLanguage: vi.fn(),
      addObserver: adder("user"),
      removeObserver: remover("user"),
    },
    PushSubscription: {
      get id() {
        return state.id;
      },
      get token() {
        return state.token;
      },
      get optedIn() {
        return state.optedIn;
      },
      optIn: vi.fn(async () => undefined),
      optOut: vi.fn(async () => undefined),
      addObserver: adder("push"),
      removeObserver: remover("push"),
    },
    Notifications: {
      get permission() {
        return state.permission;
      },
      get permissionStatus() {
        return state.permissionStatus;
      },
      isPushSupported: vi.fn(() => true),
      requestPermission: vi.fn(async () => true),
      setDefaultUrl: vi.fn(),
      setDefaultTitle: vi.fn(),
      addClickListener: adder("click"),
      removeClickListener: remover("click"),
      addForegroundLifecycleListener: adder("foreground"),
      removeForegroundLifecycleListener: remover("foreground"),
      addDismissListener: adder("dismiss"),
      removeDismissListener: remover("dismiss"),
      addPermissionObserver: adder("permission"),
      removePermissionObserver: remover("permission"),
    },
    Prompts: {
      showSlideIn: vi.fn(async () => undefined),
      showTopics: vi.fn(async () => undefined),
      showEmail: vi.fn(async () => undefined),
      showPhone: vi.fn(async () => undefined),
      showEmailOrPhone: vi.fn(async () => undefined),
      showBell: vi.fn(async () => undefined),
      addListener: vi.fn((event: string, fn: Fn) => void set(`prompt:${event}`).add(fn)),
      removeListener: vi.fn((event: string, fn: Fn) => void set(`prompt:${event}`).delete(fn)),
    },
    Session: { sendOutcome: vi.fn(), sendUniqueOutcome: vi.fn() },
    Debug: { setLogLevel: vi.fn(), addLogListener: vi.fn(), removeLogListener: vi.fn() },
  };
  return {
    api: api as unknown as OpenPushApi,
    state,
    sets,
    fire: (name, value) => {
      for (const fn of [...set(name)]) (fn as (v: unknown) => unknown)(value);
    },
    onPermissionPrompt: (listener) => {
      set("permissionPrompt").add(listener);
      return () => void set("permissionPrompt").delete(listener);
    },
  };
}

/** A real Logger whose lines are kept in `lines`. */
export function testLog(): { log: Logger; lines: LogEntry[] } {
  const lines: LogEntry[] = [];
  const sink = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const log = new Logger(sink, () => 0, "trace");
  log.addListener((entry) => lines.push(entry));
  return { log, lines };
}

export function notification(over: Partial<OpenPushNotification> = {}): OpenPushNotification {
  return {
    id: "msg_1",
    title: "Spring sale",
    body: "Everything 20% off",
    icon: "https://cdn.example.com/icon.png",
    image: "https://cdn.example.com/large.png",
    badge: null,
    url: "https://play.example.com/sale",
    buttons: [
      { id: "shop", title: "Shop now", url: "https://play.example.com/shop", icon: "https://cdn.example.com/cart.png" },
      { id: "b2", title: "Later", url: "https://play.example.com/later" },
    ],
    topic: "sale",
    data: { campaign: "spring" },
    receivedAt: 1_000,
    ...over,
  };
}
