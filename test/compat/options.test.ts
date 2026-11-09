/** Init option shapes: every row of the table, plus prompt definitions the prompt UI accepts. */
import { describe, expect, it } from "vitest";
import { mapInitOptions, workerPath } from "../../src/compat/options";
import { DEFAULT_CONSENT, LINK_PLACEMENT } from "../../src/compat/prompts";
import { parsePrompts } from "../../src/prompts/config";
import type { Bootstrap } from "../../src/core/bootstrap";
import { resolveOptions } from "../../src/core/options";
import { bootstrapBody } from "../helpers/fake_platform";

const map = (extra: Record<string, unknown>) => mapInitOptions({ appId: "app-1", ...extra });
const prompt = (extra: Record<string, unknown>, type: string) => map(extra).options.prompts?.find((p) => p.type === type);

describe("init options", () => {
  it("appId: passed as given (no id translation)", () => {
    expect(map({}).options.appId).toBe("app-1");
  });

  it("requiresUserPrivacyConsent → requiresConsent", () => {
    expect(map({ requiresUserPrivacyConsent: true }).options.requiresConsent).toBe(true);
  });

  it("allowLocalhostAsSecureOrigin → allowLocalhost", () => {
    expect(map({ allowLocalhostAsSecureOrigin: true }).options.allowLocalhost).toBe(true);
  });

  it("autoResubscribe → autoResubscribe", () => {
    expect(map({ autoResubscribe: false }).options.autoResubscribe).toBe(false);
  });

  it("serviceWorkerPath: a leading slash is added; the default is the reference's file at the root", () => {
    expect(map({ serviceWorkerPath: "push/onesignal/OneSignalSDKWorker.js" }).options.serviceWorkerPath).toBe("/push/onesignal/OneSignalSDKWorker.js");
    expect(map({}).options.serviceWorkerPath).toBe("/OneSignalSDKWorker.js");
    expect(workerPath("/already.js")).toBe("/already.js");
  });

  it("the default worker path is not reported as an ignored code option on a Typical site", () => {
    const boot = (over: Record<string, unknown>) => bootstrapBody(over) as unknown as Bootstrap;
    const env = { language: "en" };
    // Typical, the site set no path: the console's path, no conflict.
    const typical = resolveOptions(map({}).options, boot({}), env);
    expect(typical.options.serviceWorkerPath).toBe("/openpush-sw.js");
    expect(typical.conflicts).toEqual([]);
    // Typical, the site set a path of its own: still reported.
    expect(resolveOptions(map({ serviceWorkerPath: "/x/OneSignalSDKWorker.js" }).options, boot({}), env).conflicts).toEqual(["serviceWorkerPath"]);
    // Custom code without a path: the reference default at the root, so the registration is kept.
    const custom = resolveOptions(map({}).options, boot({ setup_type: "custom", worker: undefined }), env);
    expect(custom.options.serviceWorkerPath).toBe("/OneSignalSDKWorker.js");
    // The marker is not an option of its own.
    expect(Object.keys(map({}).options)).toEqual(["appId", "serviceWorkerPath"]);
  });

  it("serviceWorkerParam.scope → serviceWorkerScope", () => {
    expect(map({ serviceWorkerParam: { scope: "/push/onesignal/" } }).options.serviceWorkerScope).toBe("/push/onesignal/");
    expect(map({}).options.serviceWorkerScope).toBeUndefined();
  });

  it("welcomeNotification {disable, title, message, url} → {enabled: !disable, title, message, url}", () => {
    expect(map({ welcomeNotification: { disable: true, title: "Hi", message: "Thanks", url: "https://play.example.com/" } }).options.welcomeNotification).toEqual({
      enabled: false,
      title: "Hi",
      message: "Thanks",
      url: "https://play.example.com/",
    });
    expect(map({ welcomeNotification: {} }).options.welcomeNotification).toEqual({ enabled: true });
  });

  it("persistNotification → keepOnScreen", () => {
    expect(map({ persistNotification: false }).options.keepOnScreen).toBe(false);
  });

  it("webhooks: event keys → displayed, clicked, dismissed; cors kept", () => {
    const w = map({
      webhooks: {
        cors: true,
        "notification.willDisplay": "https://hooks.example.com/d",
        "notification.clicked": "https://hooks.example.com/c",
        "notification.dismissed": "https://hooks.example.com/x",
      },
    }).options.webhooks;
    expect(w).toEqual({ cors: true, displayed: "https://hooks.example.com/d", clicked: "https://hooks.example.com/c", dismissed: "https://hooks.example.com/x" });
  });

  it("notificationClickHandlerMatch / Action → clickBehavior.match / action", () => {
    expect(map({ notificationClickHandlerMatch: "origin", notificationClickHandlerAction: "focus" }).options.clickBehavior).toEqual({ match: "origin", action: "focus" });
    expect(map({ notificationClickHandlerMatch: "origin" }).options.clickBehavior).toEqual({ match: "origin" });
    expect(map({}).options.clickBehavior).toBeUndefined();
  });

  it("safari_web_id: ignored and reported as unsupported", () => {
    const m = map({ safari_web_id: "web.com.example" });
    expect(m.unsupported).toContain("safari_web_id");
    expect(m.ignored).not.toContain("safari_web_id");
    expect(JSON.stringify(m.options)).not.toContain("web.com.example");
  });

  it("anything else: ignored and listed", () => {
    const m = map({ subdomainName: "x", path: "/", httpPermissionRequest: {} });
    expect(m.ignored).toEqual(["subdomainName", "path", "httpPermissionRequest"]);
  });

  it("OpenPush's own option names keep their meaning", () => {
    const m = map({ serverUrl: "https://push.example.com", logLevel: "debug", nonce: "n1" });
    expect(m.options).toMatchObject({ serverUrl: "https://push.example.com", logLevel: "debug", nonce: "n1" });
    expect(m.ignored).toEqual([]);
  });
});

describe("notifyButton → bell", () => {
  it("enable, size, position and offset", () => {
    expect(prompt({ notifyButton: { enable: true, size: "large", position: "bottom-left", offset: { bottom: "20px", left: "12px", right: "99px" } } }, "bell")).toMatchObject({
      type: "bell",
      enabled: true,
      size: "large",
      position: "bottom-left",
      offset: { bottom: 20, side: 12 },
    });
    expect(prompt({ notifyButton: { enable: true, position: "bottom-right", offset: { right: "30px" } } }, "bell")).toMatchObject({ offset: { side: 30 } });
  });

  it("no bell when enable is not true", () => {
    expect(prompt({ notifyButton: { enable: false } }, "bell")).toBeUndefined();
  });

  it("colors: circle background and foreground → main and accent; theme inverse swaps the defaults", () => {
    expect(prompt({ notifyButton: { enable: true, colors: { "circle.background": "#e54b4d", "circle.foreground": "white" } } }, "bell")).toMatchObject({
      colors: { main: "#e54b4d", accent: "white" },
    });
    expect(prompt({ notifyButton: { enable: true, theme: "inverse" } }, "bell")).toMatchObject({ colors: { main: "#F7F5F1", accent: "#0A0A0A" } });
  });

  it("text keys → bell wording keys, the launcher's aria-label → aria_label", () => {
    const bell = prompt(
      {
        notifyButton: {
          enable: true,
          text: {
            "tip.state.unsubscribed": "a",
            "tip.state.subscribed": "b",
            "tip.state.blocked": "c",
            "message.action.subscribed": "d",
            "message.action.unsubscribed": "e",
            "dialog.main.title": "f",
            "dialog.main.button.subscribe": "g",
            "dialog.main.button.unsubscribe": "h",
            "dialog.blocked.title": "i",
            "dialog.blocked.message": "j",
            "launcher.button.aria-label": "k",
          },
        },
      },
      "bell",
    );
    expect(bell?.wording).toEqual({
      tip_not_subscribed: "a",
      tip_subscribed: "b",
      tip_blocked: "c",
      after_subscribe: "d",
      after_unsubscribe: "e",
      dialog_title: "f",
      subscribe: "g",
      unsubscribe: "h",
      blocked_title: "i",
      blocked_help: "j",
      aria_label: "k",
    });
  });

  it("prenotify and showCredit are accepted, ignored and reported", () => {
    const m = map({ notifyButton: { enable: true, prenotify: true, showCredit: false } });
    expect(m.unsupported).toEqual(["notifyButton.prenotify", "notifyButton.showCredit"]);
  });

  it("displayPredicate is handed back to be evaluated once", () => {
    const predicate = () => false;
    expect(map({ notifyButton: { enable: true, displayPredicate: predicate } }).displayPredicate).toBe(predicate);
  });
});

describe("promptOptions.slidedown", () => {
  it("type push → slide_in: autoPrompt, delay and text", () => {
    expect(
      prompt(
        {
          promptOptions: {
            slidedown: {
              prompts: [
                { type: "push", autoPrompt: true, delay: { pageViews: 2, timeDelay: 15 }, text: { actionMessage: "Get news", acceptButton: "Yes", cancelButton: "No" } },
              ],
            },
          },
        },
        "slide_in",
      ),
    ).toEqual({ id: "slide_in", type: "slide_in", enabled: true, timing: { auto: true, page_views: 2, seconds: 15 }, wording: { message: "Get news", allow: "Yes", later: "No" } });
  });

  it("type category → slide_in with topics (≤ 10) and the update wording", () => {
    const categories = Array.from({ length: 12 }, (_, i) => ({ tag: `topic_${i}`, label: `Topic ${i}` }));
    const slide = prompt(
      {
        promptOptions: {
          slidedown: {
            prompts: [{ type: "category", categories, text: { updateMessage: "Update", positiveUpdateButton: "Save it", negativeUpdateButton: "Not now" } }],
          },
        },
      },
      "slide_in",
    ) as { topics: { enabled: boolean; items: unknown[] }; wording: Record<string, string> };
    expect(slide.topics.enabled).toBe(true);
    expect(slide.topics.items).toHaveLength(10);
    expect(slide.topics.items[0]).toEqual({ tag: "topic_0", label: "Topic 0" });
    expect(slide.wording).toEqual({ update_message: "Update", save: "Save it", cancel: "Not now" });
  });

  it("push and category together make one slide-in with topics", () => {
    const prompts = map({
      promptOptions: { slidedown: { prompts: [{ type: "push", text: { actionMessage: "A" } }, { type: "category", categories: [{ tag: "news", label: "News" }] }] } },
    }).options.prompts;
    expect(prompts?.filter((p) => p.type === "slide_in")).toHaveLength(1);
    expect(prompts?.[0]).toMatchObject({ wording: { message: "A" }, topics: { items: [{ tag: "news", label: "News" }] } });
  });

  it("type email, sms, smsAndEmail → email_phone fields email, phone, both, with the default consent line", () => {
    for (const [type, fields, consent] of [
      ["email", "email", DEFAULT_CONSENT.email],
      ["sms", "phone", DEFAULT_CONSENT.phone],
      ["smsAndEmail", "both", DEFAULT_CONSENT.phone],
    ] as const) {
      const m = map({ promptOptions: { slidedown: { prompts: [{ type, text: { emailLabel: "E", smsLabel: "S", confirmMessage: "Done" } }] } } });
      expect(m.defaultConsent).toBe(true);
      expect(m.options.prompts?.[0]).toMatchObject({
        type: "email_phone",
        fields,
        consent,
        wording: { email_label: "E", phone_label: "S", confirm: "Done" },
      });
    }
  });

  it("an email and an sms prompt together ask for both", () => {
    expect(prompt({ promptOptions: { slidedown: { prompts: [{ type: "email" }, { type: "sms" }] } } }, "email_phone")).toMatchObject({ fields: "both" });
  });

  it("the phone consent line says how to stop", () => {
    expect(DEFAULT_CONSENT.phone).toMatch(/STOP/);
  });
});

describe("promptOptions.customlink → button", () => {
  it("maps enabled, style, size, color, text and unsubscribeEnabled", () => {
    expect(
      prompt(
        {
          promptOptions: {
            customlink: {
              enabled: true,
              style: "link",
              size: "small",
              color: { button: "#111111", text: "#ffffff" },
              text: { subscribe: "Sub", unsubscribe: "Unsub", explanation: "Why" },
              unsubscribeEnabled: true,
            },
          },
        },
        "button",
      ),
    ).toEqual({
      id: "button",
      type: "button",
      enabled: true,
      placement: LINK_PLACEMENT,
      style: "link",
      size: "small",
      colors: { background: "#111111", text: "#ffffff" },
      allow_unsubscribe: true,
      wording: { subscribe: "Sub", unsubscribe: "Unsub", explanation: "Why" },
    });
    expect(map({ promptOptions: { customlink: { enabled: true } } }).placedButton).toBe(true);
  });

  it("no button when customlink is not enabled", () => {
    expect(prompt({ promptOptions: { customlink: { enabled: false } } }, "button")).toBeUndefined();
  });
});

describe("the prompt UI accepts what the layer makes", () => {
  it("parses every mapped prompt", () => {
    const prompts = map({
      notifyButton: { enable: true, size: "small", colors: { "circle.background": "#e54b4d" } },
      promptOptions: {
        slidedown: { prompts: [{ type: "category", autoPrompt: true, categories: [{ tag: "news", label: "News" }] }, { type: "smsAndEmail" }] },
        customlink: { enabled: true, style: "button" },
      },
    }).options.prompts ?? [];
    const parsed = parsePrompts(prompts);
    expect(parsed.map((p) => p.type).sort()).toEqual(["bell", "button", "email_phone", "slide_in"]);
    const contact = parsed.find((p) => p.type === "email_phone");
    expect(contact && "consent" in contact ? contact.consent : "").toBe(DEFAULT_CONSENT.phone);
  });
});
