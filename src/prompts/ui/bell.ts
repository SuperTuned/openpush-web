/**
 * The bell: a square button at the bottom left or right, with a tip on hover and focus, and
 * a small dialog to subscribe, unsubscribe (`optOut`, −2) or read how to unblock. Its accessible
 * name is the `aria_label` wording key.
 */
import type { Timers } from "../../net/queue";
import type { BellDef } from "../config";
import type { BellStrings } from "../i18n/strings";
import { BELL_OFF_PATHS, BELL_PATHS, button, closeButton, el, floatingHost, icon, remove, shadow, uid } from "./dom";
import { FLOAT_CSS } from "./style";

export type BellState = "not" | "subscribed" | "blocked";

export interface BellActions {
  /** Subscribe in the dialog. Runs inside the click handler (the gesture). */
  subscribe(): void;
  unsubscribe(): void;
  /** The dialog opened (`shown`). */
  opened(): void;
  /** The dialog closed without a choice (`dismissed`). */
  closed(): void;
}

const SIZES: Record<BellDef["size"], number> = { small: 36, medium: 44, large: 56 };
const NOTE_MS = 3000;

export class BellView {
  private readonly host: HTMLElement;
  private readonly root: ShadowRoot;
  private readonly wrap: HTMLDivElement;
  private readonly bell: HTMLButtonElement;
  private readonly tip: HTMLSpanElement;
  private dialog: HTMLDivElement | undefined;
  private state: BellState = "not";
  private noteTimer: unknown;
  private readonly outside = (event: Event): void => {
    if (this.dialog && !event.composedPath().includes(this.host)) this.closeDialog(true);
  };

  constructor(
    private readonly doc: Document,
    private def: BellDef,
    private text: BellStrings,
    private dir: "ltr" | "rtl",
    private lang: string,
    nonce: string | undefined,
    private readonly actions: BellActions,
    private readonly timers: Timers,
  ) {
    this.host = floatingHost(doc, "bell");
    this.host.classList.add("bellhost");
    this.root = shadow(this.host, FLOAT_CSS, nonce);
    this.wrap = el(doc, "div", "bellwrap");
    this.bell = el(doc, "button", "bell");
    this.bell.type = "button";
    this.bell.setAttribute("aria-haspopup", "dialog");
    this.bell.setAttribute("aria-expanded", "false");
    this.bell.addEventListener("click", () => (this.dialog ? this.closeDialog(true) : this.openDialog()));
    this.tip = el(doc, "span", "tip");
    this.tip.setAttribute("aria-hidden", "true");
    this.wrap.appendChild(this.bell);
    this.wrap.appendChild(this.tip);
    this.root.appendChild(this.wrap);
    this.root.addEventListener("keydown", (event) => {
      if ((event as KeyboardEvent).key === "Escape" && this.dialog) {
        this.closeDialog(true);
        this.bell.focus();
      }
    });
    doc.addEventListener("click", this.outside);
    this.apply();
  }

  update(def: BellDef, text: BellStrings, dir: "ltr" | "rtl", lang: string, state: BellState, visible: boolean): void {
    this.def = def;
    this.text = text;
    this.dir = dir;
    this.lang = lang;
    const changed = state !== this.state;
    this.state = state;
    this.host.hidden = !visible;
    this.apply();
    if (changed && this.dialog) this.renderDialog();
    if (!visible && this.dialog) this.closeDialog(false);
  }

  /** A card prompt is open: on phones the bell steps aside so they do not overlap. */
  hold(on: boolean): void {
    this.host.classList.toggle("hold", on);
  }

  /** A short note in the tip after subscribe or unsubscribe. */
  note(message: string): void {
    this.tip.textContent = message;
    this.tip.classList.add("show");
    if (this.noteTimer !== undefined) this.timers.clearTimeout(this.noteTimer);
    this.noteTimer = this.timers.setTimeout(() => {
      this.tip.classList.remove("show");
      this.tip.textContent = this.tipText();
    }, NOTE_MS);
  }

  destroy(): void {
    if (this.noteTimer !== undefined) this.timers.clearTimeout(this.noteTimer);
    this.doc.removeEventListener("click", this.outside);
    remove(this.host);
  }

  get element(): HTMLElement {
    return this.host;
  }

  private tipText(): string {
    return this.state === "subscribed" ? this.text.tip_subscribed : this.state === "blocked" ? this.text.tip_blocked : this.text.tip_not_subscribed;
  }

  private apply(): void {
    const { def } = this;
    this.host.classList.toggle("left", def.position === "bottom-left");
    this.host.style.setProperty("--op-b", `${def.offset.bottom}px`);
    this.host.style.setProperty("--op-s", `${def.offset.side}px`);
    this.host.style.setProperty("--op-z", `${SIZES[def.size]}px`);
    if (def.colors.main) this.host.style.setProperty("--op-main", def.colors.main);
    else this.host.style.removeProperty("--op-main");
    if (def.colors.accent) this.host.style.setProperty("--op-accent", def.colors.accent);
    else this.host.style.removeProperty("--op-accent");
    this.wrap.setAttribute("dir", this.dir);
    this.wrap.setAttribute("lang", this.lang);
    this.bell.setAttribute("aria-label", this.text.aria_label);
    this.bell.classList.toggle("blocked", this.state === "blocked");
    while (this.bell.firstChild) this.bell.removeChild(this.bell.firstChild);
    this.bell.appendChild(icon(this.doc, this.state === "blocked" ? BELL_OFF_PATHS : BELL_PATHS));
    if (!this.tip.classList.contains("show")) this.tip.textContent = this.tipText();
  }

  private openDialog(): void {
    const dialog = el(this.doc, "div", "dialog");
    dialog.setAttribute("role", "dialog");
    this.dialog = dialog;
    this.renderDialog();
    this.wrap.insertBefore(dialog, this.bell);
    this.bell.setAttribute("aria-expanded", "true");
    this.actions.opened();
    dialog.querySelector<HTMLButtonElement>(".btn")?.focus();
  }

  private renderDialog(): void {
    const dialog = this.dialog;
    if (!dialog) return;
    const { doc, text } = this;
    while (dialog.firstChild) dialog.removeChild(dialog.firstChild);
    dialog.setAttribute("dir", this.dir);
    const id = uid("bell");
    dialog.setAttribute("aria-labelledby", id);
    const title = el(doc, "p", "msg", this.state === "blocked" ? text.blocked_title : text.dialog_title);
    title.id = id;
    dialog.appendChild(closeButton(doc, text.close, () => this.closeDialog(true)));
    dialog.appendChild(title);
    if (this.state === "blocked") {
      dialog.appendChild(el(doc, "p", "small", text.blocked_help));
      return;
    }
    dialog.appendChild(el(doc, "p", "small", this.tipText()));
    const actions = el(doc, "div", "actions");
    if (this.state === "subscribed") {
      actions.appendChild(
        button(doc, "btn", text.unsubscribe, () => {
          this.closeDialog(false);
          this.actions.unsubscribe();
        }),
      );
    } else {
      actions.appendChild(
        button(doc, "btn pri", text.subscribe, () => {
          this.actions.subscribe();
          this.closeDialog(false);
        }),
      );
    }
    dialog.appendChild(actions);
  }

  private closeDialog(withoutChoice: boolean): void {
    if (!this.dialog) return;
    remove(this.dialog);
    this.dialog = undefined;
    this.bell.setAttribute("aria-expanded", "false");
    if (withoutChoice) this.actions.closed();
  }
}
