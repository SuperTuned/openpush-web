/** Small value checks shared by the page SDK and the worker. */

/** A plain object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The value when it is an https URL; null otherwise. */
export function httpsUrl(value: unknown): string | null {
  if (typeof value !== "string" || value === "") return null;
  try {
    return new URL(value).protocol === "https:" ? value : null;
  } catch {
    return null;
  }
}

/** An error for a log line: its message (with its name when `withName`). */
export function errorText(error: unknown, withName = false): string {
  if (!(error instanceof Error)) return String(error);
  return withName ? `${error.name}: ${error.message}` : error.message;
}
