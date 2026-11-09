/**
 * Permission and subscription states: the status table, the state the observers see, and
 * the observer registries.
 */
import type { Logger } from "../log/logger";
import type { PermissionValue } from "../platform/types";

export type PushStatus = "unsupported" | "not_asked" | "denied" | "pending" | "subscribed" | "opted_out";

/** `PushSubscription.snapshot()`. */
export interface PushSubscriptionState {
  id: string | null;
  token: string | null;
  optedIn: boolean;
  status: PushStatus;
}

export interface PushSubscriptionChange {
  previous: PushSubscriptionState;
  current: PushSubscriptionState;
}

export type PushSubscriptionObserver = (change: PushSubscriptionChange) => void;

/** `Notifications.addPermissionObserver` payload. */
export interface PermissionChange {
  permission: boolean;
  status: PermissionValue;
}

export type PermissionObserver = (change: PermissionChange) => void;

export interface StatusInputs {
  supported: boolean;
  permission: PermissionValue | undefined;
  /** The browser has a push subscription for this site (or a v1 row that has not moved yet). */
  hasSubscription: boolean;
  /** A subscription is being created now. */
  pending: boolean;
  optedOut: boolean;
}

/**
 * The push status from permission and subscription state. Two further cases: permission granted
 * with no subscription and nothing being created is `pending` (the next page load subscribes it),
 * unless the person opted out, which is `opted_out`.
 */
export function pushStatus(input: StatusInputs): PushStatus {
  if (!input.supported || input.permission === undefined) return "unsupported";
  if (input.permission === "default") return "not_asked";
  if (input.permission === "denied") return "denied";
  if (input.optedOut) return "opted_out";
  if (input.pending || !input.hasSubscription) return "pending";
  return "subscribed";
}

/** `optedIn`: permission granted, a browser subscription, and no opt-out. */
export function isOptedIn(input: StatusInputs): boolean {
  return input.supported && input.permission === "granted" && input.hasSubscription && !input.optedOut;
}

export function sameState(a: PushSubscriptionState, b: PushSubscriptionState): boolean {
  return a.id === b.id && a.token === b.token && a.optedIn === b.optedIn && a.status === b.status;
}

/** A set of listeners that each run on their own; a listener's error is the site's and is logged. */
export class ListenerSet<T> {
  private readonly listeners = new Set<(value: T) => void>();

  constructor(
    private readonly log: Logger,
    private readonly name: string,
  ) {}

  add(listener: (value: T) => void): void {
    if (typeof listener === "function") this.listeners.add(listener);
  }

  remove(listener: (value: T) => void): boolean {
    return this.listeners.delete(listener);
  }

  emit(value: T): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(value);
      } catch (error) {
        this.log.error(`A ${this.name} observer threw: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  }
}
