import {
  type InputKindId,
  type PolicyAnswers,
  type SectionId,
  THRESHOLDS,
  toPolicyResult,
  type VerdictId,
} from "@bagel/core";
import type { RawRecord } from "./cache";
import type { LabelledItem, Split } from "./dataset";

// TypeSafe's published price for jev (https://docs.typesafe.ai/models.md). Output tokens are free.
export const PRICE_PER_MILLION_INPUT_USD = 0.042;

export interface FieldOutcome {
  readonly expected: readonly string[];
  readonly got: string;
  readonly p: number;
  readonly correct: boolean;
}

export interface Outcome {
  readonly order: string;
  readonly split: Split;
  readonly source: LabelledItem["source"];
  readonly expectedKind: InputKindId;
  readonly kind: InputKindId;
  readonly kindCorrect: boolean;
  readonly abusive: number;
  readonly declined: boolean;
  readonly fields: Partial<Record<SectionId, FieldOutcome>>;
  readonly sandwich: { readonly expected: boolean | "either"; readonly p: number } | null;
  readonly sandwichCorrect: boolean | null;
  readonly expectedVerdicts: readonly VerdictId[] | null;
  readonly verdict: VerdictId | null;
  readonly correct: boolean;
  readonly inputTokens: number;
  readonly latencyMs: number;
}

function field(section: SectionId, answers: PolicyAnswers, expected: readonly string[]) {
  const answer = answers[section];
  const probabilities = answer.probabilities as Record<string, number>;
  return {
    expected,
    got: answer.choice,
    p: probabilities[answer.choice] ?? 0,
    correct: expected.includes(answer.choice),
  };
}

export function scoreItem(item: LabelledItem, record: RawRecord): Outcome {
  const { answers } = record;
  const result = toPolicyResult(item.order, { model: record.model, answers });
  const kind = answers.input_kind.choice;
  const labels = item.labels;
  const fields: Partial<Record<SectionId, FieldOutcome>> = labels
    ? {
        bagel: field("bagel", answers, labels.bagel),
        spread: field("spread", answers, labels.spread),
        toppings: field("toppings", answers, labels.toppings),
      }
    : {};
  const sandwichP = answers.is_sandwich.noul;
  const sandwichCorrect = labels
    ? labels.sandwich === "either" || labels.sandwich === sandwichP >= THRESHOLDS.sandwich
    : null;
  const verdict = result.kind === "ruling" ? result.verdict : null;
  const correct = labels
    ? verdict !== null && labels.verdicts.includes(verdict)
    : result.kind === "out_of_scope" && result.reason === item.kind;

  return {
    order: item.order,
    split: item.split,
    source: item.source,
    expectedKind: item.kind,
    kind,
    kindCorrect: kind === item.kind,
    abusive: answers.is_abusive.noul,
    declined: result.kind === "declined",
    fields,
    sandwich: labels ? { expected: labels.sandwich, p: sandwichP } : null,
    sandwichCorrect,
    expectedVerdicts: labels?.verdicts ?? null,
    verdict,
    correct,
    inputTokens: record.usage.input_tokens,
    latencyMs: record.latencyMs,
  };
}

/** Whether the sandwich flag would be right at another threshold, for the sweep. */
export function sandwichRightAt(outcome: Outcome, threshold: number): boolean | null {
  if (!outcome.sandwich) return null;
  const { expected, p } = outcome.sandwich;
  return expected === "either" || expected === p >= threshold;
}

export interface Rate {
  readonly right: number;
  readonly n: number;
}

export const rate = (flags: readonly boolean[]): Rate => ({
  right: flags.filter(Boolean).length,
  n: flags.length,
});

export const pct = ({ right, n }: Rate): string =>
  n === 0 ? "n/a" : `${((100 * right) / n).toFixed(1)}% (${right}/${n})`;

export interface SplitSummary {
  readonly n: number;
  readonly verdict: Rate;
  readonly kind: Rate;
  readonly bagel: Rate;
  readonly spread: Rate;
  readonly toppings: Rate;
  readonly sandwich: Rate;
}

function splitSummary(outcomes: readonly Outcome[]): SplitSummary {
  const orders = outcomes.filter((o) => o.expectedKind === "bagel_order");
  const fieldRate = (id: SectionId) => rate(orders.map((o) => o.fields[id]?.correct ?? false));
  return {
    n: outcomes.length,
    verdict: rate(outcomes.map((o) => o.correct)),
    kind: rate(outcomes.map((o) => o.kindCorrect)),
    bagel: fieldRate("bagel"),
    spread: fieldRate("spread"),
    toppings: fieldRate("toppings"),
    sandwich: rate(orders.map((o) => o.sandwichCorrect ?? false)),
  };
}

const SWEEP = [0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9] as const;

export interface Summary {
  readonly questionSetVersion: string;
  readonly model: string;
  readonly fingerprint: string;
  readonly datasetSize: number;
  readonly missing: number;
  readonly splits: Record<Split | "all", SplitSummary>;
  readonly sandwichSweep: readonly { threshold: number; tune: Rate; canon: Rate }[];
  readonly maxAbusive: number | null;
  readonly declines: number;
  readonly avgInputTokens: number | null;
  readonly p50LatencyMs: number | null;
  readonly costPerPassUsd: number | null;
}

export function costUsd(inputTokens: number): number {
  return (inputTokens * PRICE_PER_MILLION_INPUT_USD) / 1e6;
}

export function summarize(
  outcomes: readonly Outcome[],
  meta: Pick<Summary, "questionSetVersion" | "model" | "fingerprint" | "datasetSize">,
): Summary {
  const by = (split: Split) => outcomes.filter((o) => o.split === split);
  const sweepRate = (items: readonly Outcome[], threshold: number) =>
    rate(
      items.flatMap((o) => {
        const right = sandwichRightAt(o, threshold);
        return right === null ? [] : [right];
      }),
    );
  const tokens = outcomes.map((o) => o.inputTokens);
  const avg = tokens.length ? tokens.reduce((a, b) => a + b, 0) / tokens.length : null;
  const latencies = outcomes.map((o) => o.latencyMs).sort((a, b) => a - b);
  return {
    ...meta,
    missing: meta.datasetSize - outcomes.length,
    splits: {
      canon: splitSummary(by("canon")),
      tune: splitSummary(by("tune")),
      holdout: splitSummary(by("holdout")),
      all: splitSummary(outcomes),
    },
    sandwichSweep: SWEEP.map((threshold) => ({
      threshold,
      tune: sweepRate(by("tune"), threshold),
      canon: sweepRate(by("canon"), threshold),
    })),
    maxAbusive: outcomes.length ? Math.max(...outcomes.map((o) => o.abusive)) : null,
    declines: outcomes.filter((o) => o.declined).length,
    avgInputTokens: avg === null ? null : Math.round(avg),
    p50LatencyMs: latencies.length ? (latencies[Math.floor(latencies.length / 2)] ?? null) : null,
    costPerPassUsd: avg === null ? null : Number(costUsd(avg * meta.datasetSize).toFixed(6)),
  };
}
