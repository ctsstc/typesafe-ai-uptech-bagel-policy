import { RULE_ERROR_CODES, type RuleErrorBody, type RuleErrorCode } from "@bagel/core";

export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
export const CACHE_NONE = "no-store";

export type CacheStatus = "MISS" | "HIT" | "KV";

// _headers does not apply to Function responses, so the API sets its own.
const BASE_HEADERS = {
  "Content-Type": "application/json; charset=utf-8",
  "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
  "X-Content-Type-Options": "nosniff",
} as const;

const ERROR_MESSAGES: Record<RuleErrorCode, string> = {
  bad_request: "That is not a canonical ruling request.",
  challenge_required: "New rulings need a quick human check first.",
  not_found: "No such API route.",
  method_not_allowed: "That method is not supported here.",
  stale_client: "This page is from another version of the board. Reload it.",
  rate_limited: "Too many new rulings at once. Try again in a moment.",
  client_limit: "This network has used up today's new rulings. Orders already ruled on still work.",
  daily_limit: "The board has used up today's new rulings. Orders already ruled on still work.",
  upstream_busy: "Jev is busy right now. Try again shortly.",
  upstream_error: "Jev could not rule on that right now.",
  timeout: "Jev took too long to rule. Try again.",
  internal: "Something went wrong on our side.",
};

export function jsonResponse(
  body: string,
  {
    status = 200,
    cacheControl,
    cache,
    headers,
  }: {
    status?: number;
    cacheControl: string;
    cache?: CacheStatus;
    headers?: Record<string, string>;
  },
): Response {
  return new Response(body, {
    status,
    headers: {
      ...BASE_HEADERS,
      "Cache-Control": cacheControl,
      ...(cache ? { "X-Bagel-Cache": cache } : {}),
      ...headers,
    },
  });
}

export function errorResponse(
  code: RuleErrorCode,
  { headers }: { headers?: Record<string, string> } = {},
): Response {
  const body: RuleErrorBody = { error: { code, message: ERROR_MESSAGES[code] } };
  return jsonResponse(JSON.stringify(body), {
    status: RULE_ERROR_CODES[code],
    cacheControl: CACHE_NONE,
    headers,
  });
}
