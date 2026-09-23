import type { PolicyResult } from "@bagel/core";

/** True when a ruling is about the vanilla cream cheese the policy was written after. */
export function isFoundingIncident(result: PolicyResult): boolean {
  if (result.kind !== "ruling" || !/\bvanilla\b/.test(result.order)) return false;
  return result.sections.some((s) => s.section === "spread" && s.tier === "sweet");
}
