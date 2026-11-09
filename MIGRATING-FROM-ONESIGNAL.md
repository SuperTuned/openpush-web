# Migrating from the OneSignal Web SDK

OpenPush's compatibility layer provides the call names of the OneSignal Web SDK (the
`OneSignal` and `OneSignalDeferred` globals and their `init`, `login`, `User`, `Notifications`,
`Slidedown`, `Session` and `Debug` members) on top of the OpenPush Web SDK. A site written for
that SDK can move to OpenPush by changing its script tag and its worker file, and then move to
OpenPush's own API at its own pace.

The layer is optional. Sites that start with OpenPush use `OpenPush` directly (see the
[README](README.md)).

## 1. Create the OpenPush app

In the OpenPush console, create an app, set up web push for your site's exact address, and copy
the App ID. Use the OpenPush App ID in place of the old one in your `init` call.

## 2. Change the script tag

Replace the old SDK's script tag with the compatibility layer, served next to the OpenPush SDK:

```html
<script src="https://app.openpush.ai/sdk/web/v2/openpush-compat.js" defer></script>
```

`openpush-compat.js` loads `openpush.js` from beside itself (unless `window.OpenPush` is already on
the page), puts the compatibility object on `window.OneSignal`, and runs the callbacks queued on
`window.OneSignalDeferred`, in order. Callbacks pushed after `init` run at once. Items queued with
`OneSignal.push(...)`, the array queue of that SDK's previous major version, are run too.

With npm:

```js
import OneSignal, { installGlobals } from "@openpush/web/compat";

installGlobals(); // only if code on the page reads window.OneSignal or window.OneSignalDeferred
await OneSignal.init({ appId: "your-openpush-app-id" });
```

`@openpush/web/compat` shares the one SDK instance with `@openpush/web`, so both APIs can be used on
the same page while you migrate.

## 3. Change the worker file

Keep the worker file where it is (by default `/OneSignalSDKWorker.js` at the site root, or the
`serviceWorkerPath` your `init` call sets), and replace its contents with one line:

```js
importScripts("https://app.openpush.ai/sdk/web/v2/openpush-sw.js");
```

`serviceWorkerParam.scope` is kept as the worker scope.

## What maps

- **`init` options:** `appId`, `serviceWorkerPath`, `serviceWorkerParam`, `notifyButton` (the
  bell), `promptOptions.slidedown` (the slide-in, its topics, and the email or phone prompt),
  `promptOptions.customlink` (a placed subscribe button, rendered into the existing
  `onesignal-customlink-container` elements), `welcomeNotification`, `webhooks`,
  `notificationClickHandlerMatch`, `notificationClickHandlerAction`,
  `requiresUserPrivacyConsent`, `allowLocalhostAsSecureOrigin`, `autoResubscribe` and
  `persistNotification`. OpenPush's own option names (`serverUrl`, `logLevel`, `language`,
  `promptsLanguage`, `nonce`, `defaultUrl`, `defaultTitle`) are accepted too. When the app's web
  setup in the console is the typical setup, the console's settings win over code, as they do for
  OpenPush's own API.
- **Identity:** `login`, `logout`, `setConsentRequired`, `setConsentGiven`, `User.externalId`.
- **User data:** aliases, tags, `getTags`, `getLanguage`, email addresses, SMS numbers and
  `trackEvent`.
- **Push subscription:** `User.PushSubscription.id`, `token`, `optedIn`, `optIn()`, `optOut()` and
  its `change` event.
- **Notifications:** `permission`, `permissionNative`, `isPushSupported()`, `requestPermission()`,
  `setDefaultUrl()`, `setDefaultTitle()`, and the `click`, `foregroundWillDisplay`, `dismiss`,
  `permissionChange` and `permissionPromptDisplay` events.
- **Slidedown:** `promptPush()`, `promptPushCategories()`, `promptEmail()`, `promptSms()`,
  `promptSmsAndEmail()` and the `slidedownShown` event.
- **Session and Debug:** `sendOutcome()`, `sendUniqueOutcome()` and `setLogLevel()`.

## What does not

- `User.onesignalId` is always `null`, with one warning per page. Use `User.externalId` for the
  person, or `User.PushSubscription.id` for this browser.
- `safari_web_id`, `notifyButton.prenotify` and `notifyButton.showCredit` are accepted and ignored
  (logged once at info level).
- Other `init` options are ignored, with one warning that names them.
- Methods that SDK removed in its current major version (for example `getUserId`, `sendTags`,
  `setExternalUserId`, `isPushNotificationsEnabled`, `on`/`off`/`once`) log one warning naming
  the replacement and do nothing.
- An event name the layer does not map logs one warning; its listener never fires.
- An email or phone prompt without consent wording shows OpenPush's default consent line, with one
  warning: set your own wording in the OpenPush console.

## Moving to the OpenPush API

`window.OpenPush` (or `import OpenPush from "@openpush/web"`) is on the same page and holds the same
state, so calls can move over one at a time. When none are left, replace `openpush-compat.js` with
`openpush.js` and the worker file with `openpush-sw.js` (see the [README](README.md)).

## Trademark

OneSignal is a trademark of OneSignal, Inc. OpenPush is not affiliated with, endorsed by, or
sponsored by OneSignal, Inc. The OneSignal name appears only to describe the compatibility layer
for sites migrating from the OneSignal Web SDK.
