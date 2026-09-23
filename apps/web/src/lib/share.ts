import { type PolicyResult, VERDICTS } from "@bagel/core";

// Declined orders get no share button, so abusive text is never passed along.
export function shareText(result: PolicyResult): string | null {
  switch (result.kind) {
    case "declined":
      return null;
    case "out_of_scope":
      return `The Bagel Review Board says "${result.order}" is outside its jurisdiction.`;
    case "ruling":
      return `The Bagel Review Board rules "${result.order}": ${VERDICTS[result.verdict].label}.`;
  }
}
