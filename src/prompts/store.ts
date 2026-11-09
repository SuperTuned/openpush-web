/**
 * localStorage `openpush.prompts`: page views of the site, and per prompt type the
 * dismiss count, the time it may show again, and when it was accepted. Clearing site data resets
 * it. Writes follow consent (`LocalStore`); while they cannot be written the values live for this
 * page only.
 */
import { LOCAL_KEY, type LocalStore } from "../storage/local";

/** Cooldown after the 1st, 2nd, and 3rd and later dismiss. */
export const COOLDOWN_DAYS = [3, 7, 30] as const;
export const DAY_MS = 86_400_000;
/**
 * How long a private-window mark stops prompts. Private windows drop localStorage when they close,
 * so the mark lasts for that window's session; the time limit only guards a false mark.
 */
export const PRIVATE_MARK_MS = 12 * 3_600_000;

interface TypeRecord {
  /** Dismiss count. */
  n?: number;
  /** May show again from this time (ms). */
  next?: number;
  /** Accepted at (ms). */
  ok?: number;
}

interface StoreRecord {
  views?: number;
  t?: Record<string, TypeRecord>;
  /** Marked as a private window at (ms). */
  pm?: number;
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && value >= 0 ? value : undefined;
}

export class PromptStore {
  /** The last record written, kept when localStorage refused it. */
  private memory: StoreRecord | undefined;
  private stored = true;

  constructor(private readonly local: LocalStore) {}

  get views(): number {
    return num(this.read().views) ?? 0;
  }

  /** Counts this page load (every page load of the site). Returns the new count. */
  countView(): number {
    const r = this.read();
    r.views = (num(r.views) ?? 0) + 1;
    this.write(r);
    return r.views;
  }

  /** The type is in its cooldown after a dismiss. */
  coolingDown(type: string, now: number): boolean {
    const next = num(this.read().t?.[type]?.next);
    return next !== undefined && next > now;
  }

  /** A dismiss ("Later", close, or Allow followed by a dismissed browser prompt): 3, 7, then 30 days. */
  dismissed(type: string, now: number): void {
    const r = this.read();
    const rec = this.type(r, type);
    const n = (num(rec.n) ?? 0) + 1;
    rec.n = n;
    rec.next = now + COOLDOWN_DAYS[Math.min(n, COOLDOWN_DAYS.length) - 1]! * DAY_MS;
    this.write(r);
  }

  accepted(type: string, now: number): void {
    const r = this.read();
    this.type(r, type).ok = now;
    this.write(r);
  }

  wasAccepted(type: string): boolean {
    return num(this.read().t?.[type]?.ok) !== undefined;
  }

  /** A subscribe failed in what looks like a private window: no push prompt again this session. */
  markPrivate(now: number): void {
    const r = this.read();
    r.pm = now;
    this.write(r);
  }

  privateSession(now: number): boolean {
    const pm = num(this.read().pm);
    return pm !== undefined && now - pm < PRIVATE_MARK_MS;
  }

  private type(r: StoreRecord, type: string): TypeRecord {
    const t: Record<string, TypeRecord> = (r.t = isObject(r.t) ? r.t : {});
    const rec = t[type];
    return (t[type] = isObject(rec) ? rec : {});
  }

  private read(): StoreRecord {
    if (!this.stored && this.memory) return structuredCopy(this.memory);
    const stored = this.local.getJson<unknown>(LOCAL_KEY.prompts);
    if (isObject(stored)) return stored as StoreRecord;
    return this.memory ? structuredCopy(this.memory) : {};
  }

  private write(r: StoreRecord): void {
    this.memory = structuredCopy(r);
    this.stored = this.local.setJson(LOCAL_KEY.prompts, r);
  }
}

function isObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function structuredCopy(r: StoreRecord): StoreRecord {
  return JSON.parse(JSON.stringify(r)) as StoreRecord;
}
