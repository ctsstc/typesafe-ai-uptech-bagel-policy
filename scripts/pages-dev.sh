#!/usr/bin/env bash
# Serve the Pages Function (plus an asset directory) with wrangler on http://localhost:8788.
# Usage: scripts/pages-dev.sh [asset dir relative to apps/web, default: public] [wrangler args...]
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
web="$root/apps/web"
assets="${1:-public}"
[[ $# -gt 0 ]] && shift

# Wrangler reads local secrets from .dev.vars beside wrangler.jsonc. A gitignored symlink keeps
# the key in the root .env only; with no root .env the Function runs in mock mode.
if [[ -f "$root/.env" && ! -e "$web/.dev.vars" && ! -L "$web/.dev.vars" ]]; then
  ln -s ../../.env "$web/.dev.vars"
fi

if [[ ! -d "$web/$assets" ]]; then
  echo "pages-dev: $web/$assets does not exist (run the web build first?)" >&2
  exit 1
fi

cd "$web"
exec pnpm exec wrangler pages dev "$assets" --kv RULINGS --show-interactive-dev-session=false "$@"
