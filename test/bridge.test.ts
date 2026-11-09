// @vitest-environment happy-dom
/**
 * v1 bridge: the bridge script puts the v2 SDK with v1's call shapes on `window.OpenPush`;
 * v1 option names map to v2 names; login and logout resolve with v1's `{subscriptionId}`; the prompt
 * UI comes from the v2 path.
 */
import { describe, expect, it, vi } from "vitest";
import { bridgeApi, v2Options } from "../src/bridge/v1";
import { createOpenPush } from "../src/core/sdk";
import { fakePlatform } from "./helpers/fake_platform";

describe("v1 bridge", () => {
  it("window.OpenPush has the v1 API shapes and the v2 members", async () => {
    const { bridgePromptsUrl } = await import("../src/bridge/openpush");
    const w = window as unknown as { OpenPush: Record<string, unknown> };
    for (const name of ["init", "requestPermission", "login", "logout", "getSubscriptionId", "onClick", "onBackground"]) {
      expect(typeof w.OpenPush[name]).toBe("function");
    }
    for (const name of ["initialize", "User", "PushSubscription", "Notifications", "Prompts"]) expect(w.OpenPush[name]).toBeDefined();
    expect(w.OpenPush.version).toMatch(/^1\.1\./);
    expect(bridgePromptsUrl("https://app.openpush.ai/sdk/web/v1/openpush.js")).toBe("https://app.openpush.ai/sdk/web/v2/openpush-prompts.js");
    expect(bridgePromptsUrl("https://push.example.com/sdk/web/2.0.0/openpush.js")).toBe("https://push.example.com/sdk/web/2.0.0/openpush-prompts.js");
  });

  it("maps v1 option names: server → serverUrl, scope → serviceWorkerScope; v2 names win", () => {
    expect(v2Options({ appId: "a", server: "https://push.example.com", scope: "/push/" })).toEqual({
      appId: "a",
      serverUrl: "https://push.example.com",
      serviceWorkerScope: "/push/",
    });
    expect(v2Options({ appId: "a", server: "https://old.example.com", serverUrl: "https://new.example.com" })).toEqual({
      appId: "a",
      serverUrl: "https://new.example.com",
    });
  });

  it("init resolves with {needsLinkCode, permission}; login and logout with {subscriptionId}", async () => {
    const fake = fakePlatform();
    const { api, runtime } = createOpenPush({ platform: fake.platform });
    const init = vi.spyOn(api, "init").mockResolvedValue({ needsLinkCode: false, permission: "default" });
    const login = vi.spyOn(api, "login").mockResolvedValue(undefined);
    const logout = vi.spyOn(api, "logout").mockResolvedValue(undefined);
    const bridge = bridgeApi(api, runtime.log);
    await expect(bridge.init({ appId: "app-1", server: "https://push.example.com" })).resolves.toEqual({ needsLinkCode: false, permission: "default" });
    expect(init).toHaveBeenCalledWith({ appId: "app-1", serverUrl: "https://push.example.com" });
    await expect(bridge.login("user-7")).resolves.toEqual({ subscriptionId: "" });
    expect(login).toHaveBeenCalledWith("user-7", undefined);
    await expect(bridge.logout()).resolves.toEqual({ subscriptionId: "" });
    expect(logout).toHaveBeenCalled();
  });

  it("logout says once that it now detaches on the server; a link code is not sent and says so", async () => {
    const fake = fakePlatform();
    const { api, runtime } = createOpenPush({ platform: fake.platform });
    const lines: string[] = [];
    runtime.log.setLevel("trace");
    runtime.log.addListener((e) => lines.push(e.message));
    vi.spyOn(api, "logout").mockResolvedValue(undefined);
    const permission = vi.spyOn(api, "requestPermission").mockResolvedValue({ permission: "granted", subscriptionId: "sub-1" });
    const bridge = bridgeApi(api, runtime.log);
    await bridge.logout();
    await bridge.logout();
    expect(lines.filter((l) => l.includes("detaches"))).toHaveLength(1);
    await expect(bridge.requestPermission({ linkCode: "123456" })).resolves.toEqual({ permission: "granted", subscriptionId: "sub-1" });
    expect(permission).toHaveBeenCalledWith();
    expect(lines.some((l) => l.includes("link code"))).toBe(true);
  });
});
