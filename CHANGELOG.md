# Changelog

All notable changes to the OpenPush Web SDK (`@openpush/web`, `@openpush/react`, `@openpush/vue`,
`@openpush/angular`) will be documented in this file. The WordPress plugin keeps its own changelog
in `integrations/wordpress/openpush/readme.txt`.

The project uses [Semantic Versioning](https://semver.org/).

## 1.2.0

- New `requestHeaders` option for `initialize`: an object, or a function (sync or async) that the
  SDK calls before each request, whose headers are added to the SDK's requests to the OpenPush
  server (registration, opt-in and opt-out, user, session, event and verify calls, and delivery
  receipts). The public config request does not get them.
- Headers the SDK or the browser sets itself are refused with a console warning that names the
  header, never its value. Header values are never logged. A function that fails or takes longer
  than 5 seconds leaves the request without the extra headers.
- The service worker uses a copy of the headers kept in the site's IndexedDB, so receipts sent when
  no page is open carry them too. The copy follows the option at each `initialize` and is removed
  by `logout()`.
- `RequestHeadersOption` is exported from `@openpush/web`, and the compatibility layer passes the
  option through.

## 1.1.0

First public release. The first version is 1.1.0 so that it never shares a version number with the
old web SDK (Firebase), which reported 1.0.0.

- One script tag (`openpush.js`) or one npm package (`@openpush/web`, ES modules and CommonJS,
  with types), configured from the OpenPush console or in code.
- Push subscription: permission, opt-in and opt-out, page-load reconciliation, automatic
  resubscription, and a status model with change observers.
- The service worker (`openpush-sw.js`): display, action buttons, click handling and delivery
  receipts, behind a one-line worker file the site hosts; `npx @openpush/web worker` writes it.
- Prompts: a bell, a slide-in with topics, an email or phone prompt, a placed subscribe button,
  Home Screen guidance on iPhone and iPad, and the site verification bar, translated into 14
  languages and loaded only when a prompt shows.
- Users: login with optional identity verification, tags, aliases, email addresses, SMS and
  WhatsApp numbers, sessions and custom events.
- Consent: nothing is written before consent when consent is required.
- Framework wrappers for React and Next.js, Vue 3 and Angular.
- An optional compatibility layer for sites migrating from another push SDK, with a migration
  guide.
- The upgrade bridge, so sites on the old web SDK (Firebase) move to direct web push with no code
  change.
- A WordPress plugin (GPL-2.0-or-later).
