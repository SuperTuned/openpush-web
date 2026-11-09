/**
 * Placed buttons: `<div data-openpush-button="<placement>"></div>` on the site's page. The
 * SDK renders into every matching element, also ones added later, through a `MutationObserver` on
 * `document.body` that is disconnected when no button prompt exists. The site's element keeps the
 * documented classes for its own CSS: `openpush-button`, `--subscribed` / `--unsubscribed`,
 * `--link`, `--small|medium|large`. The button itself is in a shadow root.
 */
import type { ButtonDef } from "../config";
import type { ButtonStrings } from "../i18n/strings";
import { BUTTON_CSS } from "./style";
import { el, shadow } from "./dom";
import type { BellState } from "./bell";

export const BUTTON_ATTR = "data-openpush-button";
const CLASS = "openpush-button";
const MANAGED = [`${CLASS}--subscribed`, `${CLASS}--unsubscribed`, `${CLASS}--link`, `${CLASS}--small`, `${CLASS}--medium`, `${CLASS}--large`];

export interface ButtonRender {
  def: ButtonDef;
  text: ButtonStrings;
  dir: "ltr" | "rtl";
  lang: string;
}

export interface ButtonActions {
  /** Runs inside the click handler (the gesture). */
  subscribe(def: ButtonDef): void;
  unsubscribe(def: ButtonDef): void;
}

export interface ButtonsInputs {
  /** Button prompts by placement. */
  render(placement: string): ButtonRender | undefined;
  state(): BellState;
  /** Push can work here (else the element stays empty). */
  available(): boolean;
  nonce(): string | undefined;
}

export class ButtonsView {
  private observer: MutationObserver | undefined;
  private readonly rendered = new Set<HTMLElement>();
  private readonly ours = new WeakSet<ShadowRoot>();

  constructor(
    private readonly doc: Document,
    private readonly inputs: ButtonsInputs,
    private readonly actions: ButtonActions,
    private readonly makeObserver: (callback: MutationCallback) => MutationObserver | undefined = (callback) =>
      typeof MutationObserver === "function" ? new MutationObserver(callback) : undefined,
  ) {}

  /** Renders every placed element and watches for new ones, or stops when no button prompt exists. */
  sync(hasButtons: boolean): void {
    if (!hasButtons) {
      this.disconnect();
      for (const host of [...this.rendered]) this.clear(host);
      return;
    }
    this.renderAll();
    if (!this.observer && this.doc.body) {
      this.observer = this.makeObserver((records) => this.added(records));
      this.observer?.observe(this.doc.body, { childList: true, subtree: true });
    }
  }

  get observing(): boolean {
    return this.observer !== undefined;
  }

  disconnect(): void {
    this.observer?.disconnect();
    this.observer = undefined;
  }

  renderAll(): void {
    for (const host of this.doc.querySelectorAll<HTMLElement>(`[${BUTTON_ATTR}]`)) this.render(host);
    for (const host of [...this.rendered]) if (!host.isConnected) this.rendered.delete(host);
  }

  private added(records: MutationRecord[]): void {
    for (const record of records) {
      for (const node of record.addedNodes) {
        if (node.nodeType !== 1) continue;
        const element = node as HTMLElement;
        if (element.hasAttribute(BUTTON_ATTR)) this.render(element);
        for (const inner of element.querySelectorAll<HTMLElement>(`[${BUTTON_ATTR}]`)) this.render(inner);
      }
    }
  }

  private clear(host: HTMLElement): void {
    const root = host.shadowRoot;
    if (!root || !this.ours.has(root)) return;
    host.classList.remove(CLASS, ...MANAGED);
    while (root.firstChild) root.removeChild(root.firstChild);
    this.rendered.delete(host);
  }

  private render(host: HTMLElement): void {
    const placement = host.getAttribute(BUTTON_ATTR) ?? "";
    const r = this.inputs.render(placement);
    if (!r) return this.clear(host);
    // Never touch a shadow root the site made itself.
    if (host.shadowRoot && !this.ours.has(host.shadowRoot)) return;
    let root: ShadowRoot;
    try {
      root = shadow(host, BUTTON_CSS, this.inputs.nonce());
    } catch {
      return; // A closed shadow root of the site's own.
    }
    this.ours.add(root);
    this.rendered.add(host);
    const { def, text } = r;
    const state = this.inputs.state();
    const subscribed = state === "subscribed";
    host.classList.remove(...MANAGED);
    host.classList.add(CLASS, subscribed ? `${CLASS}--subscribed` : `${CLASS}--unsubscribed`, `${CLASS}--${def.size}`);
    if (def.style === "link") host.classList.add(`${CLASS}--link`);
    if (!this.inputs.available() || (subscribed && !def.allowUnsubscribe)) return;

    const doc = this.doc;
    const wrap = el(doc, "span", "pbwrap");
    wrap.setAttribute("dir", r.dir);
    wrap.setAttribute("lang", r.lang);
    if (def.colors.background) wrap.style.setProperty("--pb-bg", def.colors.background);
    if (def.colors.text) wrap.style.setProperty("--pb-text", def.colors.text);
    const b = el(doc, "button", `pb ${def.size}${def.style === "link" ? " link" : ""}`, subscribed ? text.unsubscribe : text.subscribe);
    b.type = "button";
    if (state === "blocked") b.disabled = true;
    b.addEventListener("click", () => (this.inputs.state() === "subscribed" ? this.actions.unsubscribe(def) : this.actions.subscribe(def)));
    wrap.appendChild(b);
    const note = state === "blocked" ? text.blocked : text.explanation;
    if (note) wrap.appendChild(el(doc, "span", "note", note));
    root.appendChild(wrap);
  }
}
