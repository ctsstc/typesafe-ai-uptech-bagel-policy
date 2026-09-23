import type { Env } from "./env";
import { errorResponse } from "./http";
import type { Session } from "./session";

export const DEFAULT_DAILY_CALL_LIMIT = 1000;
export const SESSION_CALL_LIMIT = 60;
export const CLIENT_DAILY_CALL_LIMIT = 150;

const RESERVE_SESSION_CALL = `INSERT INTO sessions (sid, calls, exp) VALUES (?1, 1, ?3)
ON CONFLICT (sid) DO UPDATE SET calls = calls + 1 WHERE calls < ?2
RETURNING calls`;

const REFUND_SESSION_CALL = "UPDATE sessions SET calls = calls - 1 WHERE sid = ?1 AND calls > 0";

const RESERVE_CLIENT_CALL = `INSERT INTO clients (key, day, calls) VALUES (?1, ?2, 1)
ON CONFLICT (key) DO UPDATE SET calls = calls + 1 WHERE calls < ?3
RETURNING calls`;

const REFUND_CLIENT_CALL = "UPDATE clients SET calls = calls - 1 WHERE key = ?1 AND calls > 0";

// SQLite requires a WHERE on INSERT ... SELECT before ON CONFLICT. This one also makes a limit of 0
// refuse the day's first call.
const RESERVE_DAILY_CALL = `INSERT INTO usage (day, calls) SELECT ?1, 1 WHERE ?2 > 0
ON CONFLICT (day) DO UPDATE SET calls = calls + 1 WHERE calls < ?2
RETURNING calls`;

const READ_SPENT = `SELECT (SELECT calls FROM usage WHERE day = ?1) AS day_calls,
(SELECT calls FROM clients WHERE key = ?2) AS client_calls`;

const ADD_INPUT_TOKENS =
  "UPDATE usage SET input_tokens = input_tokens + ?2, token_calls = token_calls + 1 WHERE day = ?1";

export function dailyCallLimit(env: Env): number {
  const limit = Number(env.DAILY_CALL_LIMIT?.trim() || Number.NaN);
  return Number.isSafeInteger(limit) && limit >= 0 ? limit : DEFAULT_DAILY_CALL_LIMIT;
}

export function utcDay(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export function secondsUntilUtcMidnight(now: number): number {
  const date = new Date(now);
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() + 1);
  return Math.max(1, Math.ceil((midnight - now) / 1000));
}

let reportedNoDb = false;

export interface Charge {
  readonly session: Session | null;
  /** The client's key for today, from clientKey(). null skips the per-client cap. */
  readonly client: string | null;
}

/**
 * Counts one Jev call against the session, the client and the UTC day, or returns the refusal.
 * Narrowest first, so a spent session or client can never use up the shared daily budget. A
 * refusal gives back what was already charged, since Jev was never asked.
 */
export async function reserveJevCall(
  env: Env,
  { session, client }: Charge,
  now: number,
): Promise<Response | null> {
  const db = env.DB;
  if (!db) {
    if (!reportedNoDb) {
      reportedNoDb = true;
      console.warn("rule: no DB binding, so the daily and per-session Jev caps are off");
    }
    return null;
  }
  try {
    if (session) {
      const charged = await db
        .prepare(RESERVE_SESSION_CALL)
        .bind(session.sid, SESSION_CALL_LIMIT, session.exp)
        .first();
      if (!charged) {
        return (
          (await refuseSpent(env, client, now)) ??
          errorResponse("challenge_required", {
            message: "This session has used its new rulings. A fresh check starts another.",
          })
        );
      }
    }
    const refund = async (clientCharged: boolean) => {
      if (session) await db.prepare(REFUND_SESSION_CALL).bind(session.sid).run();
      if (client && clientCharged) await db.prepare(REFUND_CLIENT_CALL).bind(client).run();
    };
    const day = utcDay(now);
    if (client) {
      const charged = await db
        .prepare(RESERVE_CLIENT_CALL)
        .bind(client, day, CLIENT_DAILY_CALL_LIMIT)
        .first();
      if (!charged) {
        await refund(false);
        return clientLimitReached(day, now);
      }
    }
    const limit = dailyCallLimit(env);
    const charged = await db.prepare(RESERVE_DAILY_CALL).bind(day, limit).first();
    if (!charged) {
      await refund(true);
      return dailyLimitReached(day, limit, now);
    }
    return null;
  } catch (error) {
    console.error("rule: spend check failed", {
      error: error instanceof Error ? error.name : typeof error,
    });
    return errorResponse("internal");
  }
}

function dailyLimitReached(day: string, limit: number, now: number): Response {
  console.warn("rule: daily Jev call limit reached", { day, limit });
  return errorResponse("daily_limit", {
    headers: { "Retry-After": String(secondsUntilUtcMidnight(now)) },
  });
}

function clientLimitReached(day: string, now: number): Response {
  console.warn("rule: client daily Jev call limit reached", { day });
  return errorResponse("client_limit", {
    headers: { "Retry-After": String(secondsUntilUtcMidnight(now)) },
  });
}

/**
 * The refusal a fresh human check would end in when today's budget or this client's is already
 * spent, so nobody solves a check for nothing. Only a shortcut: reserveJevCall stays the guard, so
 * a failed read falls through to the check.
 */
export async function refuseSpent(
  env: Env,
  client: string | null,
  now: number,
): Promise<Response | null> {
  const db = env.DB;
  if (!db) return null;
  const day = utcDay(now);
  const limit = dailyCallLimit(env);
  if (limit === 0) return dailyLimitReached(day, limit, now);
  try {
    const row = await db
      .prepare(READ_SPENT)
      .bind(day, client)
      .first<{ day_calls: number | null; client_calls: number | null }>();
    if ((row?.day_calls ?? 0) >= limit) return dailyLimitReached(day, limit, now);
    if ((row?.client_calls ?? 0) >= CLIENT_DAILY_CALL_LIMIT) return clientLimitReached(day, now);
    return null;
  } catch (error) {
    console.warn("rule: early spend read failed", {
      error: error instanceof Error ? error.name : typeof error,
    });
    return null;
  }
}

/** `now` must be the time the call was charged, so its tokens land on the same UTC day. */
export async function recordInputTokens(env: Env, tokens: number, now: number): Promise<void> {
  if (!env.DB || tokens <= 0) return;
  await env.DB.prepare(ADD_INPUT_TOKENS).bind(utcDay(now), tokens).run();
}

export async function forgetExpired(db: D1Database, now: number): Promise<void> {
  await db
    .prepare("DELETE FROM sessions WHERE exp < ?1")
    .bind(Math.floor(now / 1000))
    .run();
  await db.prepare("DELETE FROM clients WHERE day < ?1").bind(utcDay(now)).run();
}
