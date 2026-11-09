// @vitest-environment happy-dom
/** `@openpush/vue`: the plugin initializes once, sets `$openpush`, and the composable is reactive. */
import { createApp, defineComponent, h, nextTick } from "vue";
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
  return import("../src/index");
}

beforeEach(() => {
  sdk.api.initialize.mockClear();
  sdk.setSdkWrapper.mockClear();
  sdk.observers.clear();
  Object.assign(sdk.state, { permission: false, optedIn: false, id: null, externalId: null });
});

describe("@openpush/vue", () => {
  it("initializes once with the options, sets $openpush and the wrapper name", async () => {
    const { OpenPushPlugin } = await load();
    const a = createApp({ render: () => null }).use(OpenPushPlugin, { appId: "app-1" });
    createApp({ render: () => null }).use(OpenPushPlugin, { appId: "app-1" });
    expect(sdk.api.initialize).toHaveBeenCalledTimes(1);
    expect(sdk.api.initialize).toHaveBeenCalledWith({ appId: "app-1" });
    expect(a.config.globalProperties.$openpush).toBe(sdk.api);
    expect(sdk.setSdkWrapper).toHaveBeenCalledWith("vue/2.0.0-test");
  });

  it("useOpenPush gives reactive state", async () => {
    const { OpenPushPlugin, useOpenPush } = await load();
    let s: ReturnType<typeof useOpenPush> | undefined;
    const Probe = defineComponent({
      setup() {
        s = useOpenPush();
        return () => h("span", String(s?.optedIn.value));
      },
    });
    const el = document.createElement("div");
    createApp(Probe).use(OpenPushPlugin, { appId: "app-1" }).mount(el);
    await sdk.api.initialize.mock.results[0]?.value;
    await nextTick();
    expect(s?.OpenPush).toBe(sdk.api);
    expect(el.textContent).toBe("false");

    Object.assign(sdk.state, { permission: true, optedIn: true, id: "sub-1", externalId: "user-7" });
    sdk.observers.forEach((fn) => fn());
    await nextTick();
    expect(el.textContent).toBe("true");
    expect(s?.permission.value).toBe(true);
    expect(s?.subscriptionId.value).toBe("sub-1");
    expect(s?.externalId.value).toBe("user-7");
  });
});
