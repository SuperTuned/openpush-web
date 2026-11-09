/**
 * `@openpush/vue`, Vue 3: `app.use(OpenPushPlugin, options)` initializes OpenPush once per
 * page load; `useOpenPush()` gives the `OpenPush` object with reactive `permission`, `optedIn`,
 * `subscriptionId` and `externalId`; templates reach the object as `$openpush`. During server-side
 * rendering the plugin only sets `$openpush`.
 */
import { inject, readonly, shallowRef, type App, type Plugin, type Ref } from "vue";
import OpenPush, { setSdkWrapper, VERSION, type InitOptions, type OpenPushApi } from "@openpush/web";

export interface OpenPushState {
  OpenPush: OpenPushApi;
  permission: Readonly<Ref<boolean>>;
  optedIn: Readonly<Ref<boolean>>;
  subscriptionId: Readonly<Ref<string | null>>;
  externalId: Readonly<Ref<string | null>>;
}

const permission = shallowRef(false);
const optedIn = shallowRef(false);
const subscriptionId = shallowRef<string | null>(null);
const externalId = shallowRef<string | null>(null);

const state: OpenPushState = {
  OpenPush,
  permission: readonly(permission),
  optedIn: readonly(optedIn),
  subscriptionId: readonly(subscriptionId),
  externalId: readonly(externalId),
};

const KEY = Symbol("openpush");

let started: Promise<void> | undefined;

function update(): void {
  permission.value = OpenPush.Notifications.permission;
  optedIn.value = OpenPush.PushSubscription.optedIn;
  subscriptionId.value = OpenPush.PushSubscription.id;
  externalId.value = OpenPush.User.externalId;
}

/** One `initialize` per page load, however many apps install the plugin. */
export function initOnce(options: InitOptions): Promise<void> {
  if (!started) {
    setSdkWrapper(`vue/${VERSION}`);
    OpenPush.PushSubscription.addObserver(update);
    OpenPush.Notifications.addPermissionObserver(update);
    OpenPush.User.addObserver(update);
    started = OpenPush.initialize(options).then(update, (error: unknown) => {
      console.error(`[OpenPush] initialize failed: ${error instanceof Error ? error.message : String(error)}`);
      update();
    });
  }
  return started;
}

export const OpenPushPlugin: Plugin<[InitOptions]> = {
  install(app: App, options: InitOptions) {
    app.config.globalProperties.$openpush = OpenPush;
    app.provide(KEY, state);
    if (typeof window === "undefined") return;
    void initOnce(options);
  },
};

/** The `OpenPush` object and its reactive state (read-only refs). */
export function useOpenPush(): OpenPushState {
  return inject(KEY, state);
}

declare module "vue" {
  interface ComponentCustomProperties {
    $openpush: OpenPushApi;
  }
}

export type { InitOptions, OpenPushApi };
