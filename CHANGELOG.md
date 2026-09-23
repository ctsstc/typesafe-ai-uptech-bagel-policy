# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Bagel Review Board scaffold on the Cube Rule Oracle infra: a Vite + React SPA styled after the Uptech Studio Bagel Policy page and a Cloudflare Pages Function at `/api/rule`.
- One Jev call per order with 8 typed questions: bagel, cream cheese and worst topping tiers, sandwich and sun-dried tomato checks, an office outrage score, input kind and an abuse guard.
- Shareable links: the address bar carries `?order=`, opening a link rules on that order, back and forward follow history, and Share ruling and Copy link buttons sit under each card. Declined orders are kept out of the URL and get no share buttons.
- Edge and KV caching keyed by question set version, a per-IP rate limiter, and keyword mock rulings when no TypeSafe key is set.

- An eval of 190 labelled orders (`pnpm eval`): canon from the policy page and three office incidents, plus tune and holdout sets labelled by agent consensus. Every live eval call is logged and capped by a fixed budget. See `docs/eval.md`.

- Spend protection ported from the Cube Rule Oracle. A new ruling needs a Cloudflare Turnstile session, then passes per-session (60), per-client (150 a day, keyed by an HMAC of the IPv4 address or IPv6 /64) and daily (1,000) D1 caps before Jev is called, and the Function fails closed. Cached rulings never see a check.
- `pnpm dev:challenge`, `pnpm deploy:pages`, `pnpm migrate:remote` and `pnpm spend`, with the runbook in `docs/deploy.md`.

### Changed

- Question set 3. The toppings question no longer grades the bagel's own flavor or the cream cheese as a topping, the sandwich question treats bagels as open-faced unless the order says otherwise, and orders that tell the board what to rule are treated as nonsense. `THRESHOLDS.sandwich` is now 0.8. Verdict accuracy went from 43% to 94% on canon and from 56% to 97% on holdout.

- A sandwich is now a "Sandwich alert" under the verdict instead of forcing a Violation, so an otherwise proper bagel served closed keeps its real verdict.
