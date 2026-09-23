#!/usr/bin/env bash
# Run the local stack with the human check on, using Cloudflare's public Turnstile test keys.
# Usage: scripts/dev-challenge.sh [pass|fail|interactive|spent] [--preview]
#   pass         invisible check that always passes (default)
#   fail         the widget always fails, so the SPA shows the check error
#   interactive  forces a visible "verify you are human" checkbox
#   spent        the widget passes but siteverify says the token was already used
#   --preview    build dist and serve it with _headers (the production CSP) instead of Vite
# DAILY_CALL_LIMIT=1 scripts/dev-challenge.sh makes the daily cap easy to hit.
# The Function runs in mock mode unless the root .env has TYPESAFE_API_KEY. Mock rulings are
# challenged too, so the whole flow works without spending anything.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
mode="pass"
preview=0
for arg in "$@"; do
  case "$arg" in
    pass | fail | interactive | spent) mode="$arg" ;;
    --preview) preview=1 ;;
    *)
      sed -n '2,11p' "${BASH_SOURCE[0]}" >&2
      exit 1
      ;;
  esac
done

# https://developers.cloudflare.com/turnstile/troubleshooting/testing/
case "$mode" in
  pass) sitekey="1x00000000000000000000AA" secret="1x0000000000000000000000000000000AA" ;;
  fail) sitekey="2x00000000000000000000AB" secret="2x0000000000000000000000000000000AA" ;;
  interactive) sitekey="3x00000000000000000000FF" secret="1x0000000000000000000000000000000AA" ;;
  spent) sitekey="1x00000000000000000000AA" secret="3x0000000000000000000000000000000AA" ;;
esac

bindings=(
  --binding "TURNSTILE_SECRET_KEY=$secret"
  --binding "SESSION_SECRET=$(openssl rand -hex 32)"
)
if [[ -n "${DAILY_CALL_LIMIT:-}" ]]; then
  [[ "$DAILY_CALL_LIMIT" =~ ^[0-9]+$ ]] || {
    echo "dev-challenge: DAILY_CALL_LIMIT must be a whole number" >&2
    exit 1
  }
  bindings+=(--binding "DAILY_CALL_LIMIT=$DAILY_CALL_LIMIT")
fi

cd "$root"
export VITE_TURNSTILE_SITE_KEY="$sitekey"
echo "dev-challenge: $mode keys, sitekey $sitekey" >&2

if ((preview)); then
  pnpm --filter @bagel/web build
  exec bash scripts/pages-dev.sh dist "${bindings[@]}"
fi

# concurrently takes each command as one string, so the bindings must stay free of spaces.
exec pnpm exec concurrently --kill-others --names api,web --prefix-colors cyan,magenta \
  "bash scripts/pages-dev.sh public ${bindings[*]}" \
  "pnpm --filter @bagel/web exec vite"
