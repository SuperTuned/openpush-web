/** The public `OpenPush.User` and `OpenPush.Session` objects. */
import type { EventTracker } from "../events/events";
import type { PushSubscriptionApi } from "../push/api";
import type { ChannelConsent, ChannelWriter } from "./channels";
import type { UserController, UserObserver } from "./user";

export type TagValue = string | number | boolean;

/** `OpenPush.User`. Tags, aliases and the language ride the next registration (mobile pattern). */
export interface UserApi {
  /** The current external ID; null when no one is logged in. */
  readonly externalId: string | null;
  /** The same object as `OpenPush.PushSubscription`. */
  readonly pushSubscription: PushSubscriptionApi;
  /** Keys: letters, digits, `_`, `-`, `.`, at most 60; values at most 300 characters. */
  addTag(key: string, value: TagValue): void;
  addTags(tags: Record<string, TagValue>): void;
  removeTag(key: string): void;
  removeTags(keys: string[]): void;
  /** This browser's copy of the user's tags. */
  getTags(): Record<string, string>;
  addAlias(label: string, id: string): void;
  addAliases(aliases: Record<string, string>): void;
  removeAlias(label: string): void;
  removeAliases(labels: string[]): void;
  /**
   * Adds an email address for the logged-in user. True when it is valid and was queued.
   * `consent` is the wording the person agreed to (OpenPush prompts pass it).
   */
  addEmail(address: string, consent?: ChannelConsent): boolean;
  /** Removes the address (`status: -2`); a later `addEmail` adds it again. */
  removeEmail(address: string): boolean;
  /** Adds a phone number for texts; it receives nothing until a phone code proves it (`Verify`). */
  addSms(number: string, consent?: ChannelConsent): boolean;
  removeSms(number: string): boolean;
  addWhatsApp(number: string, consent?: ChannelConsent): boolean;
  removeWhatsApp(number: string): boolean;
  /** The language on this browser's row: the one set here, else the browser's. */
  getLanguage(): string;
  /** Overrides the browser language on this browser's row. */
  setLanguage(code: string): void;
  /** Fires on login, logout and when the subscription id is assigned. */
  addObserver(observer: UserObserver): void;
  removeObserver(observer: UserObserver): void;
}

/** `OpenPush.Session`: outcomes. */
export interface SessionApi {
  /** A custom event named `name`, with `{value}` when given. */
  sendOutcome(name: string, value?: number): void;
  /** The same, counted once per push that led here (or once a day without one). */
  sendUniqueOutcome(name: string): void;
}

export function userApi(user: UserController, channels: ChannelWriter, pushSubscription: PushSubscriptionApi): UserApi {
  const one = (key: string): string[] => [key];
  return {
    get externalId() {
      return user.currentExternalId;
    },
    pushSubscription,
    addTag: (key, value) => user.addTags({ [key]: value }),
    addTags: (tags) => user.addTags(tags),
    removeTag: (key) => user.removeTags(one(key)),
    removeTags: (keys) => user.removeTags(keys),
    getTags: () => user.getTags(),
    addAlias: (label, id) => user.addAliases({ [label]: id }),
    addAliases: (aliases) => user.addAliases(aliases),
    removeAlias: (label) => user.removeAliases(one(label)),
    removeAliases: (labels) => user.removeAliases(labels),
    addEmail: (address, consent) => channels.write("email", address, false, consent),
    removeEmail: (address) => channels.write("email", address, true),
    addSms: (number, consent) => channels.write("sms", number, false, consent),
    removeSms: (number) => channels.write("sms", number, true),
    addWhatsApp: (number, consent) => channels.write("whatsapp", number, false, consent),
    removeWhatsApp: (number) => channels.write("whatsapp", number, true),
    getLanguage: () => user.getLanguage(),
    setLanguage: (code) => user.setLanguage(code),
    addObserver: (observer) => user.observers.add(observer),
    removeObserver: (observer) => {
      user.observers.remove(observer);
    },
  };
}

export function sessionApi(events: EventTracker): SessionApi {
  return {
    sendOutcome: (name, value) => events.sendOutcome(name, value),
    sendUniqueOutcome: (name) => events.sendUniqueOutcome(name),
  };
}
