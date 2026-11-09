/**
 * The verify bar: the console's Verify step opens the site with
 * `?openpush-verify=<code>`. A small bar at the top asks "Allow notifications to finish setting up
 * {site name}"; its Allow is the gesture for the browser prompt, and the registration that follows
 * carries `verify_code`. The parameter is removed from the address with `history.replaceState`.
 */
import type { VerifyStrings } from "../i18n/strings";
import { VERIFY_PARAM } from "../types";
import { button, closeButton, el, floatingHost, remove, shadow } from "./dom";
import { FLOAT_CSS } from "./style";

/** Verify codes are 10 base32 characters; a little slack for other lengths. */
const CODE = /^[A-Za-z2-7]{6,32}$/;

/** The code from the URL and the URL without it; undefined when there is no parameter. */
export function takeVerifyCode(href: string): { code: string | undefined; cleanUrl: string } | undefined {
  let url: URL;
  try {
    url = new URL(href);
  } catch {
    return undefined;
  }
  if (!url.searchParams.has(VERIFY_PARAM)) return undefined;
  const raw = url.searchParams.get(VERIFY_PARAM) ?? "";
  url.searchParams.delete(VERIFY_PARAM);
  return { code: CODE.test(raw) ? raw : undefined, cleanUrl: url.href };
}

export interface VerifyBarActions {
  /** Allow. Runs inside the click handler (the gesture). */
  allow(): void;
  close(): void;
}

export class VerifyBar {
  private readonly host: HTMLElement;
  private readonly text: HTMLParagraphElement;
  private readonly allowButton: HTMLButtonElement;

  constructor(doc: Document, strings: VerifyStrings, dir: "ltr" | "rtl", lang: string, nonce: string | undefined, actions: VerifyBarActions) {
    this.host = floatingHost(doc, "verify");
    this.host.classList.add("vbar");
    const root = shadow(this.host, FLOAT_CSS, nonce);
    const bar = el(doc, "div", "bar");
    bar.setAttribute("role", "region");
    bar.setAttribute("dir", dir);
    bar.setAttribute("lang", lang);
    this.text = el(doc, "p", "t", strings.message);
    bar.setAttribute("aria-label", strings.message);
    this.allowButton = button(doc, "btn pri", strings.allow, () => actions.allow());
    bar.appendChild(this.text);
    bar.appendChild(this.allowButton);
    bar.appendChild(closeButton(doc, strings.close, () => actions.close()));
    root.appendChild(bar);
  }

  /** Permission was blocked: say how to unblock, and drop Allow. */
  blocked(help: string): void {
    this.text.textContent = help;
    remove(this.allowButton);
  }

  destroy(): void {
    remove(this.host);
  }
}
