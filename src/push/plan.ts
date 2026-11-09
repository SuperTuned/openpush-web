/**
 * Page-load reconciliation, auto resubscribe and the silent move, as a pure
 * decision. The controller gathers the inputs, asks `planReconcile`, and carries the plan out.
 */
import type { PermissionValue } from "../platform/types";
import type { CfgRow, PendingMove, V1State } from "../storage/types";

/** A Firebase registration token (v1): no scheme, a colon, long. Same test as the server's. */
export function looksLikeFirebaseToken(token: string | undefined): token is string {
  return !!token && !token.includes("://") && token.includes(":") && token.length >= 100;
}

/** A push endpoint (direct web push or an imported row). */
export function isEndpoint(token: string | undefined): token is string {
  return !!token && /^https:\/\//i.test(token);
}

export interface BrowserSubscriptionInfo {
  endpoint: string;
  /** Made with the app's active key; undefined when the browser does not say. */
  activeKey: boolean | undefined;
}

export interface ReconcileInputs {
  appId: string;
  permission: PermissionValue | undefined;
  /** `pushManager.getSubscription()`; null when there is none. */
  subscription: BrowserSubscriptionInfo | null;
  cfg: CfgRow;
  /** The `cfg` row before this page load (the other-app check). */
  previousCfg: CfgRow | undefined;
  v1: V1State | undefined;
  optedOut: boolean;
  lastStatus: number | undefined;
  autoResubscribe: boolean;
  /** `direct.new_registrations`; false after a rollback. */
  newRegistrations: boolean;
  /** `move.from_firebase`. */
  fromFirebase: boolean;
}

export type ReconcilePlan =
  | { kind: "nothing"; reason: string }
  /** Permission is gone and the row was subscribed: `{token, status: 0}`. */
  | { kind: "permission_lost"; token: string }
  /** The browser's subscription is current: register when something changed. */
  | { kind: "update"; move: PendingMove | undefined }
  /**
   * Subscribe with the active key (after unsubscribing a subscription made with another key),
   * then register with the move's proof, or as a new row when `move` is undefined.
   */
  | { kind: "subscribe"; move: PendingMove | undefined; unsubscribe: boolean; resubscribe: boolean };

/** This browser's row for this app: an endpoint with a device secret (created or moved by v2). */
export function hasDirectRow(cfg: CfgRow): boolean {
  return !!cfg.subscriptionId && isEndpoint(cfg.token) && !!cfg.deviceSecret;
}

/** `cfg` holds a subscription stored for another app id ("Another app"). */
export function otherAppId(appId: string, previousCfg: CfgRow | undefined): string | undefined {
  const app = previousCfg?.app;
  if (!app || app === appId) return undefined;
  return previousCfg.token || previousCfg.subscriptionId ? app : undefined;
}

/**
 * The earlier push identity this browser can prove, when it has one:
 * - a move already started and not finished (kept from an earlier page load);
 * - v1 Firebase: the stored Firebase token and subscription id (both needed; without the id
 *   there is no move and the browser registers as a new row);
 * - OpenPush: the stored endpoint and the device secret;
 * - imported: the endpoint of a subscription OpenPush did not make (no state of ours).
 */
export function previousIdentity(inputs: ReconcileInputs, subscriptionEndpoint: string | undefined): PendingMove | undefined {
  const { cfg } = inputs;
  if (cfg.move) {
    if (cfg.move.kind === "firebase" && !inputs.fromFirebase) return undefined;
    return cfg.move;
  }
  if (isEndpoint(cfg.token)) return { kind: "openpush", previousToken: cfg.token };
  const firebaseToken = inputs.v1?.token ?? (looksLikeFirebaseToken(cfg.token) ? cfg.token : undefined);
  if (firebaseToken) {
    const subscriptionId = inputs.v1?.subscriptionId ?? cfg.subscriptionId;
    if (!subscriptionId || !inputs.fromFirebase) return undefined;
    return { kind: "firebase", previousToken: firebaseToken, subscriptionId };
  }
  if (subscriptionEndpoint && !cfg.token && !cfg.subscriptionId) {
    return { kind: "imported", previousToken: subscriptionEndpoint };
  }
  return undefined;
}

/** Decides page-load reconciliation, auto resubscribe and the silent move. */
export function planReconcile(inputs: ReconcileInputs): ReconcilePlan {
  const { cfg, permission, subscription } = inputs;
  const otherApp = otherAppId(inputs.appId, inputs.previousCfg) !== undefined;

  if (permission !== "granted") {
    const token = cfg.token;
    const subscribed = inputs.lastStatus === undefined ? !!cfg.subscriptionId : inputs.lastStatus > 0;
    if (!otherApp && token && subscribed) return { kind: "permission_lost", token };
    return { kind: "nothing", reason: permission === "denied" ? "permission denied" : "permission not asked" };
  }

  // Permission is granted. A browser that does not say which key its subscription uses, while
  // this browser still has a Firebase identity, has the Firebase subscription.
  let activeKey = subscription?.activeKey;
  if (subscription && activeKey === undefined && !isEndpoint(cfg.token)) {
    if (looksLikeFirebaseToken(cfg.token) || inputs.v1?.token || cfg.move?.kind === "firebase") activeKey = false;
  }
  if (subscription && activeKey !== false && (!otherApp || activeKey === true)) {
    if (cfg.token === subscription.endpoint || !cfg.token) {
      if (!cfg.subscriptionId && !inputs.newRegistrations) return { kind: "nothing", reason: "new registrations are off" };
      return { kind: "update", move: cfg.move };
    }
    // The endpoint changed (expiry, an earlier visit's unfinished move): the same row, with proof.
    const move = otherApp ? undefined : previousIdentity(inputs, undefined);
    if (!inputs.newRegistrations && !(move?.kind === "openpush" && hasDirectRow(cfg))) {
      return { kind: "nothing", reason: "new registrations are off" };
    }
    return { kind: "update", move };
  }

  // No subscription, or one made with another key: auto resubscribe or a silent move.
  if (inputs.optedOut) return { kind: "nothing", reason: "opted out" };
  // A browser that still has a subscription with another key is moved whatever the setting; a
  // browser with none is subscribed again only with auto resubscribe on.
  if (!subscription && !inputs.autoResubscribe && !cfg.move) return { kind: "nothing", reason: "auto resubscribe is off" };
  const move = otherApp ? undefined : previousIdentity(inputs, subscription?.endpoint);
  if (!inputs.newRegistrations) {
    // Only a browser that lost its subscription keeps its own row current (a token change).
    const tokenChange = !subscription && move?.kind === "openpush" && hasDirectRow(cfg);
    if (!tokenChange) return { kind: "nothing", reason: "new registrations are off" };
  }
  return { kind: "subscribe", move, unsubscribe: !!subscription, resubscribe: !subscription };
}
