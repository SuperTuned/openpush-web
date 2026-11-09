# Contributing

Issues and pull requests are welcome. Everyone taking part is expected to follow the
[Code of Conduct](CODE_OF_CONDUCT.md). Report security problems privately, as
[SECURITY.md](SECURITY.md) describes, never in a public issue.

Before opening a pull request:

1. Add or update tests for changed behavior.
2. Run `npm ci`, `npm run typecheck`, `npm run build` (it fails when a script-tag file is over
   its size budget) and `npm test`.
3. For changes to the WordPress plugin, run `npm run lint:wordpress` and `composer test` in
   `integrations/wordpress/openpush`.
4. Run `scripts/check-public-content.sh`.
5. Update the changelog for user-visible changes.

By submitting a contribution, you agree that it may be distributed under the
repository's licences: the Apache License 2.0, or GPL-2.0-or-later for the
WordPress plugin in `integrations/wordpress/openpush`.

The licences grant no right to use the OpenPush name, marks, or branding. Forks
and derivatives must use their own name and branding.
