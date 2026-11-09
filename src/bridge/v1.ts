/**
 * The v1 bridge's public object: the v2 SDK with v1's call shapes, so a v1 site moves
 * to direct web push with no code change. The v2 core already reads v1 storage
 * (`openpush.web.v1`, IndexedDB version 1 `cfg`) and makes the silent move.
 *
 * Differences from v1, also in the changelog: `logout()` now detaches the user on the server, and
 * the sample app's link code is not sent (v2 registrations carry no `link_token`).
 */
import type { InitOptions } from "../core/options";
import type { OpenPushApi } from "../core/sdk";
import type { V1InitResult, V1PermissionResult } from "../core/v1";
import type { Logger } from "../log/logger";

/** v1's `init` options, plus every v2 option. */
export interface V1InitOptions extends InitOptions {
  /** v1 name of `serverUrl`. */
  server?: string;
  /** v1 name of `serviceWorkerScope`. */
  scope?: string;
}

/** What v1's `login` and `logout` resolved with. */
export interface V1IdentityResult {
  subscriptionId: string;
}

export type BridgeApi = Omit<OpenPushApi, "init" | "requestPermission" | "login" | "logout"> & {
  init(options: V1InitOptions): Promise<V1InitResult>;
  requestPermission(options?: { linkCode?: string | number }): Promise<V1PermissionResult>;
  login(externalId: string, authHash?: string): Promise<V1IdentityResult>;
  logout(): Promise<V1IdentityResult>;
};

/** v1 option names → v2 names; a v2 name given too wins. */
export function v2Options(options: V1InitOptions): InitOptions {
  const { server, scope, ...rest } = options ?? ({} as V1InitOptions);
  const out: InitOptions = { ...rest };
  if (out.serverUrl === undefined && typeof server === "string" && server !== "") out.serverUrl = server;
  if (out.serviceWorkerScope === undefined && typeof scope === "string" && scope !== "") out.serviceWorkerScope = scope;
  return out;
}

export function bridgeApi(api: OpenPushApi, log: Logger): BridgeApi {
  const identity = (): V1IdentityResult => ({ subscriptionId: api.PushSubscription.id ?? "" });
  return {
    ...api,
    init: (options) => api.init(v2Options(options)),
    requestPermission: (options) => {
      if (options?.linkCode !== undefined) {
        log.once("bridge-link-code", "warn", "requestPermission: the link code is not sent by this SDK version");
      }
      return api.requestPermission();
    },
    login: (externalId, authHash) => api.login(externalId, authHash).then(identity),
    logout: () => {
      log.once("bridge-logout", "info", "logout now also detaches the user from this browser on the OpenPush server");
      return api.logout().then(identity);
    },
  };
}
