import { describe, expect, it, vi } from "vitest";
import { createOpenPush, INITIALIZED_EVENT } from "../src/core/sdk";
import { Db } from "../src/storage/idb";
import { LOCAL_KEY } from "../src/storage/local";
import { PAGE_TO_WORKER } from "../src/worker/channel";
import { bootstrapBody, fakePlatform, fakeRegistration, flush, jsonResponse, SITE, type Fake } from "./helpers/fake_platform";

function setup(fake: Fake = fakePlatform()) {
  const { api, runtime } = createOpenPush({ platform: fake.platform });
  return { fake, api, runtime };
}

function configCalls(fake: Fake): string[] {
  return fake.fetch.mock.calls.map((c) => String(c[0])).filter((u) => u.includes("/webpush-config"));
}

describe("initialize: consent gate (step 1)", () => {
  it("writes nothing and sends nothing before consent, then starts after setConsentGiven(true)", async () => {
    const { fake, api } = setup();
    api.setConsentRequired(true);
    api.Debug.setLogLevel("debug");
    let resolved = false;
    const done = api.initialize({ appId: "app-1" }).then(() => {
      resolved = true;
    });
    await flush();
    expect(resolved).toBe(false);
    expect(fake.fetch).not.toHaveBeenCalled();
    expect(fake.openSpy).not.toHaveBeenCalled();
    expect(fake.storage.setItem).not.toHaveBeenCalled();
    expect(fake.container.register).not.toHaveBeenCalled();

    api.setConsentGiven(true);
    await done;
    expect(fake.fetch).toHaveBeenCalled();
    expect(fake.container.register).toHaveBeenCalled();
    expect(fake.storage.map.get(LOCAL_KEY.debug)).toBe("debug");
  });

  it("requiresConsent in the options gates the same way", async () => {
    const { fake, api } = setup();
    const done = api.initialize({ appId: "app-1", requiresConsent: true });
    await flush();
    expect(fake.fetch).not.toHaveBeenCalled();
    api.setConsentGiven(true);
    await done;
    expect(fake.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("initialize: config bootstrap (step 3)", () => {
  it("fetches the config with sdk and sw parameters and caches it with the ETag", async () => {
    const { fake, api } = setup();
    await api.initialize({ appId: "app-1" });
    const url = new URL(configCalls(fake)[0] ?? "");
    expect(url.origin).toBe("https://app.openpush.ai");
    expect(url.pathname).toBe("/v1/apps/app-1/webpush-config");
    expect(url.searchParams.get("sdk")).toBe(api.version);
    expect(url.searchParams.get("sw")).toBe("");
    const init = fake.fetch.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["X-OP-SDK-Key"]).toBeUndefined();

    const cfg = await new Db(fake.idb, () => true).readCfg();
    expect(cfg?.bootstrap?.etag).toBe('"v1"');
    expect(cfg).toMatchObject({ app: "app-1", sdkKey: "sdk_key_abcdef123456", publicKey: "BPUBLICKEY", keyId: "k1", workerState: "ok" });
  });

  it("uses the cached config at once, then applies the fresh one (stale-while-revalidate)", async () => {
    const first = setup();
    await first.api.initialize({ appId: "app-1" });

    // Next page load, same browser storage. The server is slow and has a new click setting.
    let release: (r: Response) => void = () => undefined;
    const fake = fakePlatform({
      fetch: () => new Promise<Response>((resolve) => (release = resolve)),
    });
    Object.assign(fake, { idb: first.fake.idb });
    fake.platform.indexedDB = () => first.fake.idb;
    const { api, runtime } = setup(fake);
    await api.initialize({ appId: "app-1" });
    expect(runtime.context?.options.clickBehavior).toEqual({ match: "exact", action: "navigate" });
    const url = new URL(configCalls(fake)[0] ?? "");
    expect(url.searchParams.get("sw")).toBe("ok");
    const init = fake.fetch.mock.calls[0]?.[1] as RequestInit;
    expect((init.headers as Record<string, string>)["If-None-Match"]).toBe('"v1"');

    release(jsonResponse(bootstrapBody({ click: { match: "origin", action: "focus" } }), 200, { ETag: '"v2"' }));
    await vi.waitFor(() => expect(runtime.context?.options.clickBehavior).toEqual({ match: "origin", action: "focus" }));
    const cfg = await new Db(first.fake.idb, () => true).readCfg();
    expect(cfg?.bootstrap?.etag).toBe('"v2"');
    expect(cfg?.click).toEqual({ match: "origin", action: "focus" });
    const reg = runtime.context?.registration;
    const posts = (reg?.active?.postMessage as ReturnType<typeof vi.fn>).mock.calls.map((c) => c[0] as { type: string; payload: { click?: unknown } });
    expect(posts[posts.length - 1]).toMatchObject({ type: PAGE_TO_WORKER.config, payload: { click: { match: "origin", action: "focus" } } });
  });

  it("keeps the cached config on 304", async () => {
    const first = setup();
    await first.api.initialize({ appId: "app-1" });
    const fake = fakePlatform({ fetch: async () => jsonResponse(null, 304) });
    fake.platform.indexedDB = () => first.fake.idb;
    const { api, runtime } = setup(fake);
    await api.initialize({ appId: "app-1" });
    await flush();
    expect(runtime.context?.pushBlocked).toBeUndefined();
    expect(runtime.context?.bootstrap?.app).toBe("app-1");
    const cfg = await new Db(first.fake.idb, () => true).readCfg();
    expect(cfg?.bootstrap?.etag).toBe('"v1"');
  });

  it("logs config_unavailable and stops push when there is no cache and no answer", async () => {
    const fake = fakePlatform({
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const { api, runtime } = setup(fake);
    await expect(api.initialize({ appId: "app-1" })).resolves.toBeUndefined();
    expect(runtime.context?.pushBlocked?.code).toBe("config_unavailable");
    expect(fake.container.register).not.toHaveBeenCalled();
    expect(fake.sink.error).toHaveBeenCalled();
  });
});

describe("initialize: site checks (step 4)", () => {
  it("stops push and prompts with wrong_origin on another origin", async () => {
    const { fake, api, runtime } = setup(fakePlatform({ href: "https://www.play.example.com/" }));
    await api.initialize({ appId: "app-1" });
    expect(runtime.context?.pushBlocked?.code).toBe("wrong_origin");
    expect(runtime.context?.pushBlocked?.message).toContain(SITE);
    expect(runtime.context?.promptsAllowed).toBe(false);
    expect(fake.container.register).not.toHaveBeenCalled();
  });

  it("stops push and prompts with web_push_off", async () => {
    const fake = fakePlatform({ fetch: async () => jsonResponse({ app: "app-1", enabled: false }) });
    const { api, runtime } = setup(fake);
    await api.initialize({ appId: "app-1" });
    expect(runtime.context?.pushBlocked?.code).toBe("web_push_off");
    expect(runtime.context?.promptsAllowed).toBe(false);
    expect(fake.container.register).not.toHaveBeenCalled();
  });

  it("allows a localhost page with allowLocalhost when the site address is localhost", async () => {
    const fake = fakePlatform({
      href: "http://localhost:3000/",
      fetch: async () => jsonResponse(bootstrapBody({ site: { origin: "http://localhost:3000", name: "Local" } })),
    });
    const { api, runtime } = setup(fake);
    await api.initialize({ appId: "app-1", allowLocalhost: true });
    expect(runtime.context?.pushBlocked).toBeUndefined();
    expect(fake.container.register).toHaveBeenCalled();
  });

  it("reports insecure_origin for localhost without allowLocalhost", async () => {
    const fake = fakePlatform({ href: "http://localhost:3000/" });
    const { api, runtime } = setup(fake);
    await api.initialize({ appId: "app-1" });
    expect(runtime.context?.pushBlocked?.code).toBe("insecure_origin");
  });
});

describe("initialize: options per setup type", () => {
  it("Typical site uses the console worker path and warns once about code values", async () => {
    const { fake, api } = setup();
    await api.initialize({ appId: "app-1", serviceWorkerPath: "/mine.js", keepOnScreen: false });
    expect(fake.container.register).toHaveBeenCalledWith(`${SITE}/openpush-sw.js`, { scope: `${SITE}/` });
    const warnings = fake.sink.warn.mock.calls.map((c) => String(c[0])).filter((l) => l.includes("ignored"));
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("serviceWorkerPath");
    expect(warnings[0]).toContain("keepOnScreen");
  });

  it("Custom code uses the code values", async () => {
    const fake = fakePlatform({ fetch: async () => jsonResponse(bootstrapBody({ setup_type: "custom", worker: undefined })) });
    const { api } = setup(fake);
    await api.initialize({ appId: "app-1", serviceWorkerPath: "/op/openpush-sw.js", serviceWorkerScope: "/op/" });
    expect(fake.container.register).toHaveBeenCalledWith(`${SITE}/op/openpush-sw.js`, { scope: `${SITE}/op/` });
    expect(fake.sink.warn).not.toHaveBeenCalled();
  });
});

describe("initialize: worker (step 5)", () => {
  it("posts the config to the worker without the cached bootstrap", async () => {
    const { runtime, api } = setup();
    await api.initialize({ appId: "app-1" });
    const post = runtime.context?.registration?.active?.postMessage as ReturnType<typeof vi.fn>;
    const msg = post.mock.calls[0]?.[0] as { op: string; v: number; type: string; payload: Record<string, unknown> };
    expect(msg).toMatchObject({ op: "openpush", v: 2, type: PAGE_TO_WORKER.config });
    expect(msg.payload.sdkKey).toBe("sdk_key_abcdef123456");
    expect(msg.payload.bootstrap).toBeUndefined();
  });

  it("does not register over another worker at the same scope", async () => {
    const fake = fakePlatform();
    fake.container.registrations = [fakeRegistration(`${SITE}/`, `${SITE}/pwa.js`)];
    const { api, runtime } = setup(fake);
    await api.initialize({ appId: "app-1" });
    expect(runtime.context?.pushBlocked?.code).toBe("worker_scope_taken");
    expect(fake.container.register).not.toHaveBeenCalled();
    expect((await new Db(fake.idb, () => true).readCfg())?.workerState).toBe("taken");
  });

  it("stops push with not_supported when the browser has no Push API", async () => {
    const fake = fakePlatform({ pushApi: false });
    const { api, runtime } = setup(fake);
    await api.initialize({ appId: "app-1" });
    expect(runtime.context?.pushBlocked).toMatchObject({ code: "not_supported", detail: { reason: "no_push_api" } });
    expect(fake.fetch).toHaveBeenCalled();
  });
});

describe("initialize: once per page, hooks and the initialized event", () => {
  it("a second call resolves with a warning and changes nothing", async () => {
    const { fake, api } = setup();
    await api.initialize({ appId: "app-1" });
    await expect(api.initialize({ appId: "other" })).resolves.toBeUndefined();
    expect(configCalls(fake)).toHaveLength(1);
    expect(fake.sink.warn.mock.calls.some((c) => String(c[0]).includes("already called"))).toBe(true);
  });

  it("init (v1 name) initializes once and resolves with v1's result", async () => {
    const { fake, api } = setup();
    await expect(api.init({ appId: "app-1" })).resolves.toMatchObject({ needsLinkCode: false });
    await api.initialize({ appId: "app-1" });
    expect(configCalls(fake)).toHaveLength(1);
  });

  it("rejects a missing appId without locking the page", async () => {
    const { api } = setup();
    await expect(api.initialize({ appId: "" })).rejects.toMatchObject({ code: "invalid_argument" });
    await expect(api.initialize({ appId: "app-1" })).resolves.toBeUndefined();
  });

  it("runs the step 6 and 7 seams in order, before the queue drains and the event fires", async () => {
    const fake = fakePlatform({ dataLayer: [] });
    const order: string[] = [];
    fake.window.dispatchEvent.mockImplementation((e: Event) => {
      order.push((e as unknown as { type: string }).type);
      return true;
    });
    const { api } = createOpenPush({
      platform: fake.platform,
      hooks: {
        reconcilePush: async () => {
          order.push("reconcile");
        },
        startSessions: () => {
          order.push("sessions");
        },
        afterInitialize: () => {
          order.push("after");
        },
      },
    });
    await api.initialize({ appId: "app-1" });
    await flush();
    expect(order).toEqual(["reconcile", "sessions", INITIALIZED_EVENT, "after"]);
    const event = fake.window.dispatchEvent.mock.calls[0]?.[0] as unknown as { detail: unknown };
    expect(event.detail).toEqual({ version: api.version, subscriptionId: null });
    expect(fake.window.dataLayer).toEqual([{ event: "openpush.initialized" }]);
  });

  it("does not push to a data layer the page does not have", async () => {
    const { fake, api } = setup();
    await api.initialize({ appId: "app-1" });
    expect(fake.window.dataLayer).toBeUndefined();
  });

  it("a failing seam is logged and does not fail initialize", async () => {
    const fake = fakePlatform();
    const { api } = createOpenPush({
      platform: fake.platform,
      hooks: {
        reconcilePush: async () => {
          throw new Error("boom");
        },
      },
    });
    await expect(api.initialize({ appId: "app-1" })).resolves.toBeUndefined();
    expect(fake.sink.error.mock.calls.some((c) => String(c[0]).includes("push reconcile"))).toBe(true);
  });
});

describe("Debug", () => {
  it("persists the level, posts it to the worker and honours ?openpush_debug", async () => {
    const { fake, api, runtime } = setup();
    await api.initialize({ appId: "app-1" });
    api.Debug.setLogLevel("trace");
    expect(fake.storage.map.get(LOCAL_KEY.debug)).toBe("trace");
    const post = runtime.context?.registration?.active?.postMessage as ReturnType<typeof vi.fn>;
    expect(post.mock.calls[post.mock.calls.length - 1]?.[0]).toMatchObject({ type: PAGE_TO_WORKER.logLevel, payload: { level: "trace" } });
    expect(() => api.Debug.setLogLevel("loud" as never)).toThrow(expect.objectContaining({ code: "invalid_argument" }));

    const session = setup(fakePlatform({ href: `${SITE}/?openpush_debug=trace` }));
    expect(session.runtime.log.level).toBe("trace");
    expect(session.fake.storage.setItem).not.toHaveBeenCalled();
  });

  it("never logs the SDK key", async () => {
    const { fake, api } = setup();
    const lines: string[] = [];
    api.Debug.addLogListener((e) => lines.push(e.message));
    api.Debug.setLogLevel("trace");
    await api.initialize({ appId: "app-1" });
    const all = [...lines, ...fake.sink.debug.mock.calls.map((c) => String(c[0]))].join("\n");
    expect(lines.length).toBeGreaterThan(0);
    expect(all).not.toContain("sdk_key_abcdef123456");
  });
});
