import {
  buildPolicyRequest,
  isRuleResponse,
  mockPolicyResponse,
  parseRuleQuery,
  QUESTION_SET_VERSION,
  type RuleErrorCode,
  type RuleResponse,
  ruleUrl,
} from "@bagel/core";
import {
  APIConnectionError,
  APIError,
  APITimeoutError,
  APIUserAbortError,
  RateLimitError,
  TypeSafeClient,
  TypeSafeError,
} from "@typesafe-ai/sdk";
import { clientIp, type Env, type WaitUntil } from "./env";
import { CACHE_IMMUTABLE, CACHE_NONE, errorResponse, jsonResponse } from "./http";
import { createRateLimiter, type RateLimiter } from "./rate-limit";

export type { Env } from "./env";

// Pinned so a stray TYPESAFE_BASE_URL can never send the key elsewhere.
const TYPESAFE_BASE_URL = "https://api.typesafe.ai";
const JEV_ATTEMPT_TIMEOUT_MS = 8_000;
export const JEV_DEADLINE_MS = 9_000;
const DEFAULT_RETRY_AFTER_S = 10;
const LIVE_CALLS_PER_MINUTE = 20;

const JEV_RETRY = {
  maxRetries: 1,
  backoffMaxMs: 1_000,
  maxRetryAfterMs: 2_000,
  // 429 goes straight back to the browser, which honors Retry-After.
  httpStatuses: new Set([408, 500, 502, 503, 504, 529]),
  apiTimeoutError: false,
};

class UnexpectedUpstreamShape extends Error {
  override name = "UnexpectedUpstreamShape";
}

export function createRuleHandler(
  limiter: RateLimiter = createRateLimiter({ limit: LIVE_CALLS_PER_MINUTE, windowMs: 60_000 }),
) {
  return async function handleRule(request: Request, env: Env, waitUntil: WaitUntil) {
    try {
      return await rule(request, env, waitUntil, limiter);
    } catch (error) {
      console.error("rule: unhandled error", describe(error));
      return errorResponse("internal");
    }
  };
}

async function rule(
  request: Request,
  env: Env,
  waitUntil: WaitUntil,
  limiter: RateLimiter,
): Promise<Response> {
  if (request.method !== "GET") {
    return errorResponse("method_not_allowed", { headers: { Allow: "GET" } });
  }
  const url = new URL(request.url);
  const order = parseRuleQuery(url.search);
  if (order === null) return errorResponse("bad_request");

  const apiKey = env.TYPESAFE_API_KEY?.trim();
  if (!apiKey) {
    const body: RuleResponse = { ...mockPolicyResponse(order), mock: true };
    return jsonResponse(JSON.stringify(body), { cacheControl: CACHE_NONE });
  }

  const cache = typeof caches === "undefined" ? undefined : caches.default;
  const cacheKey = new Request(new URL(ruleUrl(order), url.origin));
  const kvKey = `v${QUESTION_SET_VERSION}:${order}`;
  const fillCache = (body: string) =>
    cache?.put(cacheKey, jsonResponse(body, { cacheControl: CACHE_IMMUTABLE, cache: "HIT" }));

  const cached = await settle(cache?.match(cacheKey));
  if (cached) return cached;

  const stored = await settle(env.RULINGS?.get(kvKey));
  if (stored) {
    background(waitUntil, "cache put", fillCache(stored));
    return jsonResponse(stored, { cacheControl: CACHE_IMMUTABLE, cache: "KV" });
  }

  const wait = limiter.take(clientIp(request), Date.now());
  if (wait > 0) return errorResponse("rate_limited", { headers: { "Retry-After": String(wait) } });

  let body: string;
  try {
    const client = new TypeSafeClient({
      apiKey,
      baseURL: TYPESAFE_BASE_URL,
      timeout: JEV_ATTEMPT_TIMEOUT_MS,
      retry: JEV_RETRY,
      logLevel: "off",
    });
    const result: unknown = await client.systemOne(buildPolicyRequest(order), {
      signal: AbortSignal.timeout(JEV_DEADLINE_MS),
    });
    // Anything cached here is immutable for a year, so never cache a malformed 200.
    if (!isRuleResponse(result)) throw new UnexpectedUpstreamShape();
    body = JSON.stringify({ model: result.model, answers: result.answers });
  } catch (error) {
    return upstreamFailure(error);
  }

  background(waitUntil, "cache put", fillCache(body));
  background(waitUntil, "kv put", env.RULINGS?.put(kvKey, body));
  return jsonResponse(body, { cacheControl: CACHE_IMMUTABLE, cache: "MISS" });
}

async function settle<T>(promise: Promise<T> | undefined): Promise<T | undefined> {
  try {
    return await promise;
  } catch (error) {
    console.warn("rule: storage read failed", describe(error));
    return undefined;
  }
}

function background(waitUntil: WaitUntil, label: string, promise: Promise<unknown> | undefined) {
  if (!promise) return;
  waitUntil(promise.catch((error) => console.warn(`rule: ${label} failed`, describe(error))));
}

function upstreamFailure(error: unknown): Response {
  const code = errorCode(error);
  console.error("rule: Jev call failed", {
    code,
    ...describe(error),
    ...(error instanceof APIError ? { status: error.status, requestId: error.requestId } : {}),
  });
  if (error instanceof RateLimitError) {
    const seconds = (error.retryAfterMs ?? DEFAULT_RETRY_AFTER_S * 1000) / 1000;
    const retryAfter = Math.min(60, Math.max(1, Math.ceil(seconds)));
    return errorResponse(code, { headers: { "Retry-After": String(retryAfter) } });
  }
  return errorResponse(code);
}

function errorCode(error: unknown): RuleErrorCode {
  if (error instanceof RateLimitError) return "rate_limited";
  if (error instanceof APITimeoutError || error instanceof APIUserAbortError) return "timeout";
  if (error instanceof APIError) {
    return error.status === 529 || error.status === 503 ? "upstream_busy" : "upstream_error";
  }
  if (error instanceof APIConnectionError || error instanceof UnexpectedUpstreamShape) {
    return "upstream_error";
  }
  return "internal";
}

// SDK messages can quote upstream error bodies, so only non-SDK errors log a message.
function describe(error: unknown): { error: string; message?: string } {
  if (!(error instanceof Error)) return { error: typeof error };
  if (error instanceof TypeSafeError) return { error: error.name };
  return { error: error.name, message: error.message };
}
