/**
 * The v1 public API kept on v2, so a v1 site works with the v2 script (and the v1
 * bridge) without code changes.
 */
import type { Logger } from "../log/logger";
import type { NotificationClickEvent } from "../notification";
import type { PushController } from "../push/controller";
import type { Bootstrap } from "./bootstrap";
import type { InitOptions } from "./options";

/** What v1's `init` resolved with. */
export interface V1InitResult {
  needsLinkCode: boolean;
  /** `Notification.permission`, or "unsupported". */
  permission: string;
}

export interface V1PermissionResult {
  permission: string;
  /** "" until the server has accepted this browser. */
  subscriptionId: string;
}

/** The v1 click payload. */
export interface V1ClickPayload {
  op: "openpush:click";
  message_id: string;
  action_id: string;
  url: string;
}

export interface V1Deps {
  push: PushController;
  log: Logger;
  initialize: (options: InitOptions) => Promise<void>;
  bootstrap: () => Bootstrap | undefined;
  addClickListener: (listener: (event: NotificationClickEvent) => void) => void;
  timers: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void };
  /** `Notification.permission`; undefined when the browser has none. */
  permission: () => string | undefined;
}

/** How long v1's `requestPermission` waits for the server to give this browser an id. */
export const V1_ID_WAIT_MS = 10_000;

export function v1Api(deps: V1Deps) {
  const { push } = deps;
  const permission = (): string => deps.permission() ?? "unsupported";
  const whenId = (): Promise<void> =>
    new Promise((resolve) => {
      if (push.id) return resolve();
      const done = (): void => {
        push.subscriptionObservers.remove(watch);
        deps.timers.clearTimeout(timer);
        resolve();
      };
      const watch = (): void => {
        if (push.id) done();
      };
      const timer = deps.timers.setTimeout(done, V1_ID_WAIT_MS);
      push.subscriptionObservers.add(watch);
    });
  return {
    /** `initialize`, resolving with v1's `{needsLinkCode, permission}`. */
    init: (options: InitOptions): Promise<V1InitResult> =>
      deps.initialize(options).then(() => ({ needsLinkCode: deps.bootstrap()?.needs_link_code === true, permission: permission() })),
    /** `Notifications.requestPermission()`, resolving with v1's `{permission, subscriptionId}`. */
    requestPermission: async (): Promise<V1PermissionResult> => {
      const granted = await push.requestPermission();
      if (granted) await whenId();
      return { permission: permission(), subscriptionId: push.id ?? "" };
    },
    getSubscriptionId: (): Promise<string> => Promise.resolve(push.id ?? ""),
    onClick: (fn: (payload: V1ClickPayload) => void): void => {
      if (typeof fn !== "function") return;
      deps.addClickListener(({ notification, result }) =>
        fn({ op: "openpush:click", message_id: notification.id, action_id: result.actionId, url: result.url }),
      );
    },
    /** Kept for v1 code. Browsers get no background pushes, so it never fires. */
    onBackground: (fn: (data: unknown) => void): void => {
      void fn;
      deps.log.once("v1-background", "info", "onBackground never fires: browsers show every push, so there are no background pushes");
    },
  };
}

export type V1Api = ReturnType<typeof v1Api>;
