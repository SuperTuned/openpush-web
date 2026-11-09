/**
 * A fake `PromptsHost` for the prompt UI tests: a happy-dom document, an in-memory
 * `openpush.prompts`, recorded calls, and push state the test can change.
 */
import { vi } from "vitest";
import type { EnvInfo } from "../../src/env/detect";
import type { BrowserName } from "../../src/env/browser";
import type { OsName } from "../../src/env/platform";
import { OpenPushError } from "../../src/errors";
import { Logger } from "../../src/log/logger";
import type { PermissionValue } from "../../src/platform/types";
import type { GestureResult } from "../../src/push/controller";
import type { PushStatus } from "../../src/push/state";
import { LocalStore } from "../../src/storage/local";
import { PromptStore } from "../../src/prompts/store";
import type { HostView, PromptEvent, PromptEventName, PromptsHost } from "../../src/prompts/types";
import type { Verification, VerifyApi } from "../../src/verify/verify";
import { FakeStorage } from "./fake_platform";

export function env(o: { os?: OsName; name?: BrowserName; standalone?: boolean; inApp?: boolean } = {}): EnvInfo {
  const os = o.os ?? "windows";
  return {
    userAgent: "test",
    language: "en-GB",
    standalone: o.standalone ?? false,
    inAppBrowser: o.inApp ?? false,
    browser: { name: o.name ?? "chrome", version: "131", os, os_version: "", standalone: o.standalone ?? false },
    support: { supported: true },
  };
}

export interface FakeHostOptions {
  prompts?: unknown[];
  language?: string;
  nonce?: string;
  env?: EnvInfo;
  status?: PushStatus;
  /** The browser opted out (the push controller's local flag). */
  optedOut?: boolean;
  permission?: PermissionValue;
  pushBlocked?: OpenPushError;
  channels?: { email: boolean; phone: boolean };
  href?: string;
  /** What a tap answers. */
  answer?: GestureResult | Error;
  tags?: Record<string, string>;
  newRegistrations?: boolean;
}

export interface FakeHost {
  host: PromptsHost;
  storage: FakeStorage;
  events: [PromptEventName, PromptEvent][];
  state: { status: PushStatus; optedOut: boolean; permission: PermissionValue; view: HostView; answer: GestureResult | Error; now: number };
  subscribe: ReturnType<typeof vi.fn>;
  requestDirect: ReturnType<typeof vi.fn>;
  optOut: ReturnType<typeof vi.fn>;
  addTags: ReturnType<typeof vi.fn>;
  addEmail: ReturnType<typeof vi.fn>;
  addSms: ReturnType<typeof vi.fn>;
  setVerifyCode: ReturnType<typeof vi.fn>;
  replaceUrl: ReturnType<typeof vi.fn>;
  verify: { start: ReturnType<typeof vi.fn>; check: ReturnType<typeof vi.fn>; resend: ReturnType<typeof vi.fn> };
  /** Fires the push-change listeners. */
  pushChanged(): void;
  pageHide(): void;
  /** The open shadow root of our host element of `kind`. */
  root(kind: string): ShadowRoot | null;
}

const VERIFICATION: Verification = { id: "ver-1", maskedNumber: "+1••••0123", channel: "sms", status: "pending", attempts: 0, expiresAt: null };

export function fakeHost(o: FakeHostOptions = {}): FakeHost {
  const storage = new FakeStorage();
  const local = new LocalStore(storage, () => true);
  const store = new PromptStore(local);
  const events: [PromptEventName, PromptEvent][] = [];
  const pushListeners: (() => void)[] = [];
  const hideListeners: (() => void)[] = [];
  let href = o.href ?? "https://play.example.com/";
  const state = {
    status: o.status ?? ("not_asked" as PushStatus),
    optedOut: o.optedOut ?? o.status === "opted_out",
    permission: o.permission ?? ("default" as PermissionValue),
    answer: o.answer ?? ({ permission: "granted", subscribed: true } as GestureResult | Error),
    now: 1_800_000_000_000,
    view: {
      prompts: o.prompts ?? [],
      language: o.language ?? "en",
      site: { name: "Example Play", origin: "https://play.example.com", icon: "https://play.example.com/icon.png" },
      channels: o.channels ?? { email: true, phone: true },
      env: o.env ?? env(),
      allowed: true,
      pushBlocked: o.pushBlocked,
      newRegistrations: o.newRegistrations ?? true,
    } as HostView,
  };
  if (o.nonce) state.view.nonce = o.nonce;
  const answer = (): Promise<GestureResult> => (state.answer instanceof Error ? Promise.reject(state.answer) : Promise.resolve(state.answer));
  const subscribe = vi.fn(answer);
  const requestDirect = vi.fn(answer);
  const optOut = vi.fn(async () => undefined);
  const addTags = vi.fn();
  const addEmail = vi.fn(() => true);
  const addSms = vi.fn(() => true);
  const setVerifyCode = vi.fn();
  const replaceUrl = vi.fn((url: string) => {
    href = url;
  });
  const verify = {
    start: vi.fn(async () => VERIFICATION),
    check: vi.fn(async () => ({ ...VERIFICATION, status: "approved" })),
    resend: vi.fn(async () => VERIFICATION),
  };
  const sink = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
  const host: PromptsHost = {
    log: new Logger(sink, () => state.now),
    timers: { setTimeout: (fn, ms) => setTimeout(fn, ms), clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>) },
    now: () => state.now,
    pageStart: state.now,
    store,
    dom: {
      document,
      href: () => href,
      replaceUrl,
      onPageHide: (listener) => hideListeners.push(listener),
    },
    view: () => state.view,
    settled: async () => undefined,
    status: () => state.status,
    optedOut: () => state.optedOut,
    permission: () => state.permission,
    canRequestPermission: () => state.permission === "default",
    privateMode: () => false,
    subscribe,
    requestDirect,
    optOut,
    onPushChange: (listener) => {
      pushListeners.push(listener);
      return () => undefined;
    },
    getTags: () => ({ ...(o.tags ?? {}) }),
    addTags,
    addEmail,
    addSms,
    verify: verify as unknown as VerifyApi,
    setVerifyCode,
    emit: (name, event) => events.push([name, event]),
    error: (code, message, detail) => new OpenPushError(code, message, detail),
  };
  return {
    host,
    storage,
    events,
    state,
    subscribe,
    requestDirect,
    optOut,
    addTags,
    addEmail,
    addSms,
    setVerifyCode,
    replaceUrl,
    verify,
    pushChanged: () => pushListeners.forEach((fn) => fn()),
    pageHide: () => hideListeners.forEach((fn) => fn()),
    root: (kind) => document.querySelector<HTMLElement>(`[data-openpush-prompt="${kind}"]`)?.shadowRoot ?? null,
  };
}
