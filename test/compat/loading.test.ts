// @vitest-environment happy-dom
/**
 * Loading shapes: the deferred queue, the compat object on the reference's global, the
 * previous array queue, the placed-link containers, and loading `openpush.js` beside the layer.
 */
import { describe, expect, it, vi } from "vitest";
import { coreUrl, loadCore } from "../../src/compat/load_core";
import { createCompat } from "../../src/compat/facade";
import { installGlobals, markLinkContainers } from "../../src/compat/loading";
import { setupCompat } from "../../src/compat/runtime";
import { attachInternal } from "../../src/core/internal";
import type { OpenPushApi } from "../../src/core/sdk";
import { fakeApi, testLog } from "./fake_api";

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup() {
  const fake = fakeApi();
  const { log, lines } = testLog();
  let init: Promise<void> | undefined;
  let release: () => void = () => undefined;
  vi.mocked(fake.api.initialize).mockImplementation(() => {
    init = new Promise<void>((resolve) => (release = resolve));
    return init;
  });
  const compat = createCompat({ api: fake.api, log, onPermissionPrompt: fake.onPermissionPrompt });
  return { fake, log, lines, compat, initialized: () => init, release: () => release() };
}

describe("loading shapes", () => {
  it("puts the compat object on the global and runs deferred callbacks with it, in order", async () => {
    const s = setup();
    const order: string[] = [];
    const win: Record<string, unknown> = {
      OneSignalDeferred: [
        async (sdk: typeof s.compat) => {
          order.push("init");
          await sdk.init({ appId: "app-1" });
        },
        (sdk: unknown) => {
          order.push(sdk === s.compat ? "tags" : "wrong object");
        },
      ],
    };
    installGlobals(win, s.compat, s.initialized, s.log);
    expect(win.OneSignal).toBe(s.compat);
    await tick();
    // The second callback waits for init.
    expect(order).toEqual(["init"]);
    s.release();
    await tick();
    expect(order).toEqual(["init", "tags"]);
    // Later pushes run at once.
    const later = vi.fn();
    (win.OneSignalDeferred as { push(fn: unknown): void }).push(later);
    await tick();
    expect(later).toHaveBeenCalledWith(s.compat);
  });

  it("accepts the previous array queue: functions and [name, ...args]", async () => {
    const s = setup();
    const fn = vi.fn();
    const win: Record<string, unknown> = { OneSignal: [fn, ["login", "user-7"]] };
    installGlobals(win, s.compat, s.initialized, s.log);
    await tick();
    expect(fn).toHaveBeenCalledWith(s.compat);
    expect(s.fake.api.login).toHaveBeenCalledWith("user-7");
    // `OneSignal.push(fn)` keeps working afterwards.
    const later = vi.fn();
    s.compat.push(later);
    await tick();
    expect(later).toHaveBeenCalledTimes(1);
  });

  it("a deferred callback that throws is logged and the queue goes on", async () => {
    const s = setup();
    const after = vi.fn();
    installGlobals({ OneSignalDeferred: [() => { throw new Error("boom"); }, after] }, s.compat, s.initialized, s.log);
    await tick();
    expect(after).toHaveBeenCalled();
    expect(s.lines.some((l) => l.level === "error" && l.message.includes("OneSignalDeferred"))).toBe(true);
  });
});

describe("placed-link containers (customlink)", () => {
  it("marks existing and later containers for the placed button", async () => {
    document.body.innerHTML = '<div class="onesignal-customlink-container" id="a"></div>';
    const stop = markLinkContainers(document);
    expect(document.getElementById("a")?.getAttribute("data-openpush-button")).toBe("");
    const wrap = document.createElement("section");
    wrap.innerHTML = '<div class="onesignal-customlink-container" id="b"></div>';
    document.body.appendChild(wrap);
    await tick();
    expect(document.getElementById("b")?.getAttribute("data-openpush-button")).toBe("");
    stop();
  });

  it("leaves a container that already names a placement", () => {
    document.body.innerHTML = '<div class="onesignal-customlink-container" data-openpush-button="footer" id="c"></div>';
    markLinkContainers(document)();
    expect(document.getElementById("c")?.getAttribute("data-openpush-button")).toBe("footer");
  });
});

describe("openpush-compat.js loads openpush.js", () => {
  it("from beside itself, else the hosted path of this version", () => {
    expect(coreUrl("https://app.openpush.ai/sdk/web/v2/openpush-compat.js")).toBe("https://app.openpush.ai/sdk/web/v2/openpush.js");
    expect(coreUrl("https://push.example.com/sdk/web/2.0.0/openpush-compat.js")).toBe("https://push.example.com/sdk/web/2.0.0/openpush.js");
    expect(coreUrl(undefined)).toMatch(/^https:\/\/app\.openpush\.ai\/sdk\/web\/1\.2\.[^/]+\/openpush\.js$/);
  });

  it("uses window.OpenPush when it is already on the page", async () => {
    const api = fakeApi().api;
    const win = { OpenPush: api } as unknown as Parameters<typeof loadCore>[0];
    await expect(loadCore(win, document, null)).resolves.toBe(api);
    expect(document.querySelector('script[src$="openpush.js"]')).toBeNull();
  });

  it("adds a script tag with the page's nonce when it is not", async () => {
    const win = {} as unknown as Parameters<typeof loadCore>[0];
    const own = document.createElement("script");
    own.src = "https://app.openpush.ai/sdk/web/v2/openpush-compat.js";
    own.nonce = "n-1";
    // happy-dom would fetch a connected script and fire "error" (no network); keep the tag
    // detached and fire its load by hand.
    let tag: HTMLScriptElement | undefined;
    const doc = {
      createElement: (name: string) => document.createElement(name),
      head: { appendChild: (node: HTMLScriptElement) => (tag = node) },
    } as unknown as Document;
    const loading = loadCore(win, doc, own);
    expect(tag?.src).toBe("https://app.openpush.ai/sdk/web/v2/openpush.js");
    expect(tag?.nonce).toBe("n-1");
    (win as { OpenPush?: unknown }).OpenPush = fakeApi().api;
    tag?.dispatchEvent(new Event("load"));
    await expect(loading).resolves.toBeDefined();
  });

  it("setupCompat needs the SDK's internal door and uses its logger", () => {
    const fake = fakeApi();
    expect(() => setupCompat(fake.api, () => document)).toThrow();
    const { log } = testLog();
    attachInternal(fake.api, { log, initialized: () => undefined, setSdkWrapper: vi.fn(), onPermissionPrompt: fake.onPermissionPrompt });
    const { compat } = setupCompat(fake.api as OpenPushApi, () => document);
    expect(typeof compat.init).toBe("function");
  });
});
