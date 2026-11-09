# OpenPush Web SDK

Web push for your site with [OpenPush](https://openpush.ai): one script tag, or one npm package.

This repository holds the page SDK, the service worker code, the prompt UI, the npm package
`@openpush/web`, the framework wrappers `@openpush/react`, `@openpush/vue` and
`@openpush/angular`, and the OpenPush WordPress plugin.

You need an OpenPush app with web push set up for your site's address. The app's web setup page
in the OpenPush console gives you the App ID and the exact tags for your site.

## Where the files come from

- **Script tag:** the OpenPush server serves the SDK files at `https://app.openpush.ai/sdk/web/v2/`,
  which always has the newest release, and each release at `https://app.openpush.ai/sdk/web/<x.y.z>/`
  (for example `/sdk/web/1.1.0/`), which never changes once released. A self-hosted OpenPush server
  serves them at the same paths on its own address.
- **npm:** the packages are not on the npm registry yet. Until they are, build them from this
  repository (see [Develop](#develop)) and install the tarballs that `npm pack` writes.

## Script tag

```html
<script src="https://app.openpush.ai/sdk/web/v2/openpush.js" defer></script>
<script>
  window.OpenPushDeferred = window.OpenPushDeferred || [];
  OpenPushDeferred.push(async function (OpenPush) {
    await OpenPush.initialize({ appId: "your-app-id" });
  });
</script>
```

## The worker file

Your site hosts one file, `/openpush-sw.js`, on its own origin:

```js
importScripts("https://app.openpush.ai/sdk/web/v2/openpush-sw.js");
```

With npm, the worker command writes it into your public folder:

```sh
npx @openpush/web worker public
```

`--origin` is where the SDK files are served (default `https://app.openpush.ai`; a self-hosted
server uses its own address).
`--force` replaces an existing file. Bundlers that copy files can use `@openpush/web/sw`, the full
worker code.

## npm

```sh
npm install @openpush/web
```

```js
import OpenPush from "@openpush/web";

await OpenPush.initialize({ appId: "your-app-id" });
```

`require("@openpush/web")` returns the same object. The prompt UI loads from
`https://app.openpush.ai/sdk/web/<version>/` the first time a prompt shows; to bundle it instead,
add `import "@openpush/web/prompts";`.

A self-hosted OpenPush server: pass `serverUrl: "https://your-openpush-server"` to `initialize`.

Framework wrappers: [`packages/react`](packages/react), [`packages/vue`](packages/vue) and
[`packages/angular`](packages/angular), each with its own README.

## Moving from another push SDK

The compatibility layer (`openpush-compat.js` for the script tag, `@openpush/web/compat` on npm)
lets a site written for another push SDK's web API run on OpenPush with its script tag and worker
file changed. See [MIGRATING-FROM-ONESIGNAL.md](MIGRATING-FROM-ONESIGNAL.md).

## The upgrade bridge

`dist/cdn/bridge/openpush.js` and `bridge/openpush-sw.js` are the Web SDK with the calls of the old
web SDK (Firebase) (`init`, `requestPermission`, `login`, `logout`, `getSubscriptionId`, `onClick`,
`onBackground`), so a site on the Firebase web SDK moves to direct web push with no code change. Two
differences from the Firebase web SDK: `logout()` also detaches the user on the OpenPush server,
and a link code passed to `requestPermission({ linkCode })` is not sent (the call logs a warning
instead).

## WordPress plugin

[`integrations/wordpress/openpush/`](integrations/wordpress/openpush) is the OpenPush WordPress
plugin. It adds the script tag and the initialize snippet to every page, serves the worker file
from its own `worker/` folder (scope: that folder), and can send a push when a post is first
published. The plugin is licensed under GPL-2.0-or-later, like WordPress; see its
[LICENSE](integrations/wordpress/openpush/LICENSE).

## Develop

Node.js 20 or newer.

```sh
npm ci
npm run typecheck
npm run build     # dist/cdn, dist/npm, the size check, then the wrappers in packages/*/dist
npm test          # Vitest; some tests check the built files, so build first
npm pack          # @openpush/web; run it in packages/<name> for a wrapper
```

`npm run build` fails when a script-tag file is over its gzip budget:
`openpush.js` 30 KB, `openpush-prompts.js` 25 KB, `openpush-sw.js` 15 KB, `openpush-compat.js` 8 KB,
and the upgrade bridge's `bridge/openpush.js` 30 KB and `bridge/openpush-sw.js` 15 KB.

The WordPress plugin (needs PHP 8.4 or newer and Composer for its tools; the plugin itself runs on
PHP 7.4 or newer):

```sh
npm run build:wordpress   # dist/openpush-wordpress.zip, the plugin without its dev files
npm run lint:wordpress    # php -l and WordPress Coding Standards
cd integrations/wordpress/openpush && composer test   # PHPUnit
```

`scripts/check-public-content.sh` checks every tracked file for content that must not be
published (local paths, internal hosts, secrets, email addresses); CI runs it on every change.

## Layout

- `src/core` — the SDK object, `initialize` and its steps, options, config bootstrap, consent
- `src/push`, `src/user`, `src/session`, `src/events`, `src/verify` — the public API behind it
- `src/prompts` — the prompt UI (`openpush-prompts.js`) and its loader
- `src/worker` — the service worker (`openpush-sw.js`) and worker registration
- `src/compat` — the compatibility layer (`openpush-compat.js`, `@openpush/web/compat`)
- `src/bridge` — the upgrade bridge build
- `src/env`, `src/storage`, `src/net`, `src/log` — feature detection, storage, HTTP and the write queue, logs
- `src/cdn`, `src/npm` — the script tag and npm entries
- `bin/openpush-web.mjs` — the worker-file command
- `packages/*` — the framework wrappers
- `integrations/wordpress/openpush` — the WordPress plugin

## Browser storage

IndexedDB database `openpush-web-sdk` (stores `cfg`, `state`, `queue`, `clicks`) and the
localStorage keys `openpush.prompts`, `openpush.session` and `openpush.debug`. No cookies.
Nothing is stored before consent when consent is required.

## Contributing and security

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). Report
security problems privately, as [SECURITY.md](SECURITY.md) describes.

## License and brand

The SDK is licensed under the Apache License 2.0 ([LICENSE](LICENSE)); the WordPress plugin under
GPL-2.0-or-later. See [NOTICE](NOTICE) for the copyright and trademark notices. The licence grants
no right to use the OpenPush name, marks, or branding.
