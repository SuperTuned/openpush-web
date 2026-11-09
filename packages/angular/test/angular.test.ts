// @vitest-environment happy-dom
/**
 * `@openpush/angular`: the providers initialize once in an environment initializer,
 * `forRoot` gives the same providers, and the service's signals follow the SDK's state.
 */
import { createEnvironmentInjector, type EnvironmentInjector, type EnvironmentProviders } from "@angular/core";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => {
  const observers = new Set<() => void>();
  const state = { permission: false, optedIn: false, id: null as string | null, externalId: null as string | null };
  const api = {
    initialize: vi.fn(async () => undefined),
    Notifications: {
      get permission() {
        return state.permission;
      },
      addPermissionObserver: (fn: () => void) => observers.add(fn),
    },
    PushSubscription: {
      get optedIn() {
        return state.optedIn;
      },
      get id() {
        return state.id;
      },
      addObserver: (fn: () => void) => observers.add(fn),
    },
    User: {
      get externalId() {
        return state.externalId;
      },
      addObserver: (fn: () => void) => observers.add(fn),
    },
  };
  return { api, state, observers, setSdkWrapper: vi.fn() };
});

vi.mock("@openpush/web", () => ({ default: sdk.api, setSdkWrapper: sdk.setSdkWrapper, VERSION: "2.0.0-test" }));

async function load() {
  vi.resetModules();
  const providers = await import("../src/providers");
  const service = await import("../src/service");
  return { ...providers, ...service };
}

function injector(providers: Array<EnvironmentProviders>): EnvironmentInjector {
  return createEnvironmentInjector(providers, null as unknown as EnvironmentInjector);
}

beforeEach(() => {
  sdk.api.initialize.mockClear();
  sdk.setSdkWrapper.mockClear();
  sdk.observers.clear();
  Object.assign(sdk.state, { permission: false, optedIn: false, id: null, externalId: null });
});

describe("@openpush/angular", () => {
  it("provideOpenPush initializes once in the environment initializer", async () => {
    const { provideOpenPush, OpenPushService } = await load();
    const env = injector([provideOpenPush({ appId: "app-1" })]);
    expect(sdk.api.initialize).toHaveBeenCalledTimes(1);
    expect(sdk.api.initialize).toHaveBeenCalledWith({ appId: "app-1" });
    expect(sdk.setSdkWrapper).toHaveBeenCalledWith("angular/2.0.0-test");
    // A second environment (a lazy route, a second app) does not initialize again.
    injector([provideOpenPush({ appId: "app-1" })]);
    expect(sdk.api.initialize).toHaveBeenCalledTimes(1);
    expect(env.get(OpenPushService).OpenPush).toBe(sdk.api);
  });

  it("the service's signals follow the SDK", async () => {
    const { provideOpenPush, OpenPushService } = await load();
    const service = injector([provideOpenPush({ appId: "app-1" })]).get(OpenPushService);
    await sdk.api.initialize.mock.results[0]?.value;
    await Promise.resolve();
    expect(service.optedIn()).toBe(false);
    Object.assign(sdk.state, { permission: true, optedIn: true, id: "sub-1", externalId: "user-7" });
    sdk.observers.forEach((fn) => fn());
    expect(service.permission()).toBe(true);
    expect(service.optedIn()).toBe(true);
    expect(service.subscriptionId()).toBe("sub-1");
    expect(service.externalId()).toBe("user-7");
  });

  it("OpenPushModule.forRoot carries the same providers", async () => {
    vi.resetModules();
    const { OpenPushModule } = await import("../src/module");
    const { OpenPushService } = await import("../src/service");
    const result = OpenPushModule.forRoot({ appId: "app-2" });
    expect(result.ngModule).toBe(OpenPushModule);
    const env = injector((result.providers ?? []) as EnvironmentProviders[]);
    expect(sdk.api.initialize).toHaveBeenCalledWith({ appId: "app-2" });
    expect(env.get(OpenPushService)).toBeInstanceOf(OpenPushService);
  });
});
