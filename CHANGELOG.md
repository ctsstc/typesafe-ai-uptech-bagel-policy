# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.2.1] - 2026-09-23

### Fixed

- Link previews no longer cut off the description: it is now 112 characters, under the roughly 125 that Slack, Discord and others show.

## [0.2.0] - 2026-09-23

### Added

- **Link previews.** Shared links unfurl with a ruling card for Exhibit A, a bagel with vanilla cream cheese ruled a Violation, drawn in the site's own style. Open Graph and Twitter tags carry absolute URLs, and there is a home screen icon. `pnpm --filter @bagel/web og` re-renders both from `apps/web/og/`.
- **The founding incident.** The vanilla cream cheese chip is labelled "Where it all began", and any ruling on a vanilla cream cheese Jev grades as sweet gets a Precedent callout linking the policy.

## [0.1.0] - 2026-09-23

First production release, live at https://bagel-review-board.pages.dev.

### Added

- **Rulings.** Describe a bagel order and Jev rules on it under the Uptech Studio Bagel Policy: one call with 8 typed questions for the bagel, cream cheese and worst topping tiers, sandwich and sun-dried tomato flags, the input kind, an abuse guard and how scandalized the office would be. The worst tier sets the verdict, and a sandwich shows as a "Sandwich alert" without changing it.
- **Share links.** The address bar carries `?order=`, opening a link rules on that order, back and forward follow history, and Share ruling and Copy link buttons sit under each card.
- **Look.** Navy, Mulish and sky blue buttons after the policy page, with light and dark themes and no Uptech logos or images.
- **Examples.** Seven example orders to tap, led by the vanilla cream cheese incident the policy was written after, and one for each verdict.
- **Credits.** The footer says it is made by an Uptech employee, not an official Uptech product, credits the author, Claude Code and TypeSafe, links the source, and shows the app version, question set and model.
- **Eval.** 190 labelled orders (`pnpm eval`): canon from the policy page and three office incidents, plus tune and holdout orders built around ingredients the policy never names and labelled by agent consensus. Question set 3 rules 48/51 canon, 68/76 tune and 61/63 holdout orders right. Every live eval call is logged against a fixed budget.
- **Tooling.** `pnpm dev:challenge`, `pnpm deploy:pages`, `pnpm migrate:remote` and `pnpm spend`, with the runbook in `docs/deploy.md`.

### Security

- A new ruling needs a Cloudflare Turnstile session, then passes per-session (60), per-client (150 a day, keyed by an HMAC of the IPv4 address or IPv6 /64) and daily (1,000) D1 caps before Jev is called. The Function fails closed, and cached rulings never see a check.
- The TypeSafe key stays server side. A test fails if the production bundle contains the TypeSafe API host, the SDK or question text.
- The deploy script only targets the Cloudflare account in the root `.env`, and refuses to run while the linked source repo is not public.
