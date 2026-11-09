import { describe, expect, it } from "vitest";
import type { Bootstrap } from "../src/core/bootstrap";
import { resolveOptions } from "../src/core/options";
import { checkSecureOrigin, checkSiteOrigin } from "../src/core/origin";
import { resolveServerUrl } from "../src/core/server_url";
import { SDK_ORIGIN, PRODUCTION_API_ORIGIN } from "../src/config/build";
import { bootstrapBody, SITE } from "./helpers/fake_platform";

const boot = (over: Record<string, unknown> = {}) => bootstrapBody(over) as unknown as Bootstrap;
const env = { language: "en-GB" };

describe("option resolution", () => {
  it("Typical site: console values win and conflicting code values are listed", () => {
    const { options, conflicts } = resolveOptions(
      { appId: "app-1", serviceWorkerPath: "/custom-sw.js", keepOnScreen: true, clickBehavior: { action: "focus" } },
      boot({ keep_on_screen: true }),
      env,
    );
    expect(options.setupType).toBe("typical");
    expect(options.serviceWorkerPath).toBe("/openpush-sw.js");
    expect(options.clickBehavior).toEqual({ match: "exact", action: "navigate" });
    // keepOnScreen matches the console value, so it is not a conflict.
    expect(conflicts).toEqual(["serviceWorkerPath", "clickBehavior"]);
  });

  it("Typical site: the welcome comes from the server, so a code welcome is a conflict", () => {
    const { options, conflicts } = resolveOptions({ appId: "a", welcomeNotification: { title: "Hi" } }, boot(), env);
    expect(options.welcomeNotification).toBeNull();
    expect(conflicts).toEqual(["welcomeNotification"]);
  });

  it("Custom code: code values with the defaults table", () => {
    const { options, conflicts } = resolveOptions(
      { appId: "a", serviceWorkerPath: "/op/openpush-sw.js", serviceWorkerScope: "/op/", keepOnScreen: false },
      boot({ setup_type: "custom", worker: undefined }),
      env,
    );
    expect(conflicts).toEqual([]);
    expect(options).toMatchObject({
      setupType: "custom",
      serviceWorkerPath: "/op/openpush-sw.js",
      serviceWorkerScope: "/op/",
      autoResubscribe: true,
      keepOnScreen: false,
      clickBehavior: { match: "exact", action: "navigate" },
      webhooks: { displayed: null, clicked: null, dismissed: null, cors: false },
      welcomeNotification: { enabled: true, title: "Example Play", message: "Thanks for subscribing", url: SITE },
      defaultUrl: SITE,
      defaultTitle: "Example Play",
      language: "en-GB",
      promptsLanguage: "en-GB",
      allowLocalhost: false,
      prompts: [],
    });
  });

  it("WordPress: console values as on a Typical site, but the plugin's worker path and scope win", () => {
    const { options, conflicts } = resolveOptions(
      {
        appId: "a",
        serviceWorkerPath: "/wp-content/plugins/openpush/worker/openpush-sw.js",
        serviceWorkerScope: "/wp-content/plugins/openpush/worker/",
        keepOnScreen: false,
      },
      boot({ setup_type: "wordpress", keep_on_screen: true, prompts: [{ id: "p1", type: "bell" }] }),
      env,
    );
    expect(options.setupType).toBe("typical");
    expect(options.serviceWorkerPath).toBe("/wp-content/plugins/openpush/worker/openpush-sw.js");
    expect(options.serviceWorkerScope).toBe("/wp-content/plugins/openpush/worker/");
    expect(options.keepOnScreen).toBe(true);
    expect(options.prompts).toEqual([{ id: "p1", type: "bell" }]);
    expect(options.welcomeNotification).toBeNull();
    expect(conflicts).toEqual(["keepOnScreen"]);
  });

  it("WordPress without code worker options falls back to the console's", () => {
    const { options, conflicts } = resolveOptions({ appId: "a" }, boot({ setup_type: "wordpress" }), env);
    expect(options.serviceWorkerPath).toBe("/openpush-sw.js");
    expect(options.serviceWorkerScope).toBe("/");
    expect(conflicts).toEqual([]);
  });

  it("an unknown setup type is treated as Custom code", () => {
    const { options } = resolveOptions({ appId: "a" }, boot({ setup_type: "shopify" }), env);
    expect(options.setupType).toBe("custom");
  });

  it("accepts only https webhook URLs", () => {
    const { options, invalid } = resolveOptions(
      { appId: "a", webhooks: { clicked: "http://hook.example.com", displayed: "https://hook.example.com/d", cors: true } },
      boot({ setup_type: "custom" }),
      env,
    );
    expect(options.webhooks).toEqual({ displayed: "https://hook.example.com/d", clicked: null, dismissed: null, cors: true });
    expect(invalid).toEqual(["webhooks.clicked"]);
  });
});

describe("origin checks", () => {
  const page = (href: string) => {
    const u = new URL(href);
    return { origin: u.origin, protocol: u.protocol, hostname: u.hostname };
  };

  it("needs https, or localhost with allowLocalhost", () => {
    expect(checkSecureOrigin(page("http://example.com/"), false)?.code).toBe("insecure_origin");
    expect(checkSecureOrigin(page("http://localhost:3000/"), false)?.code).toBe("insecure_origin");
    expect(checkSecureOrigin(page("http://localhost:3000/"), true)).toBeUndefined();
    expect(checkSecureOrigin(page(`${SITE}/`), false)).toBeUndefined();
  });

  it("checks the page against the site address", () => {
    expect(checkSiteOrigin(page(`${SITE}/x`), SITE, false)).toBeUndefined();
    const error = checkSiteOrigin(page("https://www.play.example.com/"), SITE, false);
    expect(error?.code).toBe("wrong_origin");
    expect(error?.message).toContain(SITE);
    expect(checkSiteOrigin(page("http://localhost:3000/"), "http://localhost:8080", true)).toBeUndefined();
    expect(checkSiteOrigin(page("http://localhost:3000/"), SITE, true)?.code).toBe("wrong_origin");
  });
});

describe("serverUrl", () => {
  it("uses the option, else the script origin, else the production API", () => {
    expect(resolveServerUrl("https://push.example.org/", undefined)).toBe("https://push.example.org");
    expect(resolveServerUrl(undefined, "https://push.example.net/sdk/web/v2/openpush.js")).toBe("https://push.example.net");
    expect(resolveServerUrl(undefined, `${SDK_ORIGIN}/sdk/web/v2/openpush.js`)).toBe(PRODUCTION_API_ORIGIN);
    expect(resolveServerUrl(undefined, undefined)).toBe(PRODUCTION_API_ORIGIN);
    expect(() => resolveServerUrl("not a url", undefined)).toThrow(expect.objectContaining({ code: "invalid_argument" }));
  });
});
