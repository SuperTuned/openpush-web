/**
 * The card the slide-in, the email or phone prompt and the browser-prompt fallback share: the site
 * icon, a message, content and actions, in its own shadow root. Desktop: top centre (or bottom);
 * phones (≤ 640 px): always the bottom edge, full width.
 */
import { FLOAT_CSS } from "./style";
import { el, floatingHost, remove, shadow, uid } from "./dom";

export interface CardOptions {
  kind: string;
  nonce: string | undefined;
  position: "top" | "bottom";
  dir: "ltr" | "rtl";
  lang: string;
  icon: string | null;
  message: string;
  /** Escape key: the same as "Not now". */
  onEscape: () => void;
}

export class Card {
  readonly host: HTMLElement;
  readonly root: ShadowRoot;
  readonly card: HTMLDivElement;
  readonly body: HTMLDivElement;
  readonly actions: HTMLDivElement;
  readonly message: HTMLParagraphElement;

  constructor(
    readonly doc: Document,
    options: CardOptions,
  ) {
    this.host = floatingHost(doc, options.kind);
    this.host.classList.add(options.position);
    this.root = shadow(this.host, FLOAT_CSS, options.nonce);
    const card = el(doc, "div", "card");
    card.setAttribute("role", "dialog");
    card.setAttribute("dir", options.dir);
    card.setAttribute("lang", options.lang);
    const id = uid("msg");
    card.setAttribute("aria-labelledby", id);
    if (options.icon) {
      const img = el(doc, "img", "icon");
      img.alt = "";
      img.addEventListener("error", () => {
        remove(img);
        card.classList.add("no-icon");
      });
      img.src = options.icon;
      card.appendChild(img);
    } else {
      card.classList.add("no-icon");
    }
    this.body = el(doc, "div", "body");
    this.message = el(doc, "p", "msg", options.message);
    this.message.id = id;
    this.body.appendChild(this.message);
    card.appendChild(this.body);
    this.actions = el(doc, "div", "actions");
    card.appendChild(this.actions);
    card.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape") options.onEscape();
    });
    this.card = card;
    this.root.appendChild(card);
  }

  setMessage(text: string): void {
    this.message.textContent = text;
  }

  /** Replaces what is under the message. */
  setContent(...nodes: Node[]): void {
    while (this.body.childNodes.length > 1) this.body.removeChild(this.body.lastChild!);
    for (const node of nodes) this.body.appendChild(node);
  }

  setActions(...buttons: HTMLElement[]): void {
    while (this.actions.firstChild) this.actions.removeChild(this.actions.firstChild);
    for (const b of buttons) this.actions.appendChild(b);
  }

  /** Moves focus to the main action (prompts the person opened themselves). */
  focusMain(): void {
    const main = this.actions.querySelector<HTMLButtonElement>(".pri") ?? this.actions.querySelector("button");
    main?.focus();
  }

  destroy(): void {
    remove(this.host);
  }
}
