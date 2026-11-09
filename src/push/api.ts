/** The public push members of `OpenPush.PushSubscription` and `OpenPush.Notifications`. */
import type { PermissionValue } from "../platform/types";
import type { PushController } from "./controller";
import type { PermissionObserver, PushStatus, PushSubscriptionObserver, PushSubscriptionState } from "./state";

/** `OpenPush.PushSubscription` (also `OpenPush.User.pushSubscription`). */
export interface PushSubscriptionApi {
  /** The OpenPush subscription id; null until the server first accepts this browser. */
  readonly id: string | null;
  /** The push endpoint (or the Firebase token of a v1 browser that has not moved yet). */
  readonly token: string | null;
  /** Permission granted, a browser subscription, and no opt-out. */
  readonly optedIn: boolean;
  readonly status: PushStatus;
  snapshot(): PushSubscriptionState;
  /** Clears an opt-out (`status: 1` with `opt_in: true`); asks for permission when needed. */
  optIn(): Promise<void>;
  /** `status: -2`. The browser subscription is kept. */
  optOut(): Promise<void>;
  addObserver(observer: PushSubscriptionObserver): void;
  /** The same observers as `addObserver`, under the mobile SDKs' other name. */
  addChangeObserver(observer: PushSubscriptionObserver): void;
  removeObserver(observer: PushSubscriptionObserver): void;
}

/** The push members of `OpenPush.Notifications`; the listener members are in `NotificationListenersApi`. */
export interface NotificationPushApi {
  /** Browser permission granted (ignores an opt-out). */
  readonly permission: boolean;
  readonly permissionStatus: PermissionValue;
  /** True while permission is "default" and push is supported. */
  readonly canRequestPermission: boolean;
  isPushSupported(): boolean;
  /** Call from a click or tap: shows the browser prompt, then subscribes and registers. */
  requestPermission(): Promise<boolean>;
  addPermissionObserver(observer: PermissionObserver): void;
  removePermissionObserver(observer: PermissionObserver): void;
  /** Where a push without a URL opens. */
  setDefaultUrl(url: string): void;
  /** The title of a push without one. */
  setDefaultTitle(title: string): void;
  /** Closes this site's shown notifications. */
  clearAll(): Promise<void>;
  /** Closes the notification with this tag or topic. */
  remove(tag: string): Promise<void>;
}

export function pushSubscriptionApi(push: PushController): PushSubscriptionApi {
  return {
    get id() {
      return push.id;
    },
    get token() {
      return push.currentToken;
    },
    get optedIn() {
      return push.optedIn;
    },
    get status() {
      return push.status;
    },
    snapshot: () => push.snapshot(),
    optIn: () => push.optIn(),
    optOut: () => push.optOut(),
    addObserver: (observer) => push.subscriptionObservers.add(observer),
    addChangeObserver: (observer) => push.subscriptionObservers.add(observer),
    removeObserver: (observer) => {
      push.subscriptionObservers.remove(observer);
    },
  };
}

/** Adds the push members to `target` (the Notifications object that has the listener members). */
export function addNotificationPushApi<T extends object>(target: T, push: PushController): T & NotificationPushApi {
  const members: NotificationPushApi = {
    get permission() {
      return push.permission;
    },
    get permissionStatus() {
      return push.permissionStatus;
    },
    get canRequestPermission() {
      return push.canRequestPermission;
    },
    isPushSupported: () => push.isPushSupported(),
    requestPermission: () => push.requestPermission(),
    addPermissionObserver: (observer) => push.permissionObservers.add(observer),
    removePermissionObserver: (observer) => {
      push.permissionObservers.remove(observer);
    },
    setDefaultUrl: (url) => push.setDefaultUrl(url),
    setDefaultTitle: (title) => push.setDefaultTitle(title),
    clearAll: () => push.clearAll(),
    remove: (tag) => push.remove(tag),
  };
  Object.defineProperties(target, Object.getOwnPropertyDescriptors(members));
  return target as T & NotificationPushApi;
}
