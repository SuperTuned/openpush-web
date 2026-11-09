import { allows, DEFAULT_LOG_LEVEL, type LineLevel, type LogLevel } from "./levels";
import { scrub } from "./redact";

export const LOG_PREFIX = "[OpenPush]";

export interface LogEntry {
  level: LineLevel;
  message: string;
  at: number;
}

export type LogListener = (entry: LogEntry) => void;

/** Where lines go; the browser console in production. */
export interface LogSink {
  error(...args: unknown[]): void;
  warn(...args: unknown[]): void;
  info(...args: unknown[]): void;
  debug(...args: unknown[]): void;
}

/**
 * Short, prefixed, redacted log lines. Listeners receive the same lines the console gets.
 */
export class Logger {
  private current: LogLevel;
  private readonly listeners = new Set<LogListener>();
  private readonly secrets = new Set<string>();
  private readonly onceKeys = new Set<string>();

  constructor(
    private readonly sink: LogSink | undefined,
    private readonly now: () => number,
    level: LogLevel = DEFAULT_LOG_LEVEL,
  ) {
    this.current = level;
  }

  get level(): LogLevel {
    return this.current;
  }

  setLevel(level: LogLevel): void {
    this.current = level;
  }

  enabled(level: LineLevel): boolean {
    return allows(this.current, level);
  }

  /** Values that must never appear in a line (SDK key, device secret, push keys). */
  addSecret(value: string | undefined | null): void {
    if (value) this.secrets.add(value);
  }

  addListener(listener: LogListener): void {
    this.listeners.add(listener);
  }

  removeListener(listener: LogListener): void {
    this.listeners.delete(listener);
  }

  error(message: string): void {
    this.write("error", message);
  }

  warn(message: string): void {
    this.write("warn", message);
  }

  info(message: string): void {
    this.write("info", message);
  }

  debug(message: string): void {
    this.write("debug", message);
  }

  trace(message: string): void {
    this.write("trace", message);
  }

  /** Writes a line at most once per page for `key`. */
  once(key: string, level: LineLevel, message: string): void {
    if (this.onceKeys.has(key)) return;
    this.onceKeys.add(key);
    this.write(level, message);
  }

  private write(level: LineLevel, message: string): void {
    if (!this.enabled(level)) return;
    const line = scrub(message, this.secrets);
    const entry: LogEntry = { level, message: line, at: this.now() };
    if (this.sink) {
      const method = level === "trace" ? "debug" : level;
      try {
        this.sink[method](`${LOG_PREFIX} ${line}`);
      } catch {
        // A broken console must not break the SDK.
      }
    }
    for (const listener of this.listeners) {
      try {
        listener(entry);
      } catch {
        // Listener errors are the site's own; never rethrow into the SDK.
      }
    }
  }
}
