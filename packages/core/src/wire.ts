import { POLICY_ANSWER_TYPES, type PolicyResponse } from "./questions";

export const RULE_ERROR_CODES = {
  bad_request: 400,
  challenge_required: 401,
  not_found: 404,
  method_not_allowed: 405,
  stale_client: 409,
  rate_limited: 429,
  client_limit: 429,
  daily_limit: 503,
  upstream_busy: 503,
  upstream_error: 502,
  timeout: 504,
  internal: 500,
} as const;
export type RuleErrorCode = keyof typeof RULE_ERROR_CODES;

export type RuleResponse = PolicyResponse & { readonly mock?: true };

// Every server-side deadline must stay under this, or the browser shows its own timeout instead.
export const CLIENT_TIMEOUT_MS = 10_000;

export interface RuleErrorBody {
  readonly error: { readonly code: RuleErrorCode; readonly message: string };
}

function isAnswer(value: unknown, type: "choice" | "noul" | "score"): boolean {
  if (typeof value !== "object" || value === null) return false;
  const answer = value as Record<string, unknown>;
  if (answer.type !== type) return false;
  if (type === "noul") return Number.isFinite(answer.noul);
  if (type === "score") return Number.isFinite(answer.score);
  return (
    typeof answer.choice === "string" &&
    typeof answer.probabilities === "object" &&
    answer.probabilities !== null
  );
}

/** True when every question has an answer of the right type, so toPolicyResult cannot throw on it. */
export function isRuleResponse(value: unknown): value is RuleResponse {
  if (typeof value !== "object" || value === null) return false;
  const { model, answers } = value as { model?: unknown; answers?: unknown };
  if (typeof model !== "string" || typeof answers !== "object" || answers === null) return false;
  return Object.entries(POLICY_ANSWER_TYPES).every(([id, type]) =>
    isAnswer((answers as Record<string, unknown>)[id], type),
  );
}

export function isRuleErrorBody(value: unknown): value is RuleErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const { error } = value as { error: unknown };
  if (typeof error !== "object" || error === null) return false;
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    typeof code === "string" && Object.hasOwn(RULE_ERROR_CODES, code) && typeof message === "string"
  );
}
