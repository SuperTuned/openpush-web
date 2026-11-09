/**
 * The prompt loader in `openpush.js`: page views, loading the chunk only when a
 * prompt applies or `Prompts.*` is called, prompt event listeners, the verify code on the next
 * registration, and the tap entry with `opt_in`.
 */
import { describe, expect, it, vi } from "vitest";
import { createOpenPush } from "../src/core/sdk";
import { VERSION } from "../src/version";
import { chunkUrl, mayApply } from "../src/prompts/loader";
import type { PromptsChunk, PromptsHost, PromptsUi } from "../src/prompts/types";
import { bootstrapBody, fakePlatform, flush, jsonResponse, SITE } from "./helpers/fake_platform";
import { start } from "./helpers/sdk_harness";

function fakeChunk(): { chunk: PromptsChunk; ui: PromptsUi & { start: ReturnType<typeof vi.fn>; show: ReturnType<typeof vi.fn> }; host: () => PromptsHost | undefined } {
  let captured: PromptsHost | undefined;
  const ui = { start: vi.fn(), show: vi.fn(async () => undefined), refresh: vi.fn() };
  const chunk: PromptsChunk = {
    version: VERSION,
    create: (host) => {
      captured = host;
      return ui;
    },
  };
  return { chunk, ui, host: () => captured };
}

async function boot(prompts: unknown[], href = `${SITE}/`) {
  const fake = fakePlatform({
    href,
    fetch: async (url: string) =>
      url.includes("/webpush-config") ? jsonResponse(bootstrapBody({ prompts }), 200, { ETag: '"e"' }) : jsonResponse({ id: "sub-1", status: 1 }),
  });
  fake.platform.document = () => ({}) as Document;
  const { api, runtime } = createOpenPush({ platform: fake.platform });
  const f = fakeChunk();
  const loader = vi.fn(async () => f.chunk);
  runtime.prompts.setLoader(loader);
  await api.initialize({ appId: "app-1" });
  await flush(30);
  return { fake, api, runtime, loader, ...f };
}

describe("prompt loader", () => {
  it("counts a page view on every page load", async () => {
    const { fake } = await boot([]);
    expect(JSON.parse(fake.storage.map.get("openpush.prompts") ?? "{}").views).toBe(1);
  });

  it("does not load the prompt file when no prompt applies", async () => {
    const { loader } = await boot([{ type: "slide_in", timing: { page_views: 3 } }, { type: "bell", enabled: false }]);
    expect(loader).not.toHaveBeenCalled();
  });

  it("loads and starts it when a bell or button is set up, or an auto prompt is due", async () => {
    for (const prompts of [[{ type: "bell" }], [{ type: "button", placement: "x" }], [{ type: "slide_in", timing: { page_views: 1 } }]]) {
      const { loader, ui } = await boot(prompts);
      expect(loader).toHaveBeenCalledTimes(1);
      expect(ui.start).toHaveBeenCalledTimes(1);
    }
  });

  it("loads it for the verify bar", async () => {
    const { loader } = await boot([], `${SITE}/?openpush-verify=ABCDEFGHJK`);
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it("removes ?openpush-verify= from the address on load and keeps it for the bar", async () => {
    const fake = fakePlatform({
      href: `${SITE}/shop?openpush-verify=ABCDEFGHJK&x=1`,
      fetch: async (url: string) =>
        url.includes("/webpush-config") ? jsonResponse(bootstrapBody({ prompts: [] }), 200, { ETag: '"e"' }) : jsonResponse({ id: "sub-1", status: 1 }),
    });
    let address = `${SITE}/shop?openpush-verify=ABCDEFGHJK&x=1`;
    const replaceUrl = vi.fn((url: string) => {
      address = url;
    });
    fake.platform.location = () => {
      const u = new URL(address);
      return { href: u.href, origin: u.origin, protocol: u.protocol, hostname: u.hostname, search: u.search };
    };
    fake.platform.replaceUrl = replaceUrl;
    fake.platform.document = () => ({}) as Document;
    const { api, runtime } = createOpenPush({ platform: fake.platform });
    // Removed as the SDK loads, before initialize and before the prompt file.
    expect(replaceUrl).toHaveBeenCalledTimes(1);
    expect(address).toBe(`${SITE}/shop?x=1`);
    const f = fakeChunk();
    const loader = vi.fn(async () => f.chunk);
    runtime.prompts.setLoader(loader);
    await api.initialize({ appId: "app-1" });
    await flush(30);
    // The bar still gets the code: the chunk loads and sees the address it arrived with.
    expect(loader).toHaveBeenCalledTimes(1);
    const host = f.host()!;
    expect(host.dom.href()).toContain("openpush-verify=ABCDEFGHJK");
    // The bar's own clean-up does not touch the address again; after it, the live address shows.
    host.dom.replaceUrl(`${SITE}/shop?x=1`);
    expect(replaceUrl).toHaveBeenCalledTimes(1);
    expect(host.dom.href()).toBe(`${SITE}/shop?x=1`);
  });

  it("Prompts.show… loads it on demand and passes force", async () => {
    const { api, loader, ui } = await boot([]);
    await api.Prompts.showSlideIn({ force: true });
    await api.Prompts.showEmailOrPhone();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(ui.show).toHaveBeenNthCalledWith(1, "slide_in", { force: true });
    expect(ui.show).toHaveBeenNthCalledWith(2, "email_or_phone", { force: false });
  });

  it("Prompts.show… waits for initialize and rejects without it", async () => {
    const { api } = createOpenPush({ platform: fakePlatform().platform });
    await expect(api.Prompts.showBell()).rejects.toMatchObject({ code: "not_initialized" });
  });

  it("delivers prompt events to listeners added before the file loads", async () => {
    const { api, host } = await boot([{ type: "bell" }]);
    const seen: unknown[] = [];
    const listener = (e: unknown): void => {
      seen.push(e);
    };
    api.Prompts.addListener("accepted", listener);
    host()!.emit("accepted", { type: "bell", promptId: "b" });
    host()!.emit("shown", { type: "bell", promptId: "b" });
    api.Prompts.removeListener("accepted", listener);
    host()!.emit("accepted", { type: "bell", promptId: "b" });
    expect(seen).toEqual([{ type: "bell", promptId: "b" }]);
    expect(() => api.Prompts.addListener("clicked" as never, listener)).toThrow(/Unknown prompt event/);
  });

  it("a tap subscribes with opt_in (subscribeFromGesture({optIn: true}))", async () => {
    const { runtime, host } = await boot([{ type: "bell" }]);
    const spy = vi.spyOn(runtime.push, "subscribeFromGesture").mockResolvedValue({ permission: "granted", subscribed: true });
    await host()!.subscribe();
    expect(spy).toHaveBeenCalledWith({ optIn: true });
    await host()!.requestDirect();
    expect(spy).toHaveBeenLastCalledWith({ optIn: false });
  });

  it("the verify code rides the next registration only", async () => {
    const f = fakeChunk();
    const s = await start({ before: (_api, runtime) => runtime.prompts.setLoader(async () => f.chunk) });
    s.fake.platform.document = () => ({}) as Document;
    await s.api.Prompts.showBell();
    const host = f.host()!;
    s.reset();
    host.setVerifyCode("ABCDEFGHJK");
    await s.api.PushSubscription.optIn();
    await s.settle();
    await s.api.PushSubscription.optIn();
    await s.settle();
    const bodies = s.registrations();
    expect(bodies[0]?.verify_code).toBe("ABCDEFGHJK");
    expect(bodies.slice(1).every((b) => b.verify_code === undefined)).toBe(true);
  });
});

describe("where the prompt file comes from", () => {
  it("beside openpush.js for the script-tag build", () => {
    expect(chunkUrl("https://app.openpush.ai/sdk/web/v2/openpush.js")).toBe("https://app.openpush.ai/sdk/web/v2/openpush-prompts.js");
    expect(chunkUrl("https://app.example.com/sdk/web/2.0.1/openpush.js?x=1")).toBe("https://app.example.com/sdk/web/2.0.1/openpush-prompts.js");
  });
  it("the versioned hosted path for bundled builds", () => {
    expect(chunkUrl(undefined)).toBe(`https://app.openpush.ai/sdk/web/${VERSION}/openpush-prompts.js`);
  });
});

describe("mayApply", () => {
  const never = (): boolean => false;
  it("bell and buttons always; auto prompts when page views are met and not cooling down", () => {
    expect(mayApply({ type: "bell" }, 0, never)).toBe(true);
    expect(mayApply({ type: "slide_in", timing: { page_views: 2 } }, 1, never)).toBe(false);
    expect(mayApply({ type: "slide_in", timing: { page_views: 2 } }, 2, never)).toBe(true);
    expect(mayApply({ type: "slide_in" }, 5, () => true)).toBe(false);
    expect(mayApply({ type: "slide_in", timing: { auto: false } }, 5, never)).toBe(false);
    expect(mayApply({ type: "browser", enabled: false }, 5, never)).toBe(false);
    expect(mayApply({ type: "other" }, 5, never)).toBe(false);
  });
});
