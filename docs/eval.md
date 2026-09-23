# Evaluation

A labelled order set and a harness that asks Jev every question in `@bagel/core` for each order, then scores the app's own ruling (`toPolicyResult`) against the labels. The process copies the [Cube Rule Oracle's](https://github.com/ctsstc/typesafe-ai-cube-rule/blob/main/docs/eval.md) in a lighter form.

| Path | Holds |
|---|---|
| `eval/data/orders.json` | The labelled orders |
| `eval/src/dataset.ts` | Loader, validation, splits and the novel-term leak check |
| `eval/src/run.ts` | The `pnpm eval` runner: budget checks, live calls, cache, report |
| `eval/src/score.ts`, `report.ts` | Scoring, the sandwich threshold sweep and the Markdown report |
| `eval/results/v<version>/` | `raw.jsonl`, `report.md` and `summary.json` for one question set |
| `eval/results/spend.jsonl` | One line per live run: calls, input tokens and dollars |

## Running it

| Command | Does |
|---|---|
| `pnpm eval` | Calls Jev for every order without a cached answer for the current `QUESTION_SET_VERSION` |
| `pnpm eval -- --split=tune` | Live calls for the named splits only (`canon`, `tune`, `holdout`, comma-separated) |
| `pnpm eval -- --offline` | Rescores the cache for free. Use it after changing `THRESHOLDS` |
| `pnpm eval -- --fresh` | Refetches everything for the current version |
| `pnpm eval -- --max-usd=0.02` | Per-run cap. The default is $0.05 |

> [!IMPORTANT]
> The runner refuses any run that would push the ledger in `spend.jsonl` past `TOTAL_BUDGET_USD` ($0.25) in `eval/src/run.ts`. A full pass over 190 orders on question set 3 costs about $0.022 (2,795 input tokens a call at $0.042 per million).

The cache is keyed by `QUESTION_SET_VERSION` and a SHA-256 fingerprint of the request, so a question edit without a version bump fails loudly instead of reusing stale answers.

## The dataset

| Source | Split | Meaning |
|---|---|---|
| `policy` | canon | An item the [policy page](https://www.uptechstudio.com/bagels) names, written as a minimal order |
| `incident` | canon | An office incident under the policy, described only by the order |
| `consensus` | tune or holdout | An order built around an ingredient the policy never names, listed in `novel` |
| `probe` | tune or holdout | Input-gate and sandwich phrasing tests: open face, clear sandwiches, bagel-adjacent foods, gibberish, injections, typos |

Each bagel order labels `bagel`, `spread`, `toppings` and `sandwich` (`true`, `false` or `"either"`). A field may list several tiers when more than one is defensible. The expected verdicts are every verdict that some accepted combination of bagel, spread and toppings produces under `verdictOf`, so labels and the app can never disagree about the rule. The sandwich flag is scored on its own column and does not affect the verdict.

A non-canon order goes to tune when the FNV-1a hash of its text mod 100 is below 60, otherwise holdout.

> [!WARNING]
> A consensus order's `novel` terms must never appear in the questions. `dataset.test.ts` and the runner both fail if one does, because it would turn a test of generalization into a lookup.

### How the consensus and probe labels were made

A workflow of six agents on 2026-09-23. Three drafters each wrote about 45 orders from one angle (bagel and cream cheese flavors, toppings, probes) and labelled them. Three labellers then labelled the merged list blind, each through a different lens. An order was kept only when at least 3 of the 4 votes agreed on its input kind and every field had a value with at least 2 votes. A 2 to 2 split became an accepted alternative. All 139 candidates passed, 135 of them unanimous.

The four voters worked from the same written conventions, so the labels encode the policy plus these product calls:

- Only cream cheese is judged as the spread. Butter, hummus, jam and nut butters are toppings or nothing.
- A topping is something added to the cut bagel. Flavors baked into the dough or mixed into the cream cheese never are.
- Unknown ingredients go by analogy: smoked or cured fish, onions and fresh herbs lean acceptable, meats, eggs and cheeses borderline, other vegetables no, anything sweet just stop.
- An order is a sandwich only when it says so, names a sandwich, or stacks sandwich fillings on a bagel. A bagel "with" toppings is open-faced.
- An instruction or claim about what the verdict should be makes the whole order nonsense.

One label was changed by hand: the sun-dried tomato bagel accepts proper or acceptable, since the policy calls sun-dried tomatoes not strictly proper as an ingredient.

## Results

| Split | v1 | v3 |
|---|---|---|
| Canon | 43.1% (22/51) | 94.1% (48/51) |
| Tune | 56.6% (43/76) | 89.5% (68/76) |
| Holdout | 55.6% (35/63) | 96.8% (61/63) |

Tuning looked only at tune. Holdout was read at the v1 baseline and once for the final candidate. Total eval spend for all of it: $0.049.

### Question set 1: baseline

Bagel and cream cheese questions were already about 98% right. Two questions caused almost every miss:

- **Toppings** assumed a topping existed, so it graded the bagel's own flavor (cinnamon raisin as just stop, onion bagel as acceptable) and the cream cheese flavor (honey as just stop).
- **Sandwich** scored nearly every "bagel with cream cheese and X" between 0.5 and 0.85, turning proper orders into violations.

### Question set 2

- Toppings asks for the lowest tier among things added beyond the cream cheese, says the bagel's flavor and the cream cheese's flavor are never toppings, and lists tiers worst first.
- Sandwich defaults to open-faced and says yes only when the order calls it a sandwich, names one, says the top goes on, or stacks sandwich fillings.
- The input gate treats a claim that the verdict was already decided as nonsense.

Tune went from 43 to 59 of 76. Every flavor-as-topping failure was fixed. On tune, real sandwiches all scored 0.95 or higher and the false positives peaked at 0.69, so `THRESHOLDS.sandwich` moved from 0.5 to 0.8 (no version bump, rescored offline): 64 of 76.

### Question set 3

- Borderline names meat, egg and cheese, and the toppings rule says a classic topping never makes up for a worse one beside it.
- The input gate gained a `commands` instruction for orders that tell the app what to rule.

Tune reached 68 of 76. Fixed: ham and poached egg beside lox or red onion, kimchi, the injection and the bagel dog. Regressed: anchovies went from acceptable to borderline.

### Sandwich becomes a flag

A sandwich no longer pushes the verdict to violation. The card shows a "Sandwich alert" under the verdict instead, and the verdict comes from the bagel, cream cheese and toppings alone. This is a product call, not a question change, so v3 was rescored offline. The totals did not move (48/51, 68/76, 61/63): the holdout breakfast sandwich that scored 0.79 no longer fails, and a BLT whose violation had come only from the sandwich now does.

Known misses on v3:

- **egg bagel** (canon) reads "egg" as a topping and comes back borderline. Accepted as is: borderline is a fair reading.
- **Honey cream cheese** (canon) is still graded as a just stop topping on top of the sweet spread.
- **BLT on a bagel** (holdout) grades lettuce as borderline rather than misc vegetables.
- Jev does not know sable is a smoked fish or that a bialy is not a bagel.
