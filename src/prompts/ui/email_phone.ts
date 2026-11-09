/**
 * The email or phone prompt. The consent line sits under the inputs and is
 * sent with the address; the server answers `accepted` for every address, so any 2xx is success.
 * Email: `User.addEmail(address, consent)` on submit. Phone: a phone code through `Verify.start`;
 * once it is sent, `User.addSms(number, consent)` at once (the server marks a number proved only
 * when its row exists at approval), then the code field and `Verify.check`. The number stays
 * unverified until the code is approved.
 *
 * Never message unsubscribed people, and never say what the server knew: an address that is
 * suppressed or opted out, or a number that replied STOP (409 `opted_out`), gets the same confirm
 * text as a new one.
 */
import type { Logger } from "../../log/logger";
import type { ChannelConsent } from "../../user/channels";
import { emailAddress, phoneNumber } from "../../user/validate";
import type { Verification, VerifyApi } from "../../verify/verify";
import type { EmailPhoneStrings } from "../i18n/strings";
import type { Card } from "./card";
import { button, el, uid } from "./dom";

export interface EmailPhoneDeps {
  card: Card;
  text: EmailPhoneStrings;
  /** The fields to show, already narrowed to the app's channels. */
  fields: readonly ("email" | "phone")[];
  consent: ChannelConsent;
  language: string;
  log: Logger;
  verify: VerifyApi;
  addEmail(address: string, consent: ChannelConsent): boolean;
  addSms(number: string, consent: ChannelConsent): boolean;
  /** First submit (`accepted`). */
  accepted(): void;
  /** Not now or Escape (`dismissed`). */
  later(): void;
  /** Close after the confirm text. */
  done(): void;
}

interface Field {
  input: HTMLInputElement;
  node: HTMLElement;
}

function field(doc: Document, label: string, type: "email" | "tel" | "text", autocomplete: string): Field {
  const node = el(doc, "div", "field");
  const id = uid("f");
  const lbl = el(doc, "label", "lbl", label);
  lbl.htmlFor = id;
  const input = el(doc, "input", "inp");
  input.id = id;
  input.type = type;
  input.setAttribute("autocomplete", autocomplete);
  if (type === "tel") input.inputMode = "tel";
  if (autocomplete === "one-time-code") input.inputMode = "numeric";
  node.appendChild(lbl);
  node.appendChild(input);
  return { input, node };
}

/**
 * The parts of an SDK error. Read by shape, not `instanceof`: the error comes from `openpush.js`,
 * a different file with its own copy of the class.
 */
function errorInfo(error: unknown): { code?: unknown; status?: unknown; reason?: unknown } {
  if (!error || typeof error !== "object") return {};
  const e = error as { code?: unknown; detail?: { status?: unknown; reason?: unknown } };
  return { code: e.code, status: e.detail?.status, reason: e.detail?.reason };
}

/** What a refused phone code means for the person: the neutral confirm, a bad number, or a retry. */
export function verifyRefusal(error: unknown): "confirm" | "invalid_phone" | "error" {
  const { code, status, reason } = errorInfo(error);
  if (reason === "opted_out" || status === 409) return "confirm";
  if (code === "invalid_argument" && (status === undefined || status === 400 || status === 422)) return "invalid_phone";
  return "error";
}

export class EmailPhoneFlow {
  private readonly error: HTMLParagraphElement;
  private email: Field | undefined;
  private phone: Field | undefined;
  private submitted = false;
  private busy = false;
  private pending: { verification: Verification; number: string } | undefined;

  constructor(private readonly deps: EmailPhoneDeps) {
    this.error = el(deps.card.doc, "p", "err");
    this.error.setAttribute("role", "alert");
    this.showForm();
  }

  private showForm(): void {
    const { card, text, fields } = this.deps;
    const doc = card.doc;
    card.setMessage(text.message);
    const nodes: HTMLElement[] = [];
    if (fields.includes("email")) {
      this.email = field(doc, text.email_label, "email", "email");
      nodes.push(this.email.node);
    }
    if (fields.includes("phone")) {
      this.phone = field(doc, text.phone_label, "tel", "tel");
      this.phone.input.placeholder = "+";
      nodes.push(this.phone.node);
    }
    for (const f of [this.email, this.phone]) f?.input.addEventListener("keydown", (e) => this.enter(e, () => void this.submit()));
    card.setContent(...nodes, el(doc, "p", "small", this.deps.consent.text), this.error);
    card.setActions(button(doc, "btn", text.later, () => this.deps.later()), button(doc, "btn pri", text.submit, () => void this.submit()));
  }

  private showCode(): void {
    const { card, text } = this.deps;
    const doc = card.doc;
    const code = field(doc, text.code_label, "text", "one-time-code");
    code.input.addEventListener("keydown", (e) => this.enter(e, () => void this.check(code.input)));
    this.setError("");
    card.setContent(code.node, this.error);
    card.setActions(button(doc, "btn", text.later, () => this.deps.later()), button(doc, "btn pri", text.code_submit, () => void this.check(code.input)));
    code.input.focus();
  }

  private showConfirm(): void {
    const { card, text } = this.deps;
    card.setMessage(text.confirm);
    card.setContent();
    const close = button(card.doc, "btn pri", text.close, () => this.deps.done());
    card.setActions(close);
    close.focus();
  }

  private enter(event: Event, run: () => void): void {
    if ((event as KeyboardEvent).key === "Enter") {
      event.preventDefault();
      run();
    }
  }

  private setError(message: string): void {
    this.error.textContent = message;
  }

  private setBusy(busy: boolean): void {
    this.busy = busy;
    for (const b of this.deps.card.actions.querySelectorAll("button")) b.disabled = busy;
  }

  private async submit(): Promise<void> {
    if (this.busy) return;
    const { text } = this.deps;
    const rawEmail = this.email?.input.value.trim() ?? "";
    const rawPhone = this.phone?.input.value.trim() ?? "";
    const email = rawEmail ? emailAddress(rawEmail) : undefined;
    const number = rawPhone ? phoneNumber(rawPhone) : undefined;
    if (rawEmail && !email) return this.setError(text.invalid_email);
    if (rawPhone && !number) return this.setError(text.invalid_phone);
    if (!email && !number) return this.setError(this.email ? text.invalid_email : text.invalid_phone);
    this.setError("");
    if (!this.submitted) {
      this.submitted = true;
      this.deps.accepted();
    }
    if (email && !this.deps.addEmail(email, this.deps.consent)) return this.setError(text.invalid_email);
    if (!number) return this.showConfirm();
    this.setBusy(true);
    try {
      const verification = await this.deps.verify.start(number, "sms", this.deps.language);
      this.pending = { verification, number };
      // The row must exist before the code is approved; it stays unverified until then.
      this.deps.addSms(number, this.deps.consent);
      this.showCode();
    } catch (error) {
      const outcome = verifyRefusal(error);
      this.deps.log.debug(`The phone code was not sent: ${error instanceof Error ? error.message : String(error)}`);
      if (outcome === "confirm") this.showConfirm();
      else this.setError(outcome === "invalid_phone" ? text.invalid_phone : text.error);
    } finally {
      this.setBusy(false);
    }
  }

  private async check(input: HTMLInputElement): Promise<void> {
    const pending = this.pending;
    if (this.busy || !pending) return;
    const { text } = this.deps;
    const code = input.value.replace(/\s/g, "");
    if (!/^\d{3,10}$/.test(code)) return this.setError(text.code_wrong);
    this.setBusy(true);
    try {
      const result = await this.deps.verify.check(pending.verification, code);
      if (result.status === "approved") {
        this.showConfirm();
      } else {
        this.setError(result.status === "pending" ? text.code_wrong : text.error);
      }
    } catch (error) {
      this.deps.log.debug(`The phone code was not checked: ${error instanceof Error ? error.message : String(error)}`);
      const outcome = verifyRefusal(error);
      if (outcome === "confirm") this.showConfirm();
      else this.setError(errorInfo(error).code === "invalid_argument" ? text.code_wrong : text.error);
    } finally {
      this.setBusy(false);
    }
  }
}
