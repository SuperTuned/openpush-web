/**
 * The prompt UI for one page: the auto-prompt engine, the card prompts (slide-in, email or
 * phone, the browser prompt and its slide-in fallback), the bell, placed buttons, the verify bar,
 * `Prompts.show…` and prompt events.
 *
 * Every Allow, Subscribe and button tap calls `host.subscribe()` first thing in its click handler,
 * before any `await`, so the tap is the browser's gesture and the registration carries
 * `opt_in: true`.
 */
import type { GestureResult } from "../push/controller";
import { defaultPrompt, parsePrompts, type BellDef, type BrowserDef, type ButtonDef, type EmailPhoneDef, type PromptDef, type SlideInDef } from "./config";
import {
  autoPushAsk,
  bellVisible,
  contactFields,
  iosTab,
  manualPushAsk,
  needsGesture,
  pickAuto,
  waitFor,
  type PushAsk,
  type RuleInputs,
} from "./rules";
import type { PromptEvent, PromptEventName, PromptsHost, PromptsUi, ShowKind, ShowOptions } from "./types";
import { BellView, type BellState } from "./ui/bell";
import { ButtonsView } from "./ui/button";
import { Card } from "./ui/card";
import { EmailPhoneFlow } from "./ui/email_phone";
import { fillSlideIn } from "./ui/slide_in";
import { takeVerifyCode, VerifyBar } from "./ui/verify_bar";
import { wordingFor } from "./wording";
import type { StringGroup } from "./i18n/strings";

interface OpenCard {
  card: Card;
  event: PromptEvent;
  /** A push "ask" (closed when the person subscribes some other way). */
  ask: boolean;
}

function hostname(origin: string): string {
  try {
    return new URL(origin).hostname;
  } catch {
    return origin;
  }
}

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isPrivateMode(error: unknown): boolean {
  const e = error as { code?: unknown; detail?: { reason?: unknown } } | undefined;
  return !!e && e.code === "not_supported" && e.detail?.reason === "private_mode";
}

export class PromptsController implements PromptsUi {
  private started = false;
  private defs: PromptDef[] = [];
  private open: OpenCard | undefined;
  private bell: BellView | undefined;
  /** `Prompts.showBell()` was called: show a bell even when none is set up. */
  private bellForced = false;
  private buttons: ButtonsView | undefined;
  private verifyBar: VerifyBar | undefined;
  private autoTimer: unknown;
  /** The one auto prompt of this page has shown. */
  private autoDone = false;

  constructor(private readonly host: PromptsHost) {}

  start(): void {
    if (this.started) return;
    this.started = true;
    this.reload();
    this.host.dom.onPageHide(() => this.leave());
    this.host.onPushChange(() => this.pushChanged());
    // A visit from the console's site check is about that check: no auto prompt on it.
    if (this.verify()) this.autoDone = true;
    this.placeFixed();
    void this.scheduleAuto();
  }

  refresh(): void {
    if (!this.started) return;
    this.reload();
    if (!this.host.view().allowed) this.closeOpen("closed");
    this.placeFixed();
    if (!this.autoDone) {
      this.clearTimer();
      void this.scheduleAuto();
    }
  }

  async show(kind: ShowKind, options: ShowOptions): Promise<void> {
    this.start();
    const force = options.force === true;
    const host = this.host;
    const view = host.view();
    const now = host.now();
    if (kind === "bell") {
      this.bellForced = true;
      this.placeFixed();
      if (this.bell?.element.hidden !== false) host.log.info("The bell is not shown in this browser");
      return;
    }
    if (kind === "slide_in" || kind === "topics") {
      const def = this.find("slide_in") ?? defaultPrompt("slide_in");
      if (kind === "topics" && def.topics.length === 0) throw host.error("invalid_argument", "The slide-in prompt has no topics set up");
      if (!force && host.store.coolingDown("slide_in", now)) {
        host.log.info("The slide-in prompt was dismissed recently; pass {force: true} from a click to show it anyway");
        return;
      }
      const inputs = this.inputs();
      const mode = manualPushAsk(def, inputs, kind === "topics");
      if (!mode) {
        if (view.pushBlocked) throw view.pushBlocked;
        host.log.info(inputs.status === "subscribed" ? "This person is already subscribed" : "Notifications are blocked or not available in this browser");
        return;
      }
      this.showSlideIn(def, mode, true, { type: "slide_in", promptId: def.id });
      return;
    }
    const def = this.find("email_phone") ?? defaultPrompt("email_phone");
    if (!def.consent) throw host.error("invalid_argument", "The email or phone prompt needs a consent line");
    const wanted: EmailPhoneDef["fields"] = kind === "email" ? "email" : kind === "phone" ? "phone" : def.fields;
    const fields = contactFields({ ...def, fields: wanted }, view.channels);
    if (fields.length === 0) throw host.error("invalid_argument", "Email or texting is not set up for this app");
    if (!force && host.store.coolingDown("email_phone", now)) {
      host.log.info("The email or phone prompt was dismissed recently; pass {force: true} from a click to show it anyway");
      return;
    }
    this.showContact(def, fields, true);
  }

  // ------------------------------------------------------------------ state

  private reload(): void {
    this.defs = parsePrompts(this.host.view().prompts);
  }

  private find<T extends PromptDef["type"]>(type: T): Extract<PromptDef, { type: T }> | undefined {
    return this.defs.find((d) => d.type === type) as Extract<PromptDef, { type: T }> | undefined;
  }

  private inputs(): RuleInputs {
    const host = this.host;
    const view = host.view();
    const now = host.now();
    const store = host.store;
    return {
      now,
      views: store.views,
      elapsed: (now - host.pageStart) / 1000,
      env: view.env,
      status: host.status(),
      optedOut: host.optedOut(),
      permission: host.permission(),
      pushBlocked: !!view.pushBlocked,
      newRegistrations: view.newRegistrations,
      privateSession: store.privateSession(now) || host.privateMode(),
      channels: view.channels,
      coolingDown: (type) => store.coolingDown(type, now),
      wasAccepted: (type) => store.wasAccepted(type),
    };
  }

  private bellState(): BellState {
    if (this.host.status() === "subscribed") return "subscribed";
    return this.host.permission() === "denied" ? "blocked" : "not";
  }

  private words<G extends StringGroup>(group: G, wording: PromptDef["wording"] = {}) {
    const view = this.host.view();
    return wordingFor(group, view.language, wording, view.site.name || hostname(view.site.origin));
  }

  // ------------------------------------------------------------------ auto prompts

  private async scheduleAuto(): Promise<void> {
    await this.host.settled().catch(() => undefined);
    if (this.autoDone || this.autoTimer !== undefined || !this.host.view().allowed) return;
    const inputs = this.inputs();
    const pick = pickAuto(this.defs, inputs);
    if (!pick) return;
    this.autoTimer = this.host.timers.setTimeout(() => this.fireAuto(), waitFor(pick, inputs));
  }

  private fireAuto(): void {
    this.autoTimer = undefined;
    if (this.autoDone || !this.host.view().allowed) return;
    if (this.open) {
      // A prompt the site opened is on screen; the auto prompt waits for the next page.
      this.autoDone = true;
      return;
    }
    const inputs = this.inputs();
    const pick = pickAuto(this.defs, inputs);
    if (!pick) return;
    const wait = waitFor(pick, inputs);
    if (wait > 0) {
      this.autoTimer = this.host.timers.setTimeout(() => this.fireAuto(), wait);
      return;
    }
    this.autoDone = true;
    if (pick.type === "browser") this.showBrowser(pick, inputs);
    else if (pick.type === "slide_in") this.showSlideIn(pick, autoPushAsk(pick, inputs) ?? "ask", false, { type: "slide_in", promptId: pick.id });
    else if (pick.type === "email_phone") this.showContact(pick, contactFields(pick, inputs.channels), false);
  }

  private clearTimer(): void {
    if (this.autoTimer !== undefined) this.host.timers.clearTimeout(this.autoTimer);
    this.autoTimer = undefined;
  }

  /**
   * The `browser` type: the browser's own prompt at once on Chrome and Edge desktop;
   * elsewhere (Firefox, Safari, iOS Home Screen apps, Chrome on Android) the slide-in with default
   * wording first, whose Allow is the gesture.
   */
  private showBrowser(def: BrowserDef, inputs: RuleInputs): void {
    const event: PromptEvent = { type: "browser", promptId: def.id };
    if (needsGesture(inputs.env)) {
      this.showSlideIn(defaultPrompt("slide_in"), "ask", false, event);
      return;
    }
    this.host.emit("shown", event);
    let result: Promise<GestureResult>;
    try {
      result = this.host.requestDirect();
    } catch (error) {
      result = Promise.reject(error);
    }
    result.then(
      (r) => {
        if (r.permission === "granted") {
          this.host.store.accepted("browser", this.host.now());
          this.host.emit("accepted", event);
        } else {
          this.host.store.dismissed("browser", this.host.now());
          this.host.emit("dismissed", event);
        }
      },
      (error) => this.failed(error),
    );
  }

  // ------------------------------------------------------------------ gestures

  /**
   * Subscribe from a tap. Call it first thing in a click handler. A dismissed or blocked browser
   * prompt after Allow counts as a dismiss of `cooldownType`; a private-window failure does
   * not.
   */
  private tap(cooldownType?: string): Promise<GestureResult | undefined> {
    let result: Promise<GestureResult>;
    try {
      result = this.host.subscribe();
    } catch (error) {
      result = Promise.reject(error);
    }
    return result.then(
      (r) => {
        if (r.permission !== "granted" && cooldownType) this.host.store.dismissed(cooldownType, this.host.now());
        return r;
      },
      (error) => {
        this.failed(error);
        return undefined;
      },
    );
  }

  private failed(error: unknown): void {
    if (isPrivateMode(error)) {
      this.host.store.markPrivate(this.host.now());
      this.host.log.info("This looks like a private window, which cannot get notifications; no prompt is shown again on this visit");
      return;
    }
    this.host.log.warn(`The subscription did not start: ${message(error)}`);
  }

  // ------------------------------------------------------------------ card prompts

  private showSlideIn(def: SlideInDef, mode: PushAsk, manual: boolean, event: PromptEvent): void {
    const host = this.host;
    const w = this.words("slide_in", def.wording);
    const cooldownType = event.type;
    const later = (): void => {
      host.store.dismissed(cooldownType, host.now());
      this.finish(card, "dismissed");
    };
    const card = this.openCard("slide_in", def.position, w.dir, w.lang, later);
    fillSlideIn(
      card,
      { mode, text: w.text, topics: def.topics, current: host.getTags() },
      {
        allow: (tags) => {
          // Recorded as accepted only once the browser grants permission; a dismissed or blocked
          // browser prompt counts as a dismiss (tap), not both.
          void this.tap(cooldownType).then((r) => {
            if (r?.permission === "granted") host.store.accepted(cooldownType, host.now());
          });
          if (tags) host.addTags(tags);
          this.finish(card, "accepted");
        },
        later,
        save: (tags) => {
          host.addTags(tags);
          host.store.accepted(cooldownType, host.now());
          this.finish(card, "accepted");
        },
      },
    );
    this.present(card, event, mode === "ask", manual);
  }

  private showContact(def: EmailPhoneDef, fields: ("email" | "phone")[], manual: boolean): void {
    const host = this.host;
    const view = host.view();
    const w = this.words("email_phone", def.wording);
    const event: PromptEvent = { type: "email_phone", promptId: def.id };
    const later = (): void => {
      host.store.dismissed("email_phone", host.now());
      this.finish(card, "dismissed");
    };
    const card = this.openCard("email_phone", "top", w.dir, w.lang, later);
    new EmailPhoneFlow({
      card,
      text: w.text,
      fields,
      consent: { text: def.consent, origin: view.site.origin },
      language: view.language,
      log: host.log,
      verify: host.verify,
      addEmail: (address, consent) => host.addEmail(address, consent),
      addSms: (number, consent) => host.addSms(number, consent),
      accepted: () => {
        host.store.accepted("email_phone", host.now());
        host.emit("accepted", event);
      },
      later,
      done: () => this.finish(card, undefined),
    });
    this.present(card, event, false, manual);
  }

  private openCard(kind: string, position: "top" | "bottom", dir: "ltr" | "rtl", lang: string, onEscape: () => void): Card {
    this.closeOpen("closed");
    const view = this.host.view();
    return new Card(this.host.dom.document, { kind, nonce: view.nonce, position, dir, lang, icon: view.site.icon, message: "", onEscape });
  }

  private present(card: Card, event: PromptEvent, ask: boolean, manual: boolean): void {
    this.open = { card, event, ask };
    this.bell?.hold(true);
    this.host.emit("shown", event);
    if (manual) card.focusMain();
  }

  /** Removes the card; `name` is the event to report (none after the email confirm). */
  private finish(card: Card, name: PromptEventName | undefined): void {
    card.destroy();
    const open = this.open;
    if (!open || open.card !== card) return;
    this.open = undefined;
    this.bell?.hold(false);
    if (name) this.host.emit(name, open.event);
  }

  private closeOpen(name: PromptEventName): void {
    if (this.open) this.finish(this.open.card, name);
  }

  private leave(): void {
    this.clearTimer();
    this.closeOpen("closed");
  }

  // ------------------------------------------------------------------ bell and buttons

  private pushChanged(): void {
    if (this.open?.ask && this.host.status() === "subscribed") this.closeOpen("closed");
    this.placeFixed();
  }

  private placeFixed(): void {
    const host = this.host;
    const view = host.view();
    const inputs = this.inputs();
    const doc = host.dom.document;

    const configured = this.defs.find((d): d is BellDef => d.type === "bell" && d.enabled);
    const bellDef = configured ?? (this.bellForced ? this.find("bell") ?? defaultPrompt("bell") : undefined);
    if (bellDef && view.allowed) {
      const w = this.words("bell", bellDef.wording);
      const event: PromptEvent = { type: "bell", promptId: bellDef.id };
      if (!this.bell) {
        this.bell = new BellView(
          doc,
          bellDef,
          w.text,
          w.dir,
          w.lang,
          view.nonce,
          {
            subscribe: () => {
              const result = this.tap();
              host.emit("accepted", event);
              void result.then((r) => {
                if (r?.subscribed) this.bell?.note(this.words("bell", bellDef.wording).text.after_subscribe);
              });
            },
            unsubscribe: () => {
              host.optOut().then(
                () => this.bell?.note(this.words("bell", bellDef.wording).text.after_unsubscribe),
                (error) => host.log.warn(`Unsubscribe did not finish: ${message(error)}`),
              );
            },
            opened: () => host.emit("shown", event),
            closed: () => host.emit("dismissed", event),
          },
          host.timers,
        );
      }
      this.bell.update(bellDef, w.text, w.dir, w.lang, this.bellState(), bellVisible(bellDef.hideWhenSubscribed, inputs));
    } else if (this.bell) {
      this.bell.destroy();
      this.bell = undefined;
    }

    const buttons = this.defs.filter((d): d is ButtonDef => d.type === "button" && d.enabled);
    if (!this.buttons && buttons.length > 0) {
      this.buttons = new ButtonsView(
        doc,
        {
          render: (placement) => {
            const def = this.defs.find((d): d is ButtonDef => d.type === "button" && d.enabled && d.placement === placement);
            if (!def) return undefined;
            const w = this.words("button", def.wording);
            return { def, text: w.text, dir: w.dir, lang: w.lang };
          },
          state: () => this.bellState(),
          available: () => bellVisible(false, this.inputs()),
          nonce: () => this.host.view().nonce,
        },
        {
          subscribe: (def) => {
            void this.tap();
            host.emit("accepted", { type: "button", promptId: def.id });
          },
          unsubscribe: () => {
            host.optOut().catch((error: unknown) => host.log.warn(`Unsubscribe did not finish: ${message(error)}`));
          },
        },
      );
    }
    this.buttons?.sync(buttons.length > 0 && view.allowed);
  }

  // ------------------------------------------------------------------ verify bar

  /** Returns true when the page came from the site check link. */
  private verify(): boolean {
    const host = this.host;
    const taken = takeVerifyCode(host.dom.href());
    if (!taken) return false;
    host.dom.replaceUrl(taken.cleanUrl);
    const view = host.view();
    if (!taken.code) {
      host.log.warn("The site check link is not valid; start it again from the console");
      return true;
    }
    if (!view.allowed || view.pushBlocked || view.env.inAppBrowser || iosTab(view.env)) {
      host.log.warn(`This browser cannot finish the site check${view.pushBlocked ? `: ${view.pushBlocked.message}` : ""}`);
      return true;
    }
    const code = taken.code;
    const w = this.words("verify");
    const bar = new VerifyBar(host.dom.document, w.text, w.dir, w.lang, view.nonce, {
      allow: () => {
        host.setVerifyCode(code);
        void this.tap().then((r) => {
          if (r?.permission === "granted") this.closeBar();
          else if (r?.permission === "denied") bar.blocked(this.words("bell").text.blocked_help);
        });
      },
      close: () => this.closeBar(),
    });
    this.verifyBar = bar;
    return true;
  }

  private closeBar(): void {
    this.verifyBar?.destroy();
    this.verifyBar = undefined;
  }
}
