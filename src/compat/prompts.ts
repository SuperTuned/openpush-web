/**
 * Prompt option shapes of the reference: `notifyButton` → a bell, `promptOptions.slidedown`
 * → a slide-in (with topics) and an email or phone prompt, `promptOptions.customlink` → a placed
 * button. The output is OpenPush prompt definitions; the prompt UI validates them again.
 */
import type { PromptOption } from "../core/options";

type Obj = Record<string, unknown>;

/** Where the placed button renders: `[data-openpush-button=""]` and the reference's container. */
export const LINK_PLACEMENT = "";

/**
 * The consent line the email or phone prompt shows when the site set none. The phone
 * version says how to stop, as the Messaging consent check requires.
 */
export const DEFAULT_CONSENT = {
  email: "By signing up you agree to get messages from this site. You can stop at any time.",
  phone: "By signing up you agree to get messages from this site. You can stop at any time. Reply STOP to stop texts.",
} as const;

/** The bell's default colours swapped, for the reference's `theme: "inverse"`. */
const INVERSE = { main: "#F7F5F1", accent: "#0A0A0A" } as const;

/** Reference bell `text` keys → OpenPush bell wording keys. */
const BELL_TEXT: ReadonlyArray<readonly [string, string]> = [
  ["tip.state.unsubscribed", "tip_not_subscribed"],
  ["tip.state.subscribed", "tip_subscribed"],
  ["tip.state.blocked", "tip_blocked"],
  ["message.action.subscribed", "after_subscribe"],
  ["message.action.resubscribed", "after_subscribe"],
  ["message.action.unsubscribed", "after_unsubscribe"],
  ["dialog.main.title", "dialog_title"],
  ["dialog.main.button.subscribe", "subscribe"],
  ["dialog.main.button.unsubscribe", "unsubscribe"],
  ["dialog.blocked.title", "blocked_title"],
  ["dialog.blocked.message", "blocked_help"],
  ["launcher.button.aria-label", "aria_label"],
];

export interface PromptMapping {
  prompts: PromptOption[];
  /** Accepted and not supported (logged once, at info). */
  unsupported: string[];
  /** The email or phone prompt got the default consent line. */
  defaultConsent: boolean;
  /** The bell's `displayPredicate`, evaluated once before `initialize`. */
  displayPredicate?: () => unknown;
  /** A placed button exists, so the reference's containers are marked too. */
  placedButton: boolean;
}

export function obj(value: unknown): Obj | undefined {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Obj) : undefined;
}

function text(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

/** "15px", "15" or 15 → 15. */
function px(value: unknown): number | undefined {
  const n = typeof value === "number" ? value : typeof value === "string" ? parseFloat(value) : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Copies the defined string values of `source[from]` to `to` keys. */
function wording(source: Obj | undefined, pairs: ReadonlyArray<readonly [string, string]>): Record<string, string> {
  const out: Record<string, string> = {};
  if (!source) return out;
  for (const [from, to] of pairs) {
    const value = text(source[from]);
    if (value !== undefined && out[to] === undefined) out[to] = value;
  }
  return out;
}

function defined(entries: Obj): Obj {
  const out: Obj = {};
  for (const [key, value] of Object.entries(entries)) if (value !== undefined) out[key] = value;
  return out;
}

function timing(entry: Obj): Obj {
  const delay = obj(entry.delay) ?? {};
  return defined({ auto: entry.autoPrompt === true, page_views: px(delay.pageViews), seconds: px(delay.timeDelay) });
}

function bell(button: Obj, unsupported: string[]): { prompt?: PromptOption; predicate?: () => unknown } {
  for (const key of ["prenotify", "showCredit"]) if (button[key] !== undefined) unsupported.push(`notifyButton.${key}`);
  if (button.enable !== true) return {};
  const position = text(button.position);
  const offset = obj(button.offset) ?? {};
  const colors = obj(button.colors) ?? {};
  const theme = button.theme === "inverse" ? INVERSE : undefined;
  const prompt = defined({
    id: "bell",
    type: "bell",
    enabled: true,
    size: text(button.size),
    position,
    offset: defined({ bottom: px(offset.bottom), side: px(position === "bottom-left" ? offset.left : offset.right) }),
    colors: defined({
      main: text(colors["circle.background"]) ?? theme?.main,
      accent: text(colors["circle.foreground"]) ?? theme?.accent,
    }),
    wording: wording(obj(button.text), BELL_TEXT),
  });
  const predicate = typeof button.displayPredicate === "function" ? (button.displayPredicate as () => unknown) : undefined;
  return predicate ? { prompt, predicate } : { prompt };
}

function slideIn(push: Obj | undefined, category: Obj | undefined): PromptOption | undefined {
  if (!push && !category) return undefined;
  const words = (entry: Obj | undefined): Record<string, string> =>
    wording(obj(entry?.text), [
      ["actionMessage", "message"],
      ["acceptButton", "allow"],
      ["cancelButton", "later"],
      ["updateMessage", "update_message"],
      ["positiveUpdateButton", "save"],
      ["negativeUpdateButton", "cancel"],
    ]);
  const prompt: Obj = { id: "slide_in", type: "slide_in", enabled: true, timing: timing(category ?? push ?? {}) };
  prompt.wording = { ...words(push), ...words(category) };
  if (category) {
    const items = (Array.isArray(category.categories) ? category.categories : [])
      .map((c) => obj(c))
      .filter((c): c is Obj => !!c)
      .slice(0, 10)
      .map((c) => ({ tag: text(c.tag) ?? "", label: text(c.label) ?? "" }));
    prompt.topics = { enabled: true, items };
  }
  return prompt;
}

function emailPhone(entries: Obj[]): PromptOption | undefined {
  const first = entries[0];
  if (!first) return undefined;
  let email = false;
  let phone = false;
  for (const entry of entries) {
    if (entry.type === "email" || entry.type === "smsAndEmail") email = true;
    if (entry.type === "sms" || entry.type === "smsAndEmail") phone = true;
  }
  const fields = email && phone ? "both" : phone ? "phone" : "email";
  return {
    id: "email_phone",
    type: "email_phone",
    enabled: true,
    fields,
    timing: timing(first),
    consent: phone ? DEFAULT_CONSENT.phone : DEFAULT_CONSENT.email,
    wording: wording(obj(first.text), [
      ["actionMessage", "message"],
      ["emailLabel", "email_label"],
      ["smsLabel", "phone_label"],
      ["acceptButton", "submit"],
      ["cancelButton", "later"],
      ["confirmMessage", "confirm"],
    ]),
  };
}

function placedButton(link: Obj): PromptOption | undefined {
  if (link.enabled !== true) return undefined;
  const color = obj(link.color) ?? {};
  return defined({
    id: "button",
    type: "button",
    enabled: true,
    placement: LINK_PLACEMENT,
    style: text(link.style),
    size: text(link.size),
    colors: defined({ background: text(color.button), text: text(color.text) }),
    allow_unsubscribe: link.unsubscribeEnabled === true,
    wording: wording(obj(link.text), [
      ["subscribe", "subscribe"],
      ["unsubscribe", "unsubscribe"],
      ["explanation", "explanation"],
    ]),
  });
}

/** Maps `notifyButton` and `promptOptions`. */
export function mapPrompts(notifyButton: unknown, promptOptions: unknown): PromptMapping {
  const out: PromptMapping = { prompts: [], unsupported: [], defaultConsent: false, placedButton: false };
  const button = obj(notifyButton);
  if (button) {
    const mapped = bell(button, out.unsupported);
    if (mapped.prompt) out.prompts.push(mapped.prompt);
    if (mapped.predicate) out.displayPredicate = mapped.predicate;
  }
  const options = obj(promptOptions) ?? {};
  const slidedown = obj(options.slidedown);
  const list = slidedown?.prompts;
  const entries = (Array.isArray(list) ? list : []).map((p) => obj(p)).filter((p): p is Obj => !!p);
  const slide = slideIn(
    entries.find((e) => e.type === "push"),
    entries.find((e) => e.type === "category"),
  );
  if (slide) out.prompts.push(slide);
  const contact = emailPhone(entries.filter((e) => e.type === "email" || e.type === "sms" || e.type === "smsAndEmail"));
  if (contact) {
    out.prompts.push(contact);
    out.defaultConsent = true;
  }
  const link = obj(options.customlink);
  const placed = link ? placedButton(link) : undefined;
  if (placed) {
    out.prompts.push(placed);
    out.placedButton = true;
  }
  return out;
}
