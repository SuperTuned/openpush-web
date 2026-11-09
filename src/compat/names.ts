/**
 * The reference product's identifiers that the compatibility layer accepts. This folder
 * and `test/compat/` are the only places in the repo that spell them.
 */

/** The SDK object on `window`, and the legacy array queue of the reference's previous major version. */
export const REF_GLOBAL = "OneSignal";
/** The deferred callback queue. */
export const REF_DEFERRED = "OneSignalDeferred";
/** The reference's default worker file, at the site root. */
export const REF_WORKER_FILE = "OneSignalSDKWorker.js";
/** The container class its placed subscribe link renders into (`customlink`). */
export const REF_LINK_CONTAINER = "onesignal-customlink-container";
/** The user id getter on `User`; never compatible. */
export const REF_USER_ID = "onesignalId";
