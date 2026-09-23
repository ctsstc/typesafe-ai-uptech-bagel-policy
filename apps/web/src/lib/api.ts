import {
  CLIENT_TIMEOUT_MS,
  isRuleErrorBody,
  isRuleResponse,
  type PolicyResult,
  ruleUrl,
  toPolicyResult,
} from "@bagel/core";

export type RuleOutcome =
  | { ok: true; result: PolicyResult; mock: boolean }
  | { ok: false; message: string };

export async function fetchRuling(order: string, signal?: AbortSignal): Promise<RuleOutcome> {
  const timeout = AbortSignal.timeout(CLIENT_TIMEOUT_MS);
  try {
    const response = await fetch(ruleUrl(order), {
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const body: unknown = await response.json().catch(() => null);
    if (response.ok && isRuleResponse(body)) {
      return { ok: true, result: toPolicyResult(order, body), mock: body.mock === true };
    }
    if (isRuleErrorBody(body)) return { ok: false, message: body.error.message };
    return { ok: false, message: "The review board sent back something unreadable." };
  } catch (error) {
    if (timeout.aborted)
      return { ok: false, message: "The review board took too long. Try again." };
    if (signal?.aborted) throw error;
    return { ok: false, message: "Could not reach the review board. Check your connection." };
  }
}
