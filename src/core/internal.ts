/**
 * A small, non-public door into one page's SDK runtime for OpenPush's own layers that are built as
 * separate files (the compatibility layer, the framework wrappers). It is a non-enumerable property
 * under a registered symbol, so it is not part of the public API surface and a layer loaded from
 * another file finds it without importing the core.
 */
import type { Logger } from "../log/logger";

export const INTERNAL = Symbol.for("openpush.internal");

export interface InternalApi {
  /** The page SDK's logger: levels, redaction and log listeners apply to a layer's lines too. */
  readonly log: Logger;
  /** The `initialize` promise, once `initialize` was called. */
  initialized(): Promise<void> | undefined;
  /** `sdk_wrapper` sent with registrations, for example "react/1.1.0". */
  setSdkWrapper(value: string): void;
  /** Calls `listener` just before the SDK asks the browser for permission; returns a remover. */
  onPermissionPrompt(listener: () => void): () => void;
}

export function attachInternal(api: object, internal: InternalApi): void {
  Object.defineProperty(api, INTERNAL, { value: internal, enumerable: false, configurable: false, writable: false });
}

export function internalOf(api: unknown): InternalApi | undefined {
  if (!api || (typeof api !== "object" && typeof api !== "function")) return undefined;
  const internal = (api as Record<symbol, unknown>)[INTERNAL];
  return internal && typeof internal === "object" ? (internal as InternalApi) : undefined;
}
