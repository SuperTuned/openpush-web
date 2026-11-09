/**
 * Argument checks for the user, event and phone-code members. Each throws
 * `invalid_argument` with a short message naming the rule, or returns the clean value.
 */
import { OpenPushError } from "../errors";

const fail = (message: string): never => {
  throw new OpenPushError("invalid_argument", message);
};

/** Tag keys: the server charset `[A-Za-z0-9_-.]`, at most 60 characters. */
const TAG_KEY = /^[A-Za-z0-9_.-]{1,60}$/;
export const MAX_TAG_VALUE = 300;

export function tagKey(key: unknown): string {
  if (typeof key !== "string" || !TAG_KEY.test(key)) {
    fail(`Tag key "${String(key)}" must be 1 to 60 letters, digits, "_", "-" or "."`);
  }
  return key as string;
}

/** A tag value: text, a number or a boolean, at most 300 characters. "" is a removal. */
export function tagValue(key: string, value: unknown): string {
  if (typeof value !== "string" && typeof value !== "number" && typeof value !== "boolean") {
    fail(`Tag "${key}" needs a text, number or true/false value`);
  }
  const text = String(value);
  if (text.length > MAX_TAG_VALUE) fail(`Tag "${key}" is longer than ${MAX_TAG_VALUE} characters`);
  return text;
}

export function record(value: unknown, what: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) fail(`${what} needs an object`);
  return value as Record<string, unknown>;
}

export function nonEmpty(value: unknown, what: string, max = 300): string {
  if (typeof value !== "string" || value.trim() === "" || value.length > max) fail(`${what} must be text of 1 to ${max} characters`);
  return value as string;
}

/** Alias labels: not empty, and never `external_id`, which belongs to login. */
export function aliasLabel(label: unknown): string {
  const clean = nonEmpty(label, "An alias label");
  if (clean === "external_id") fail('"external_id" is set with login, not as an alias');
  return clean;
}

/**
 * An email address as the mobile SDKs clean it: trimmed, lower-cased, at most 254 characters,
 * one "@", a local part, and a dot in the domain.
 */
export function emailAddress(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const clean = value.trim().toLowerCase();
  const parts = clean.split("@");
  const [local, domain] = parts;
  if (clean.length > 254 || parts.length !== 2 || !local || !domain || !domain.includes(".") || /\s/.test(clean)) return undefined;
  return clean;
}

/**
 * A phone number in E.164 as the server's normaliser makes it: everything but digits and "+"
 * removed, a leading "00" becomes "+", then "+" and 8 to 15 digits, the first not 0.
 */
export function phoneNumber(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  let clean = value.replace(/[^\d+]/g, "");
  if (clean.startsWith("00")) clean = `+${clean.slice(2)}`;
  return /^\+[1-9]\d{7,14}$/.test(clean) ? clean : undefined;
}

/** A BCP-47 language tag, for example "fr" or "pt-BR". */
export function languageTag(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/.test(value)) {
    fail(`"${String(value)}" is not a language code such as "fr" or "pt-BR"`);
  }
  return value as string;
}

/** Event names: the server rule `^[a-zA-Z0-9_\-. ]+$`, at most 128 characters. */
export function eventName(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9_. -]{1,128}$/.test(value)) {
    fail(`Event name "${String(value)}" must be 1 to 128 letters, digits, spaces, "_", "-" or "."`);
  }
  return value as string;
}
