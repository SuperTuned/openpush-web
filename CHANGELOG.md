# Changelog

All notable changes to the OpenPush Web SDK (`@openpush/web`, `@openpush/react`, `@openpush/vue`,
`@openpush/angular`) will be documented in this file. The WordPress plugin keeps its own changelog
in `integrations/wordpress/openpush/readme.txt`.

The project uses [Semantic Versioning](https://semver.org/).

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
