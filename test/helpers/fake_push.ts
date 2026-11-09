import { vi } from "vitest";
import { base64urlToBytes, bytesToBase64url } from "../../src/util/base64url";
import type { PagePushManager, PagePushSubscription } from "../../src/worker/registration";

/** A valid-looking browser key pair (the SDK only passes them on). */
export const P256DH = "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM";
export const AUTH = "tBHItJI5svbpez7KI4CCXg";

/** The active key the push tests put in the bootstrap (12 characters, so it survives a bytes round trip). */
export const ACTIVE_KEY = "BACTIVEKEY00";
/** An earlier key of the app (before a rotation). */
export const OLD_KEY = "BOLDKEY0";
/** A Firebase project's key (v1). */
export const FIREBASE_KEY = "BFIREBASEKEY";

let counter = 0;

export function endpoint(tag = "x"): string {
  counter += 1;
  return `https://fcm.googleapis.com/fcm/send/${tag}-${counter}-abcdefghijklmnopqrstuvwxyz0123456789`;
}

/** A v1 Firebase registration token: no scheme, a colon, at least 100 characters. */
export function firebaseToken(): string {
  return `fbtoken123:APA91b${"F".repeat(120)}`;
}

export class FakePushSubscription implements PagePushSubscription {
  readonly expirationTime = null;
  readonly unsubscribe = vi.fn(async () => {
    if (this.manager.current === this) this.manager.current = null;
    return true;
  });

  constructor(
    public endpoint: string,
    /** base64url key it was made with; null when the browser does not say. */
    public key: string | null,
    private readonly manager: FakePushManager,
  ) {}

  get options(): { applicationServerKey: ArrayBuffer | null } {
    return { applicationServerKey: this.key ? base64urlToBytes(this.key).buffer : null };
  }

  toJSON() {
    return { endpoint: this.endpoint, expirationTime: null, keys: { p256dh: P256DH, auth: AUTH } };
  }
}

export class FakePushManager implements PagePushManager {
  current: FakePushSubscription | null = null;
  /** How many of the next subscribe calls fail. */
  failNext = 0;
  /** Keys whose subscribe always fails. */
  readonly failingKeys = new Set<string>();
  failWith: unknown = Object.assign(new Error("Registration failed - push service error"), { name: "AbortError" });
  /** The key of each subscribe call, in order. */
  readonly keysUsed: string[] = [];

  readonly subscribe = vi.fn(async (options: { userVisibleOnly: boolean; applicationServerKey: BufferSource }) => {
    const key = bytesToBase64url(options.applicationServerKey as ArrayBufferView);
    this.keysUsed.push(key);
    if (this.failNext > 0) {
      this.failNext -= 1;
      throw this.failWith;
    }
    if (this.failingKeys.has(key)) throw this.failWith;
    const sub = new FakePushSubscription(endpoint("new"), key, this);
    this.current = sub;
    return sub;
  });

  readonly getSubscription = vi.fn(async () => this.current);

  /** Gives the browser an existing subscription. */
  have(endpointUrl: string, key: string | null): FakePushSubscription {
    const sub = new FakePushSubscription(endpointUrl, key, this);
    this.current = sub;
    return sub;
  }
}
