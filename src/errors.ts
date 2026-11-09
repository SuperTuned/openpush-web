/** The error codes `OpenPushError.code` can take. */
export type OpenPushErrorCode =
  | "not_initialized"
  | "invalid_argument"
  | "not_supported"
  | "insecure_origin"
  | "wrong_origin"
  | "web_push_off"
  | "consent_required"
  | "permission_denied"
  | "permission_dismissed"
  | "worker_registration_failed"
  | "worker_scope_taken"
  | "config_unavailable"
  | "rate_limited"
  | "network"
  | "identity_rejected";

export const ERROR_CODES: readonly OpenPushErrorCode[] = [
  "not_initialized",
  "invalid_argument",
  "not_supported",
  "insecure_origin",
  "wrong_origin",
  "web_push_off",
  "consent_required",
  "permission_denied",
  "permission_dismissed",
  "worker_registration_failed",
  "worker_scope_taken",
  "config_unavailable",
  "rate_limited",
  "network",
  "identity_rejected",
];

export type ErrorDetail = Record<string, unknown>;

/** Every rejection and throw from the SDK is an OpenPushError. */
export class OpenPushError extends Error {
  readonly code: OpenPushErrorCode;
  readonly detail?: ErrorDetail;

  constructor(code: OpenPushErrorCode, message: string, detail?: ErrorDetail) {
    super(message);
    this.name = "OpenPushError";
    this.code = code;
    if (detail !== undefined) this.detail = detail;
  }
}

export function isOpenPushError(value: unknown): value is OpenPushError {
  return value instanceof OpenPushError;
}
