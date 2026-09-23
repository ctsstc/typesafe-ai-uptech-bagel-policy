# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- Bagel Review Board scaffold on the Cube Rule Oracle infra: a Vite + React SPA styled after the Uptech Studio Bagel Policy page and a Cloudflare Pages Function at `/api/rule`.
- One Jev call per order with 8 typed questions: bagel, cream cheese and worst topping tiers, sandwich and sun-dried tomato checks, an office outrage score, input kind and an abuse guard.
- Shareable links: the address bar carries `?order=`, opening a link rules on that order, back and forward follow history, and Share ruling and Copy link buttons sit under each card. Declined orders are kept out of the URL and get no share buttons.
- Edge and KV caching keyed by question set version, a per-IP rate limiter, and keyword mock rulings when no TypeSafe key is set.

### Known issues

- Jev reads some open-faced orders as sandwiches (`is_sandwich` 0.77 for "everything bagel with lox and capers"), which wrongly turns them into a Violation.
