import type { V1State } from "./types";

export const LOCAL_KEY = {
  prompts: "openpush.prompts",
  session: "openpush.session",
  debug: "openpush.debug",
  /** Written by the v1 SDK; read for the move, never written by v2, removed once moved. */
  v1: "openpush.web.v1",
} as const;

type WritableKey = Exclude<(typeof LOCAL_KEY)[keyof typeof LOCAL_KEY], typeof LOCAL_KEY.v1>;

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * localStorage access. Every call is guarded (storage can be missing or throw in private
 * windows), and writes are skipped while `writable()` is false (consent).
 */
export class LocalStore {
  constructor(
    private readonly storage: StorageLike | undefined,
    private readonly writable: () => boolean,
  ) {}

  getString(key: string): string | undefined {
    try {
      return this.storage?.getItem(key) ?? undefined;
    } catch {
      return undefined;
    }
  }

  getJson<T>(key: string): T | undefined {
    const raw = this.getString(key);
    if (raw === undefined) return undefined;
    try {
      return JSON.parse(raw) as T;
    } catch {
      return undefined;
    }
  }

  /** Returns false when the value was not written (no consent, no storage, quota). */
  setString(key: WritableKey, value: string): boolean {
    if (!this.writable() || !this.storage) return false;
    try {
      this.storage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  }

  setJson(key: WritableKey, value: unknown): boolean {
    return this.setString(key, JSON.stringify(value));
  }

  remove(key: WritableKey): void {
    if (!this.writable() || !this.storage) return;
    try {
      this.storage.removeItem(key);
    } catch {
      // Ignore.
    }
  }

  /** Removes v1's state once the browser has moved off Firebase (kept until then). */
  removeV1(): void {
    if (!this.writable() || !this.storage) return;
    try {
      this.storage.removeItem(LOCAL_KEY.v1);
    } catch {
      // Ignore.
    }
  }

  readV1(): V1State | undefined {
    const value = this.getJson<unknown>(LOCAL_KEY.v1);
    if (!value || typeof value !== "object") return undefined;
    const v = value as Record<string, unknown>;
    const out: V1State = {};
    if (typeof v.token === "string" && v.token) out.token = v.token;
    if (typeof v.subscriptionId === "string" && v.subscriptionId) out.subscriptionId = v.subscriptionId;
    if (typeof v.externalId === "string" && v.externalId) out.externalId = v.externalId;
    return out;
  }
}
