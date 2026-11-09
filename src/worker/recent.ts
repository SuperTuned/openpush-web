/** Duplicate guard: the last 50 message ids, each for 24 hours. */
import type { RecentPush } from "../storage/types";

export const RECENT_MAX = 50;
export const RECENT_TTL_MS = 24 * 60 * 60 * 1000;

export function seenRecently(recent: readonly RecentPush[] | undefined, id: string, now: number): boolean {
  return (recent ?? []).some((r) => r.id === id && now - r.at < RECENT_TTL_MS && r.at <= now);
}

/** The list with `id` added at the end, entries older than 24 hours dropped, at most 50 kept. */
export function remember(recent: readonly RecentPush[] | undefined, id: string, now: number): RecentPush[] {
  const kept = (recent ?? []).filter((r) => r && typeof r.id === "string" && r.id !== id && now - r.at < RECENT_TTL_MS);
  kept.push({ id, at: now });
  return kept.slice(-RECENT_MAX);
}
