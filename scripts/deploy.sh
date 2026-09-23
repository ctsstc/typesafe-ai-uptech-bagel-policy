#!/usr/bin/env bash
# Production deploy of apps/web (SPA + Pages Function) to Cloudflare Pages. See docs/deploy.md.
set -euo pipefail

readonly PROJECT="bagel-review-board"
readonly BRANCH="main"
readonly DATABASE="bagel-review-board"
readonly SECRETS=(TYPESAFE_API_KEY TURNSTILE_SECRET_KEY SESSION_SECRET)

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
web="$root/apps/web"
cd "$root"

fail() {
  echo "deploy: $*" >&2
  exit 1
}

# One value from the gitignored root .env, parsed the way scripts/cloudflare-config.mjs parses it.
dotenv() {
  node --input-type=module -e '
    import { existsSync, readFileSync } from "node:fs";
    import { parseDotenv } from "./scripts/cloudflare-config.mjs";
    const text = existsSync(".env") ? readFileSync(".env", "utf8") : "";
    process.stdout.write(parseDotenv(text)[process.argv[1]] ?? "");
  ' "$1"
}

# The public Turnstile sitekey is baked into the SPA.
VITE_TURNSTILE_SITE_KEY="${VITE_TURNSTILE_SITE_KEY:-$(dotenv VITE_TURNSTILE_SITE_KEY)}"
# The deploy only ever targets this account, whatever wrangler is logged in to.
readonly ACCOUNT_ID="${CLOUDFLARE_ACCOUNT_ID:-$(dotenv CLOUDFLARE_ACCOUNT_ID)}"

[[ "$ACCOUNT_ID" =~ ^[0-9a-f]{32}$ ]] ||
  fail "set CLOUDFLARE_ACCOUNT_ID in the root .env to your Cloudflare account id ('wrangler whoami' shows it)."

wrangler() {
  (cd "$web" && pnpm exec wrangler "$@")
}

[[ -n "$VITE_TURNSTILE_SITE_KEY" ]] ||
  fail "VITE_TURNSTILE_SITE_KEY is not set, so the SPA could not pass the human check; see docs/deploy.md."
# Cloudflare's test sitekeys start with 1x, 2x or 3x and only mint dummy tokens a real secret rejects.
[[ ! "$VITE_TURNSTILE_SITE_KEY" =~ ^[123]x0+[A-F]{2}$ ]] ||
  fail "VITE_TURNSTILE_SITE_KEY is a Turnstile test key; use the production sitekey."
[[ -z "$(git status --porcelain)" ]] || fail "working tree is dirty; commit or remove changes first."
[[ "$(git branch --show-current)" == "$BRANCH" ]] || fail "production deploys run from $BRANCH only."

# Every remote command below uses the gitignored wrangler.production.jsonc, which carries the real
# KV and D1 ids from the root .env in place of the committed placeholders.
readonly PRODUCTION_CONFIG="wrangler.production.jsonc"
node "$root/scripts/cloudflare-config.mjs" >/dev/null || fail "could not write apps/web/$PRODUCTION_CONFIG."

export CLOUDFLARE_ACCOUNT_ID="$ACCOUNT_ID"

whoami_json="$(wrangler whoami --json 2>/dev/null)" ||
  fail "wrangler is not logged in; run 'pnpm --filter @bagel/web exec wrangler login'."
node -e '
  const { accounts = [] } = JSON.parse(require("node:fs").readFileSync(0, "utf8"));
  process.exit(accounts.some((account) => account.id === process.argv[1]) ? 0 : 1);
' "$ACCOUNT_ID" <<<"$whoami_json" || fail "wrangler is not logged in to account $ACCOUNT_ID."

# Without TYPESAFE_API_KEY production serves mock rulings. Without the other two, the Function
# either skips the human check or refuses every new ruling.
# Captured first: with pipefail, grep -q closing the pipe early could fail the check spuriously.
secrets="$(wrangler pages secret list --project-name "$PROJECT" 2>/dev/null)" ||
  fail "could not list Pages secrets for $PROJECT; does the project exist?"
for secret in "${SECRETS[@]}"; do
  grep -q "$secret" <<<"$secrets" || fail "Pages secret $secret is missing; see docs/deploy.md."
done

# The Function refuses new rulings until the spend-cap tables exist.
migrations="$(wrangler d1 migrations list "$DATABASE" --remote -c "$PRODUCTION_CONFIG" 2>&1)" ||
  fail "could not list D1 migrations for $DATABASE; see docs/deploy.md."
grep -q "No migrations to apply" <<<"$migrations" ||
  fail "D1 has unapplied migrations; run 'pnpm migrate:remote'."

pnpm check
echo "deploy: building with sitekey $VITE_TURNSTILE_SITE_KEY"
VITE_TURNSTILE_SITE_KEY="$VITE_TURNSTILE_SITE_KEY" pnpm --filter @bagel/web build

# Pages refuses a custom config path, so the upload swaps the real ids into wrangler.jsonc and puts
# the committed file back on exit, however the deploy ends.
trap 'git -C "$root" checkout -- apps/web/wrangler.jsonc' EXIT
cp "$web/$PRODUCTION_CONFIG" "$web/wrangler.jsonc"

# Run from apps/web: wrangler finds functions/ and wrangler.jsonc relative to its cwd.
wrangler pages deploy dist \
  --project-name "$PROJECT" \
  --branch "$BRANCH" \
  --commit-hash "$(git rev-parse HEAD)" \
  --commit-message "$(git log -1 --pretty=%s)"
