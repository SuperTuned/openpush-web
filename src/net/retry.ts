/** Retry schedule for writes: 2 s, 8 s, then every 30 s. */
export const RETRY_DELAYS_MS: readonly number[] = [2_000, 8_000];
export const RETRY_STEADY_MS = 30_000;

/** Delay before retry number `attempt` (1-based). */
export function retryDelay(attempt: number): number {
  return RETRY_DELAYS_MS[attempt - 1] ?? RETRY_STEADY_MS;
}

/** Transport failures, 429 and 5xx are retried; other 4xx are dropped. */
export function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500;
}

/** `Retry-After` as milliseconds from `now`: seconds or an HTTP date. */
export function parseRetryAfter(value: string | null | undefined, now: number): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 1000;
  const at = Date.parse(trimmed);
  if (Number.isNaN(at)) return undefined;
  return Math.max(0, at - now);
}
