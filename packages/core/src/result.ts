import {
  type InputKindId,
  SECTION_IDS,
  SECTIONS,
  SEVERITY,
  type SectionId,
  type Severity,
  type VerdictId,
} from "./policy";
import { type PolicyResponse, THRESHOLDS } from "./questions";

export type SectionRuling = {
  readonly section: SectionId;
  readonly tier: string;
  readonly label: string;
  readonly severity: Severity | null;
  readonly confidence: number;
  readonly unsure: boolean;
};

export type RulingResult = {
  readonly kind: "ruling";
  readonly order: string;
  readonly verdict: VerdictId;
  readonly sections: readonly SectionRuling[];
  readonly sandwich: boolean;
  readonly sunDried: boolean;
  readonly outrage: number;
  readonly model: string;
};

export type OutOfScopeResult = {
  readonly kind: "out_of_scope";
  readonly order: string;
  readonly reason: Exclude<InputKindId, "bagel_order">;
  readonly model: string;
};

export type DeclinedResult = { readonly kind: "declined"; readonly model: string };

export type PolicyResult = RulingResult | OutOfScopeResult | DeclinedResult;

const VERDICT_BY_SEVERITY = Object.fromEntries(
  Object.entries(SEVERITY).map(([id, severity]) => [severity, id]),
) as Record<Severity, VerdictId>;

function sectionRuling(section: SectionId, response: PolicyResponse): SectionRuling {
  const answer = response.answers[section];
  const tiers: Record<string, { label: string; severity: Severity | null }> =
    SECTIONS[section].tiers;
  const tier = tiers[answer.choice];
  if (!tier) throw new Error(`Unknown ${section} tier: ${answer.choice}`);
  const top = answer.probabilities[answer.choice as keyof typeof answer.probabilities] ?? 0;
  return {
    section,
    tier: answer.choice,
    label: tier.label,
    severity: tier.severity,
    confidence: top,
    unsure: top < THRESHOLDS.unsure,
  };
}

// Sandwiches and sun-dried tomatoes are flags on the card, not part of the verdict.
export function verdictOf(severities: readonly (Severity | null)[]): VerdictId {
  const worst = Math.max(SEVERITY.proper, ...severities.map((s) => s ?? SEVERITY.proper));
  return VERDICT_BY_SEVERITY[worst as Severity];
}

export function toPolicyResult(order: string, response: PolicyResponse): PolicyResult {
  const { answers, model } = response;
  if (answers.is_abusive.noul >= THRESHOLDS.abusive) return { kind: "declined", model };

  const kind = answers.input_kind.choice;
  if (kind !== "bagel_order") return { kind: "out_of_scope", order, reason: kind, model };

  const sections = SECTION_IDS.map((id) => sectionRuling(id, response));
  const sandwich = answers.is_sandwich.noul >= THRESHOLDS.sandwich;

  return {
    kind: "ruling",
    order,
    verdict: verdictOf(sections.map((s) => s.severity)),
    sections,
    sandwich,
    sunDried: answers.sun_dried_tomatoes.noul >= THRESHOLDS.sunDried,
    outrage: answers.outrage.score,
    model,
  };
}
