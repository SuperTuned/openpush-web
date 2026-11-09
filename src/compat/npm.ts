/**
 * `@openpush/web/compat`: the compat object over the bundled `OpenPush`. It shares the
 * one SDK instance with `@openpush/web`. Call `installGlobals()` when code on the page expects the
 * reference's globals (its deferred queue or its global object).
 */
import OpenPush from "../npm/index";
import { setupCompat } from "./runtime";

const setup = setupCompat(OpenPush, () => (typeof document === "undefined" ? undefined : document));
let installed = false;

export const OneSignal = setup.compat;
export default OneSignal;

/** Puts the compat object on `window` under the reference's name and drains its queues. Once per page. */
export function installGlobals(win: object | undefined = typeof window === "undefined" ? undefined : window): void {
  if (installed || !win) return;
  installed = true;
  setup.install(win);
}

export type {
  CompatSdk,
  CompatUser,
  CompatPushSubscription,
  CompatPushSubscriptionState,
  CompatNotifications,
  CompatNotificationEvent,
  CompatSlidedown,
  CompatClickEvent,
  CompatForegroundEvent,
} from "./facade";
export type { CompatNotification, CompatActionButton } from "./notification";
