# Bagel Review Board

Describe a bagel order and get a ruling under the [Uptech Studio Bagel Policy](https://www.uptechstudio.com/bagels). Jev, a model from [TypeSafe](https://typesafe.ai/), sorts the bagel, the cream cheese and the worst topping into the policy's tiers, then flags sandwiches and sun-dried tomatoes. The worst tier sets the verdict: Proper, Acceptable, Borderline, Violation or Just stop.

> [!NOTE]
> This is an unofficial fan app. It is not affiliated with or endorsed by Uptech Studio or TypeSafe.

## Quick start

```sh
pnpm i
cp .env.example .env
pnpm dev
```

With `TYPESAFE_API_KEY` empty, the Function serves keyword-based mock rulings and the card is marked simulated.

## Layout

```text
packages/core/   Policy tiers, Jev questions, input normalization, result mapping, mock, wire types
apps/web/        React SPA, Pages Function (functions/api/rule.ts), Vite mock API plugin
scripts/         pages-dev.sh (local wrangler)
```

Infra is adapted from [typesafe-ai-cube-rule](https://github.com/ctsstc/typesafe-ai-cube-rule).
