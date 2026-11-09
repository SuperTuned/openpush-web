/**
 * Types shared by the page SDK (`openpush.js`) and the prompt UI chunk (`openpush-prompts.js`).
 * The chunk only sees the page SDK through `PromptsHost`, so this file is the contract
 * between the two files: keep it stable within a major version.
 */
import type { EnvInfo } from "../env/detect";
import type { OpenPushError, OpenPushErrorCode } from "../errors";
import type { Logger } from "../log/logger";
import type { Timers } from "../net/queue";
import type { PermissionValue } from "../platform/types";
import type { GestureResult } from "../push/controller";
import type { PushStatus } from "../push/state";
import type { TagValue } from "../user/api";
import type { ChannelConsent } from "../user/channels";
import type { VerifyApi } from "../verify/verify";
import type { PromptStore } from "./store";

export type PromptType = "slide_in" | "bell" | "button" | "browser" | "email_phone";

/** Prompt outcomes: `accepted` = Allow, Subscribe or submit; `dismissed` = Later or close; `closed` = removed without a choice. */
export type PromptEventName = "shown" | "accepted" | "dismissed" | "closed";

export interface PromptEvent {
  type: PromptType;
  /** The prompt's `id`, or its type when the prompt has no saved id. */
  promptId: string;
}

export type PromptListener = (event: PromptEvent) => void;

export interface ShowOptions {
  /** Ignore timing and the cooldown. Call it from a click. */
  force?: boolean;
}

/** What a `Prompts.show…` call asks for. */
export type ShowKind = "slide_in" | "topics" | "email" | "phone" | "email_or_phone" | "bell";

/** `OpenPush.Prompts`. */
export interface PromptsApi {
  /** Shows the slide-in prompt. Resolves once it is on screen, or at once when it does not apply (the reason is logged). */
  showSlideIn(options?: ShowOptions): Promise<void>;
  /** Shows the slide-in prompt with its topics; to a subscribed person, their current choices. */
  showTopics(options?: ShowOptions): Promise<void>;
  /** Shows the email or phone prompt asking for an email address only. */
  showEmail(options?: ShowOptions): Promise<void>;
  /** Shows the email or phone prompt asking for a phone number only. */
  showPhone(options?: ShowOptions): Promise<void>;
  /** Shows the email or phone prompt with the fields it is set up with. */
  showEmailOrPhone(options?: ShowOptions): Promise<void>;
  /** Shows the bell, also when no bell is set up. */
  showBell(options?: ShowOptions): Promise<void>;
  addListener(event: PromptEventName, listener: PromptListener): void;
  removeListener(event: PromptEventName, listener: PromptListener): void;
}

/** The page settings the prompt UI reads; refreshed when a fresh config arrives. */
export interface HostView {
  /** Raw prompt definitions, from the console or `initialize({prompts})`. */
  prompts: readonly unknown[];
  /** `promptsLanguage` (BCP-47). */
  language: string;
  nonce?: string;
  site: { name: string; origin: string; icon: string | null };
  /** Which address channels the email or phone prompt may offer. */
  channels: { email: boolean; phone: boolean };
  env: EnvInfo;
  /** False when no prompt may show on this page (wrong origin, web push off, no config). */
  allowed: boolean;
  /** Why push cannot work on this page, if it cannot (unsupported browser, iOS tab, …). */
  pushBlocked: OpenPushError | undefined;
  /** New push subscriptions are possible for this app, or this browser already has a direct row. */
  newRegistrations: boolean;
}

/** The DOM the prompt UI draws into. */
export interface PromptDom {
  readonly document: Document;
  /** The page URL now. */
  href(): string;
  /** `history.replaceState` to `url`. */
  replaceUrl(url: string): void;
  /** Calls `listener` when the page is left (`pagehide`). */
  onPageHide(listener: () => void): void;
}

/** What the page SDK gives the prompt UI chunk. */
export interface PromptsHost {
  readonly log: Logger;
  readonly timers: Timers;
  now(): number;
  /** When this page loaded, in milliseconds (timing counts seconds from here). */
  readonly pageStart: number;
  /** Page views, cooldowns and accepted prompts (`openpush.prompts`). */
  readonly store: PromptStore;
  readonly dom: PromptDom;
  view(): HostView;
  /** Resolves when the page-load push work has finished. */
  settled(): Promise<void>;
  status(): PushStatus;
  /** This browser opted out, whatever the permission is now. */
  optedOut(): boolean;
  permission(): PermissionValue;
  canRequestPermission(): boolean;
  /** A subscribe failed this visit in what looks like a private window. */
  privateMode(): boolean;
  /**
   * A tap on Allow, Subscribe or a placed button: `opt_in: true`. Call it straight from
   * the click handler, before any `await`, so the tap counts as the gesture.
   */
  subscribe(): Promise<GestureResult>;
  /**
   * The auto `browser` type on Chrome and Edge desktop: the browser's prompt, started by a timer
   * and not by a tap, so it never sends `opt_in`.
   */
  requestDirect(): Promise<GestureResult>;
  /** Unsubscribe from the bell or a button: `PushSubscription.optOut()`. */
  optOut(): Promise<void>;
  /** Calls `listener` on every push subscription or permission change; returns a remover. */
  onPushChange(listener: () => void): () => void;
  getTags(): Record<string, string>;
  addTags(tags: Record<string, TagValue>): void;
  addEmail(address: string, consent: ChannelConsent): boolean;
  addSms(number: string, consent: ChannelConsent): boolean;
  readonly verify: VerifyApi;
  /** The next push registration carries this console verify code. */
  setVerifyCode(code: string): void;
  emit(name: PromptEventName, event: PromptEvent): void;
  /** An `OpenPushError` of the page SDK (so `instanceof` works for the site). */
  error(code: OpenPushErrorCode, message: string, detail?: Record<string, unknown>): Error;
}

/** The prompt UI, built by the chunk for one page. */
export interface PromptsUi {
  /** Auto prompts, the bell, placed buttons and the verify bar. Runs once; later calls do nothing. */
  start(): void;
  show(kind: ShowKind, options: ShowOptions): Promise<void>;
  /** The config or the push state changed. */
  refresh(): void;
}

/** What `openpush-prompts.js` puts on `globalThis.OpenPushPrompts`. */
export interface PromptsChunk {
  version: string;
  create(host: PromptsHost): PromptsUi;
}

/** Loads the prompt UI chunk. Replaceable (`Runtime.prompts.setLoader`) for bundlers. */
export type ChunkLoader = () => Promise<PromptsChunk>;

export const PROMPT_EVENTS: readonly PromptEventName[] = ["shown", "accepted", "dismissed", "closed"];

/** Auto prompts in the order they win when several are due. */
export const AUTO_ORDER = ["browser", "slide_in", "email_phone"] as const;
export type AutoType = (typeof AUTO_ORDER)[number];

/** `?openpush-verify=<code>`. */
export const VERIFY_PARAM = "openpush-verify";
