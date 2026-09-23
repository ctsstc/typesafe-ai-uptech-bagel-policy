# Bagel Review Board

Describe a bagel and TypeSafe's Jev model rules on it under the [Uptech Studio Bagel Policy](https://www.uptechstudio.com/bagels). Built on the same infra as [typesafe-ai-cube-rule](https://github.com/ctsstc/typesafe-ai-cube-rule): a Vite + React SPA and a Cloudflare Pages Function for `/api`. Styling takes its cues from the policy page (navy `#002133`, Mulish at weight 900, sky blue buttons) but uses no Uptech logos or images.

## TypeSafe / Jev

- Jev is a **System One** model. It takes `state` plus typed questions (Choice, Score, Noul) and returns probabilities, never text.
- All questions live in `packages/core/src/questions.ts` and thresholds sit beside them. Bump `QUESTION_SET_VERSION` when a question changes: it is part of the cache key.
- `TYPESAFE_API_KEY` is server side only. Locally it lives in the root `.env` (symlinked to `apps/web/.dev.vars` by `scripts/pages-dev.sh`). It must never reach the bundle, a commit or a log line.

## Commands

- `pnpm dev` runs Vite (5173) and the Function (8788). `pnpm --filter @bagel/web dev:mock` serves keyword mock rulings from Vite alone; type `mock 429` and friends for error states.
- `pnpm check` runs typecheck, Biome and Vitest.

## Not ported yet

Do not deploy until these land from the cube project: the Turnstile session (`functions/_lib/session.ts`), D1 spend caps (`usage.ts` and migrations), `scripts/deploy.sh` with its account guard, and an eval set.

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
- Release order: tag, push `main` and the tag (never `--all` or `--mirror`), then deploy once the deploy script exists, then `gh release create vX.Y.Z` with that version's CHANGELOG section as the notes.
