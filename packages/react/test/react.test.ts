// @vitest-environment happy-dom
/// <reference types="node" />
/**
 * `@openpush/react`: StrictMode initializes once, the hook follows the SDK's state,
 * and a server render does nothing.
 */
import { act, createElement, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const observers = { push: new Set<() => void>(), permission: new Set<() => void>(), user: new Set<() => void>() };
  const state = { permission: false, optedIn: false, id: null as string | null, externalId: null as string | null };
  const api = {
    initialize: vi.fn(async () => undefined),
    Notifications: {
      get permission() {
        return state.permission;
      },
      addPermissionObserver: (fn: () => void) => observers.permission.add(fn),
      removePermissionObserver: (fn: () => void) => observers.permission.delete(fn),
    },
    PushSubscription: {
      get optedIn() {
        return state.optedIn;
      },
      get id() {
        return state.id;
      },
      addObserver: (fn: () => void) => observers.push.add(fn),
      removeObserver: (fn: () => void) => observers.push.delete(fn),
    },
    User: {
      get externalId() {
        return state.externalId;
      },
      addObserver: (fn: () => void) => observers.user.add(fn),
      removeObserver: (fn: () => void) => observers.user.delete(fn),
    },
  };
  return { api, state, observers, setSdkWrapper: vi.fn() };
});

vi.mock("@openpush/web", () => ({ default: sdk.api, setSdkWrapper: sdk.setSdkWrapper, VERSION: "2.0.0-test" }));

async function load() {
  vi.resetModules();
  return import("../src/index");
}

beforeEach(() => {
  sdk.api.initialize.mockClear();
  sdk.setSdkWrapper.mockClear();
  Object.assign(sdk.state, { permission: false, optedIn: false, id: null, externalId: null });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
});

describe("@openpush/react", () => {
  it("initializes once under StrictMode, with the wrapper name", async () => {
    const { OpenPushProvider } = await load();
    const root = createRoot(document.createElement("div"));
    await act(async () => {
      root.render(createElement(StrictMode, null, createElement(OpenPushProvider, { options: { appId: "app-1" } })));
    });
    expect(sdk.api.initialize).toHaveBeenCalledTimes(1);
    expect(sdk.api.initialize).toHaveBeenCalledWith({ appId: "app-1" });
    expect(sdk.setSdkWrapper).toHaveBeenCalledWith("react/2.0.0-test");
    await act(async () => root.unmount());
  });

  it("keeps one init across a remount of the provider", async () => {
    const { OpenPushProvider } = await load();
    for (let i = 0; i < 2; i++) {
      const root = createRoot(document.createElement("div"));
      await act(async () => root.render(createElement(OpenPushProvider, { options: { appId: "app-1" } })));
      await act(async () => root.unmount());
    }
    expect(sdk.api.initialize).toHaveBeenCalledTimes(1);
  });

  it("useOpenPush follows permission, optedIn, subscriptionId and externalId", async () => {
    const { OpenPushProvider, useOpenPush } = await load();
    const seen: Array<Record<string, unknown>> = [];
    function Probe() {
      const s = useOpenPush();
      seen.push({ permission: s.permission, optedIn: s.optedIn, subscriptionId: s.subscriptionId, externalId: s.externalId, sdk: s.OpenPush });
      return null;
    }
    const root = createRoot(document.createElement("div"));
    await act(async () => root.render(createElement(OpenPushProvider, { options: { appId: "app-1" } }, createElement(Probe))));
    expect(seen.at(-1)).toMatchObject({ permission: false, optedIn: false, subscriptionId: null, externalId: null, sdk: sdk.api });

    Object.assign(sdk.state, { permission: true, optedIn: true, id: "sub-1" });
    await act(async () => sdk.observers.push.forEach((fn) => fn()));
    expect(seen.at(-1)).toMatchObject({ permission: true, optedIn: true, subscriptionId: "sub-1" });

    sdk.state.externalId = "user-7";
    await act(async () => sdk.observers.user.forEach((fn) => fn()));
    expect(seen.at(-1)).toMatchObject({ externalId: "user-7" });

    await act(async () => root.unmount());
    expect(sdk.observers.push.size + sdk.observers.permission.size + sdk.observers.user.size).toBe(0);
  });

  it("does nothing in a server render (Next.js)", async () => {
    const { OpenPushProvider, useOpenPush } = await load();
    function Probe() {
      const s = useOpenPush();
      return createElement("span", null, String(s.optedIn));
    }
    const html = renderToString(createElement(OpenPushProvider, { options: { appId: "app-1" } }, createElement(Probe)));
    expect(html).toBe("<span>false</span>");
    expect(sdk.api.initialize).not.toHaveBeenCalled();
    expect(sdk.setSdkWrapper).not.toHaveBeenCalled();
  });

  it('marks the provider module "use client"', async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    // A path string, not `new URL(...)`: under happy-dom the global URL is happy-dom's, which
    // Node's fs does not take as a file URL.
    const here = fileURLToPath(import.meta.url);
    const source = readFileSync(resolve(dirname(here), "../src/index.ts"), "utf8");
    expect(source.startsWith('"use client";')).toBe(true);
  });
});
