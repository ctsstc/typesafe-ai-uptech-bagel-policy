import {
  CLIENT_TIMEOUT_MS,
  isRuleErrorBody,
  isRuleResponse,
  type PolicyResult,
  type RuleErrorCode,
  type RuleResponse,
  ruleUrl,
  SESSION_PATH,
  toPolicyResult,
} from "@bagel/core";
import { errorMessage, type RulingErrorCode } from "./errors";

export type { RulingErrorCode } from "./errors";

export class RulingError extends Error {
  override name = "RulingError";
  constructor(
    readonly code: RulingErrorCode,
    readonly retryAfter: number | null = null,
  ) {
    super(code);
  }
}

export type RuleOutcome =
  | { ok: true; result: PolicyResult; mock: boolean }
  | { ok: false; code: RulingErrorCode; message: string };

const STATUS_CODES: Partial<Record<number, RuleErrorCode>> = {
  400: "bad_request",
  401: "challenge_required",
  404: "not_found",
  405: "method_not_allowed",
  409: "stale_client",
  429: "rate_limited",
  502: "upstream_error",
  503: "upstream_busy",
  504: "timeout",
};

export function parseRetryAfter(value: string | null, now = Date.now()): number | null {
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds)) return Math.max(0, Math.ceil(seconds));
  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, Math.ceil((date - now) / 1000));
}

interface Sent {
  readonly res: Response;
  readonly text: string;
}

// Reads the body inside the timeout too: a connection that drops or stalls after the headers is a
// network failure, not a body that failed to parse.
async function send(url: string, init: RequestInit, signal?: AbortSignal): Promise<Sent> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), CLIENT_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      ...init,
      signal: signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal,
    });
    return { res, text: await res.text() };
  } catch (error) {
    if (signal?.aborted) throw error;
    if (timeout.signal.aborted) throw new RulingError("timeout");
    throw new RulingError(navigator.onLine === false ? "offline" : "network");
  } finally {
    clearTimeout(timer);
  }
}

function failure(res: Response, body: unknown): RulingError {
  const code = isRuleErrorBody(body) ? body.error.code : (STATUS_CODES[res.status] ?? "internal");
  return new RulingError(code, parseRetryAfter(res.headers.get("retry-after")));
}

const NOT_JSON = Symbol("not JSON");

function parseBody(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return NOT_JSON;
  }
}

// Once the Free plan's daily Functions requests run out, Pages fails open and answers /api/* with
// the SPA's index.html and a 200, so a success that is not JSON means the API is over capacity.
function isHtml(res: Response): boolean {
  return /\bhtml\b/i.test(res.headers.get("content-type") ?? "");
}

// Only the timeout aborts this fetch. Dropping the connection once the Function has charged D1
// would keep the charge, may still bill Jev, and would leave the ruling uncached.
async function load(order: string): Promise<RuleResponse> {
  const { res, text } = await send(ruleUrl(order), { headers: { accept: "application/json" } });
  const body = parseBody(text);
  if (!res.ok) throw failure(res, body);
  if (body === NOT_JSON || isHtml(res)) throw new RulingError("over_capacity");
  if (!isRuleResponse(body)) throw new RulingError("internal");
  return body;
}

let checking = false;
const checkingListeners = new Set<() => void>();

function setChecking(next: boolean): void {
  if (checking === next) return;
  checking = next;
  for (const listener of checkingListeners) listener();
}

/** Whether the check card is on screen, waiting for the visitor. For useSyncExternalStore. */
export function isChecking(): boolean {
  return checking;
}

export function subscribeChecking(listener: () => void): () => void {
  checkingListeners.add(listener);
  return () => checkingListeners.delete(listener);
}

function isSkipped(error: unknown): boolean {
  return error instanceof Error && "skipped" in error && error.skipped === true;
}

async function startSession(signal: AbortSignal): Promise<void> {
  const sitekey = import.meta.env.VITE_TURNSTILE_SITE_KEY;
  if (typeof sitekey !== "string" || !sitekey) throw new RulingError("challenge_required");
  let solveChallenge: typeof import("./challenge").solveChallenge;
  try {
    ({ solveChallenge } = await import("./challenge"));
  } catch {
    // After a deploy the old hashed chunk is gone, so only a reload can load the check.
    throw new RulingError(navigator.onLine === false ? "offline" : "stale_client");
  }
  let token: string;
  try {
    token = await solveChallenge(sitekey, { signal, onInteractive: () => setChecking(true) });
  } catch (error) {
    if (isSkipped(error)) throw new RulingError("challenge_skipped");
    throw new RulingError(navigator.onLine === false ? "offline" : "challenge_required");
  } finally {
    setChecking(false);
  }
  if (signal.aborted) throw new RulingError("challenge_skipped");
  const { res, text } = await send(SESSION_PATH, {
    method: "POST",
    headers: { accept: "application/json", "content-type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!res.ok) {
    const failed = failure(res, parseBody(text));
    // Jev was never asked, so its copy would blame the wrong thing for a siteverify outage or our own secret.
    throw failed.code === "upstream_error" || failed.code === "bad_request"
      ? new RulingError("internal")
      : failed;
  }
}

interface Session {
  readonly done: Promise<void>;
  readonly controller: AbortController;
  waiting: number;
}

// Orders that miss together share one check. It is dropped once no caller waits on it.
let session: Session | null = null;

function joinSession(signal?: AbortSignal): Promise<void> {
  if (!session || session.controller.signal.aborted) {
    const controller = new AbortController();
    const started: Session = {
      controller,
      waiting: 0,
      done: startSession(controller.signal).finally(() => {
        if (session === started) session = null;
      }),
    };
    session = started;
  }
  const joined = session;
  joined.waiting += 1;
  let held = true;
  const release = () => {
    if (!held) return;
    held = false;
    signal?.removeEventListener("abort", release);
    joined.waiting -= 1;
    if (joined.waiting === 0) joined.controller.abort();
  };
  signal?.addEventListener("abort", release, { once: true });
  joined.done.then(release, release);
  return joined.done;
}

async function rule(order: string, signal?: AbortSignal): Promise<RuleResponse> {
  try {
    return await load(order);
  } catch (error) {
    if (!(error instanceof RulingError) || error.code !== "challenge_required") throw error;
  }
  if (signal?.aborted) throw new RulingError("challenge_skipped");
  await joinSession(signal);
  // The ruling went away while the check ran, so do not pay for it.
  if (signal?.aborted) throw new RulingError("challenge_skipped");
  // One retry only: a second challenge_required surfaces as an error instead of looping.
  return load(order);
}

/** Rules on `order`. Rejects only when `signal` aborts; every other failure is an outcome. */
export async function fetchRuling(order: string, signal?: AbortSignal): Promise<RuleOutcome> {
  try {
    const body = await rule(order, signal);
    signal?.throwIfAborted();
    return { ok: true, result: toPolicyResult(order, body), mock: body.mock === true };
  } catch (error) {
    if (signal?.aborted) throw error;
    const failed = error instanceof RulingError ? error : new RulingError("internal");
    return { ok: false, code: failed.code, message: errorMessage(failed.code, failed.retryAfter) };
  }
}
