# Bagel Review Board

Describe a bagel and TypeSafe's Jev model rules on it under the [Uptech Studio Bagel Policy](https://www.uptechstudio.com/bagels). Built on the same infra as [typesafe-ai-cube-rule](https://github.com/ctsstc/typesafe-ai-cube-rule): a Vite + React SPA and a Cloudflare Pages Function for `/api`, live at https://bagel-review-board.pages.dev. Styling takes its cues from the policy page (navy `#002133`, Mulish at weight 900, sky blue buttons) but uses no Uptech logos or images.

## TypeSafe / Jev

- Jev is a **System One** model. It takes `state` plus typed questions (Choice, Score, Noul) and returns probabilities, never text.
- All questions live in `packages/core/src/questions.ts` and thresholds sit beside them. Bump `QUESTION_SET_VERSION` when a question changes: it is part of the cache key.
- `TYPESAFE_API_KEY` is server side only. Locally it lives in the root `.env` (symlinked to `apps/web/.dev.vars` by `scripts/pages-dev.sh`); in production it is a Pages secret. It must never reach the bundle, a commit or a log line.

## Hosting

- One classic Cloudflare Pages project, `bagel-review-board`, with KV (`RULINGS`), D1 (`DB`, database `bagel-review-board`) and a Turnstile widget. [docs/deploy.md](docs/deploy.md) is the runbook.
- New rulings need a Turnstile session and pass per-session, per-client and daily D1 caps before Jev is called. The Function fails closed.
- `scripts/deploy.sh` pins the Cloudflare account from the root `.env`. Deploy only to this project; never AWS.
- The committed `apps/web/wrangler.jsonc` keeps placeholder KV and D1 ids. The real ones live in the root `.env` and reach wrangler through the gitignored `wrangler.production.jsonc`.

## Commands

- `pnpm dev` runs Vite (5173) and the Function (8788). `pnpm --filter @bagel/web dev:mock` serves keyword mock rulings from Vite alone; type `mock 429` and friends for error states.
- `pnpm check` runs typecheck, Biome and Vitest.
- `pnpm dev:challenge [pass|interactive|fail|spent] [--preview]` runs `pnpm dev` with the human check on, using Cloudflare's test keys.
- `pnpm deploy:pages` is the guarded production deploy. Bare `pnpm deploy` is pnpm's own command and does not run it.
- `pnpm migrate:remote` applies new D1 migrations to production. `pnpm spend [--detail]` prints a read-only spend report from the production D1 counters.
- `pnpm eval` runs the labelled order set against Jev (see `docs/eval.md`). `pnpm eval -- --offline` rescores the cache for free; `--split=tune` limits live calls to one split.

## Eval spend

- Every live eval call is logged to `eval/results/spend.jsonl`. The runner refuses a run over `--max-usd` (default $0.05) or one that would push the ledger past `TOTAL_BUDGET_USD` in `eval/src/run.ts`. Raise that constant only when the user agrees to.
- Tune against the tune split only. Look at holdout once per finished candidate and never iterate on its failures.
- Never add a tune or holdout item's `novel` term to the questions. The dataset test fails if one leaks.

## Git workflow

- Commit whenever a coherent unit of progress lands: a feature, a fix, a refactor, docs, infra. Do not batch a whole session into one commit, and do not commit broken builds.
- Use [Conventional Commits](https://www.conventionalcommits.org/): `feat:`, `fix:`, `docs:`, `chore:`, `refactor:`, `test:`, `ci:`, `build:`. Optional scope, e.g. `feat(web): ...`.
- Stage explicit paths, never `git add -A` blindly. Check `git status` for `.env`, `.dev.vars` or `.wrangler/` before every commit.
- Run `pnpm check` (typecheck, lint, tests) before committing code. CI (`.github/workflows/ci.yml`) runs it on every push to main and every pull request, with no secrets and no `.env`.
- Commit messages may become public if the repo is published: no secrets, local paths or machine details.

## Releases

- Tag releases with annotated semver tags: `git tag -a vX.Y.Z -m "vX.Y.Z: <summary>"`.
- Every tag gets a matching entry in `CHANGELOG.md` (Keep a Changelog format), committed before tagging.
- Bump `version` in the root `package.json` to match the tag.
- Semver: MINOR for user-visible features, PATCH for fixes and polish. MAJOR only for a breaking change to the API contract or share links.
- Tag after a milestone is committed and `pnpm check` passes, not before.
- Release order: tag, push `main` and the tag (never `--all` or `--mirror`), apply new D1 migrations with `pnpm migrate:remote`, `pnpm deploy:pages`, then `gh release create vX.Y.Z` with that version's CHANGELOG section as the notes. Until the GitHub repo exists, skip the push and the GitHub release.
