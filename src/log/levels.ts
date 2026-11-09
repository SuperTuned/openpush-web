export type LogLevel = "none" | "error" | "warn" | "info" | "debug" | "trace";

/** A level a line can be written at (everything but "none"). */
export type LineLevel = Exclude<LogLevel, "none">;

export const LOG_LEVELS: readonly LogLevel[] = ["none", "error", "warn", "info", "debug", "trace"];

const RANK: Record<LogLevel, number> = { none: 0, error: 1, warn: 2, info: 3, debug: 4, trace: 5 };

export const DEFAULT_LOG_LEVEL: LogLevel = "warn";

export function isLogLevel(value: unknown): value is LogLevel {
  return typeof value === "string" && (LOG_LEVELS as readonly string[]).includes(value);
}

/** True when a line at `line` is written while the logger is at `current`. */
export function allows(current: LogLevel, line: LineLevel): boolean {
  return RANK[line] <= RANK[current];
}

/** `?openpush_debug=trace` in the page URL: a level for this page only, never persisted. */
export function levelFromQuery(search: string | undefined): LogLevel | undefined {
  if (!search) return undefined;
  try {
    const value = new URLSearchParams(search).get("openpush_debug");
    return isLogLevel(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
