import type { LogLevel } from "../log/levels";
import type { Bootstrap } from "../core/bootstrap";

export type WorkerState = "ok" | "missing" | "error" | "taken";

export interface ClickBehavior {
  match: "exact" | "origin";
  action: "navigate" | "focus";
}

export interface Webhooks {
  displayed: string | null;
  clicked: string | null;
  dismissed: string | null;
  cors: boolean;
}

/** The cached config bootstrap. */
export interface CachedBootstrap {
  app: string;
  etag: string | null;
  body: Bootstrap;
  fetchedAt: number;
}

/**
 * IndexedDB `cfg` row, shared by page and worker. A row written by v1 also has `sdk`,
 * `firebase` and `token` (the Firebase token); those fields are kept on upgrade.
 */
export interface CfgRow {
  app?: string;
  sdkKey?: string;
  server?: string;
  publicKey?: string;
  keyId?: string;
  /** Push endpoint (v2) or the Firebase token (a v1 row not yet moved). */
  token?: string;
  subscriptionId?: string;
  deviceSecret?: string;
  click?: ClickBehavior;
  webhooks?: Webhooks;
  keepOnScreen?: boolean;
  logLevel?: LogLevel;
  defaultUrl?: string;
  defaultTitle?: string;
  siteName?: string;
  siteIcon?: string | null;
  workerPath?: string;
  workerScope?: string;
  workerState?: WorkerState;
  bootstrap?: CachedBootstrap;
  /** Worker-owned: the last 50 message ids shown, for the duplicate guard. */
  recent?: RecentPush[];
  /** Worker-owned: window client ids that run the SDK (they posted a config). */
  sdkClients?: string[];
  /** Worker-owned: the last push received or clicked, for unique outcomes. */
  lastPush?: LastPush;
  /** The public key (base64url) the browser's push subscription was made with. */
  subPublicKey?: string;
  /** The key id of `subPublicKey`. */
  subKeyId?: string;
  /** A silent move that has not finished yet; tried again on the next page load. */
  move?: PendingMove;
  [legacy: string]: unknown;
}

/** The proof a silent move sends. Kept until the server accepts the move. */
export interface PendingMove {
  kind: "firebase" | "openpush" | "imported";
  previousToken: string;
  subscriptionId?: string;
}

export interface RecentPush {
  id: string;
  at: number;
}

export interface LastPush {
  messageId: string;
  at: number;
  kind: "received" | "clicked";
}

/** Fields of `cfg` only the worker writes; a config posted by the page never overwrites them. */
export const WORKER_OWNED_CFG = ["recent", "sdkClients", "lastPush"] as const;

/** IndexedDB `state` row. */
export interface StateRow {
  externalId?: string | null;
  tags?: Record<string, string>;
  aliases?: Record<string, string>;
  language?: string;
  optedOut?: boolean;
  lastStatus?: number;
  /** Fingerprint of the last registration the server accepted (register on change). */
  lastSent?: string;
  /** Browser permission at the last look, to find a change made in browser settings. */
  lastPermission?: "default" | "granted" | "denied";
  consent?: { given: boolean; at: number };
  /** The external id was set with an identity hash; the hash itself is never stored. */
  verified?: boolean;
  /** The server once refused an identity without a hash: ask the handler before sending one. */
  ivRequired?: boolean;
  /** Short hash of the identity, tags and aliases the server last accepted. */
  userSent?: string;
  [key: string]: unknown;
}

/** localStorage `openpush.web.v1`, written by the v1 SDK. Read only. */
export interface V1State {
  token?: string;
  subscriptionId?: string;
  externalId?: string;
}
