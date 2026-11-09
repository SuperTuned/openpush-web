/**
 * npm entry of `@openpush/web`. Bundled builds have no script origin, so the server defaults to
 * the production API origin unless `serverUrl` is passed.
 */
import { createOpenPush } from "../core/sdk";
import { browserPlatform } from "../platform/browser";

const { api, runtime } = createOpenPush({ platform: browserPlatform() });

export const OpenPush = api;
export default api;

/**
 * For OpenPush's framework wrappers: the `sdk_wrapper` value registrations carry, for example
 * "react/1.1.0". Not needed in your own code.
 */
export function setSdkWrapper(value: string): void {
  runtime.sdkWrapper = value;
}

export { OpenPushError, ERROR_CODES } from "../errors";
export type { OpenPushErrorCode, ErrorDetail } from "../errors";
export type { OpenPushApi, DebugApi, NotificationsApi } from "../core/sdk";
export type { ClickListener, DismissListener, ForegroundLifecycleListener } from "../core/notification_events";
export type { PushSubscriptionApi, NotificationPushApi } from "../push/api";
export type {
  PermissionChange,
  PermissionObserver,
  PushStatus,
  PushSubscriptionChange,
  PushSubscriptionObserver,
  PushSubscriptionState,
} from "../push/state";
export type { PermissionValue } from "../platform/types";
export type { UserApi, SessionApi, TagValue } from "../user/api";
export type { UserChange, UserObserver, UserState, IdentityVerificationHandler } from "../user/user";
export type { ChannelConsent } from "../user/channels";
export type { Verification, VerifyApi, VerifyChannel } from "../verify/verify";
export type { V1ClickPayload, V1InitResult, V1PermissionResult } from "../core/v1";
export type {
  NotificationButton,
  NotificationClickEvent,
  NotificationDismissEvent,
  NotificationWillDisplayEvent,
  OpenPushNotification,
} from "../notification";
export type { PromptsApi, PromptEvent, PromptEventName, PromptListener, PromptType, ShowOptions } from "../prompts/types";
export type { InitOptions, PromptOption, WelcomeOptions, WebhookOptions } from "../core/options";
export type { ClickBehavior } from "../storage/types";
export type { LogLevel } from "../log/levels";
export type { LogEntry, LogListener } from "../log/logger";
export { VERSION } from "../version";
