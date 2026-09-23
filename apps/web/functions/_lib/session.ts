import { TURNSTILE_ACTION } from "@bagel/core";
import { clientIp, clientNetwork, type Env, type WaitUntil } from "./env";
import { errorResponse, noContent } from "./http";
import { createRateLimiter, type RateLimiter } from "./rate-limit";
import { forgetExpired } from "./usage";

export const SESSION_COOKIE = "bagel_session";
export const SESSION_TTL_S = 3600;
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

const MIN_SESSION_SECRET_LENGTH = 32;
const MAX_TOKEN_LENGTH = 2048;
const MAX_BODY_BYTES = 4096;
const MAX_COOKIE_LENGTH = 512;
const CLOCK_SKEW_S = 60;
const SITEVERIFY_ATTEMPT_MS = 4_000;
export const SITEVERIFY_DEADLINE_MS = 8_000;
const SESSIONS_PER_MINUTE = 10;

// Cloudflare's documented test secrets answer with hostname "example.com" and no action.
const TEST_SECRETS = new Set([
  "1x0000000000000000000000000000000AA",
  "2x0000000000000000000000000000000AA",
  "3x0000000000000000000000000000000AA",
]);

export type ChallengeConfig =
  | { readonly mode: "off" }
  | { readonly mode: "misconfigured" }
  | { readonly mode: "on"; readonly turnstileSecret: string; readonly sessionSecret: string };

export interface Session {
  readonly sid: string;
  readonly iat: number;
  readonly exp: number;
}

export function challengeConfig(env: Env): ChallengeConfig {
  const turnstileSecret = env.TURNSTILE_SECRET_KEY?.trim();
  if (!turnstileSecret) return { mode: "off" };
  const sessionSecret = env.SESSION_SECRET?.trim() ?? "";
  if (sessionSecret.length < MIN_SESSION_SECRET_LENGTH) return { mode: "misconfigured" };
  return { mode: "on", turnstileSecret, sessionSecret };
}

let reportedMisconfig = false;
function misconfigured(): Response {
  if (!reportedMisconfig) {
    reportedMisconfig = true;
    console.error(
      "session: TURNSTILE_SECRET_KEY is set but SESSION_SECRET is missing or shorter than 32 characters, so new rulings are refused",
    );
  }
  return errorResponse("internal");
}

/**
 * Resolves the caller's session for a paid request. `null` means challenges are off.
 * A Response means refuse the request with it.
 */
export async function requireSession(
  request: Request,
  env: Env,
  now: number,
): Promise<Session | null | Response> {
  const config = challengeConfig(env);
  if (config.mode === "off") return null;
  if (config.mode === "misconfigured") return misconfigured();
  const session = await readSession(request, config.sessionSecret, now);
  return session ?? errorResponse("challenge_required");
}

export function createSessionHandler(
  limiter: RateLimiter = createRateLimiter({ limit: SESSIONS_PER_MINUTE, windowMs: 60_000 }),
) {
  return async function handleSession(
    request: Request,
    env: Env,
    waitUntil: WaitUntil,
  ): Promise<Response> {
    try {
      return await startSession(request, env, waitUntil, limiter);
    } catch (error) {
      console.error("session: unhandled error", { error: nameOf(error) });
      return errorResponse("internal");
    }
  };
}

async function startSession(
  request: Request,
  env: Env,
  waitUntil: WaitUntil,
  limiter: RateLimiter,
): Promise<Response> {
  if (request.method !== "POST") {
    return errorResponse("method_not_allowed", { headers: { Allow: "POST" } });
  }
  const config = challengeConfig(env);
  if (config.mode === "off") {
    return errorResponse("not_found", { message: "Human checks are off on this deployment." });
  }
  if (config.mode === "misconfigured") return misconfigured();

  const ip = clientIp(request);
  const wait = limiter.take(clientNetwork(request), Date.now());
  if (wait > 0) return errorResponse("rate_limited", { headers: { "Retry-After": String(wait) } });

  const token = await readToken(request);
  if (token === null) {
    return errorResponse("bad_request", {
      message: 'Send {"token": "<Turnstile token>"} as JSON.',
    });
  }

  const url = new URL(request.url);
  const verdict = await verifyTurnstile(config.turnstileSecret, token, url.hostname, ip);
  if (verdict === "unavailable") {
    return errorResponse("upstream_error", { message: "The human check could not be verified." });
  }
  if (verdict === "rejected") {
    return errorResponse("challenge_required", { message: "The human check did not pass." });
  }

  const now = Date.now();
  const cookie = await issueSession(config.sessionSecret, now);
  if (env.DB) {
    const cleanup = forgetExpired(env.DB, now);
    waitUntil(
      cleanup.catch((error) => console.warn("session: cleanup failed", { error: nameOf(error) })),
    );
  }
  return noContent({ "Set-Cookie": sessionCookie(cookie, url.hostname) });
}

async function readToken(request: Request): Promise<string | null> {
  const type = request.headers.get("Content-Type") ?? "";
  if (!/^application\/json\s*(;|$)/i.test(type)) return null;
  const text = await readSmallBody(request, MAX_BODY_BYTES);
  if (text === null) return null;
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return null;
  }
  if (typeof body !== "object" || body === null || !("token" in body)) return null;
  const { token } = body;
  return typeof token === "string" && token.length > 0 && token.length <= MAX_TOKEN_LENGTH
    ? token
    : null;
}

async function readSmallBody(request: Request, maxBytes: number): Promise<string | null> {
  if (Number(request.headers.get("Content-Length") ?? 0) > maxBytes || !request.body) return null;
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel();
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

type Verdict = "passed" | "rejected" | "unavailable";

// These mean our secret is wrong, not the visitor's check, so they must never read as a failed check.
const SECRET_ERRORS = new Set(["invalid-input-secret", "missing-input-secret"]);

let reportedSecretError = false;
function secretRefused(codes: string[]): Verdict {
  if (!reportedSecretError) {
    reportedSecretError = true;
    console.error("session: siteverify refused TURNSTILE_SECRET_KEY, so new rulings are refused", {
      codes,
    });
  }
  return "unavailable";
}

async function verifyTurnstile(
  secret: string,
  token: string,
  hostname: string,
  remoteip: string,
): Promise<Verdict> {
  // Reusing the key lets a retry read the first attempt's answer instead of a duplicate-token error.
  const idempotencyKey = crypto.randomUUID();
  const body = JSON.stringify({
    secret,
    response: token,
    idempotency_key: idempotencyKey,
    ...(remoteip === "unknown" ? {} : { remoteip }),
  });
  const deadline = AbortSignal.timeout(SITEVERIFY_DEADLINE_MS);
  for (let attempt = 0; attempt < 2 && !deadline.aborted; attempt++) {
    let response: Response;
    try {
      response = await fetch(SITEVERIFY_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: AbortSignal.any([AbortSignal.timeout(SITEVERIFY_ATTEMPT_MS), deadline]),
      });
    } catch (error) {
      console.warn("session: siteverify unreachable", { attempt, error: nameOf(error) });
      continue;
    }
    if (response.status >= 500) {
      console.warn("session: siteverify failed", { attempt, status: response.status });
      continue;
    }
    const result: unknown = await response.json().catch(() => null);
    const verdict = judge(result, secret, hostname);
    if (verdict !== "retry") return verdict;
  }
  return "unavailable";
}

function judge(result: unknown, secret: string, hostname: string): Verdict | "retry" {
  if (typeof result !== "object" || result === null) return "unavailable";
  const outcome = result as { success?: unknown; hostname?: unknown; action?: unknown };
  if (outcome.success !== true) {
    const raw = (result as { "error-codes"?: unknown })["error-codes"];
    const codes = Array.isArray(raw) ? raw.filter((code) => typeof code === "string") : [];
    if (codes.some((code) => SECRET_ERRORS.has(code))) return secretRefused(codes);
    if (codes.includes("internal-error")) {
      console.warn("session: siteverify internal error", { codes });
      return "retry";
    }
    console.warn("session: token rejected", { codes });
    return "rejected";
  }
  if (TEST_SECRETS.has(secret)) return "passed";
  if (outcome.hostname !== hostname || outcome.action !== TURNSTILE_ACTION) {
    console.warn("session: token for another site or action", {
      hostname: outcome.hostname,
      action: outcome.action,
    });
    return "rejected";
  }
  return "passed";
}

const encoder = new TextEncoder();
let cachedKey: { secret: string; key: Promise<CryptoKey> } | undefined;

function hmacKey(secret: string): Promise<CryptoKey> {
  if (cachedKey?.secret !== secret) {
    const key = crypto.subtle.importKey(
      "raw",
      encoder.encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    cachedKey = { secret, key };
  }
  return cachedKey.key;
}

async function sign(secret: string, payload: string): Promise<Uint8Array> {
  return new Uint8Array(
    await crypto.subtle.sign("HMAC", await hmacKey(secret), encoder.encode(payload)),
  );
}

export async function issueSession(secret: string, now: number): Promise<string> {
  const iat = Math.floor(now / 1000);
  const session: Session = { sid: crypto.randomUUID(), iat, exp: iat + SESSION_TTL_S };
  const payload = toBase64Url(encoder.encode(JSON.stringify(session)));
  return `${payload}.${toBase64Url(await sign(secret, payload))}`;
}

export async function readSession(
  request: Request,
  secret: string,
  now: number,
): Promise<Session | null> {
  const value = cookieValue(request.headers.get("Cookie"), SESSION_COOKIE);
  if (!value || value.length > MAX_COOKIE_LENGTH) return null;
  const [payload, signature, ...rest] = value.split(".");
  if (!payload || !signature || rest.length > 0) return null;
  const given = fromBase64Url(signature);
  if (!given || !timingSafeEqual(given, await sign(secret, payload))) return null;

  const session = parseSession(fromBase64Url(payload));
  const nowS = Math.floor(now / 1000);
  if (!session || session.exp <= nowS || session.iat > nowS + CLOCK_SKEW_S) return null;
  if (session.exp - session.iat > SESSION_TTL_S) return null;
  return session;
}

function parseSession(bytes: Uint8Array | null): Session | null {
  if (!bytes) return null;
  let value: unknown;
  try {
    value = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { sid, iat, exp } = value as Partial<Record<keyof Session, unknown>>;
  if (typeof sid !== "string" || !/^[0-9a-f-]{36}$/.test(sid)) return null;
  if (!Number.isSafeInteger(iat) || !Number.isSafeInteger(exp)) return null;
  return { sid, iat: iat as number, exp: exp as number };
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/**
 * The key for this client's call counter on `day`: an HMAC of its IP and the day under
 * SESSION_SECRET, so the counter never holds an IP and a day's keys cannot be linked to the next.
 * null when challenges are off or the IP is unknown.
 */
export async function clientKey(request: Request, env: Env, day: string): Promise<string | null> {
  const config = challengeConfig(env);
  const network = clientNetwork(request);
  if (config.mode !== "on" || network === "unknown") return null;
  return toBase64Url(await sign(config.sessionSecret, `client:${day}:${network}`));
}

export function sessionCookie(value: string, hostname: string): string {
  const attributes = [`Max-Age=${SESSION_TTL_S}`, "Path=/api", "HttpOnly", "SameSite=Strict"];
  if (!isLocalHost(hostname)) attributes.push("Secure");
  return [`${SESSION_COOKIE}=${value}`, ...attributes].join("; ");
}

function isLocalHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname === "127.0.0.1" ||
    hostname === "[::1]"
  );
}

function cookieValue(header: string | null, name: string): string | null {
  if (!header) return null;
  for (const part of header.split(";")) {
    const eq = part.indexOf("=");
    if (eq !== -1 && part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim();
  }
  return null;
}

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Uint8Array | null {
  if (!/^[A-Za-z0-9_-]+$/.test(text)) return null;
  try {
    const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
    return Uint8Array.from(binary, (char) => char.charCodeAt(0));
  } catch {
    return null;
  }
}

function nameOf(error: unknown): string {
  return error instanceof Error ? error.name : typeof error;
}
