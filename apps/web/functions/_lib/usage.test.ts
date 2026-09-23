// @vitest-environment node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Env } from "./env";
import { fakeD1 } from "./fake-d1";
import {
  DEFAULT_DAILY_CALL_LIMIT,
  dailyCallLimit,
  forgetExpired,
  recordInputTokens,
  refuseSpent,
  reserveJevCall,
  secondsUntilUtcMidnight,
  utcDay,
} from "./usage";

// Free plan KV writes per day, account wide. Each billed ruling writes one.
const FREE_KV_WRITES_PER_DAY = 1000;

function wranglerVars(): Record<string, string> {
  const text = readFileSync(
    fileURLToPath(new URL("../../wrangler.jsonc", import.meta.url).href),
    "utf8",
  );
  const json = JSON.parse(text.replace(/^\s*\/\/.*$/gm, "")) as { vars: Record<string, string> };
  return json.vars;
}

describe("daily call limit", () => {
  it("ships a default that every stored ruling can fit under the KV write quota", () => {
    expect(wranglerVars().DAILY_CALL_LIMIT).toBe(String(DEFAULT_DAILY_CALL_LIMIT));
    expect(DEFAULT_DAILY_CALL_LIMIT).toBeLessThanOrEqual(FREE_KV_WRITES_PER_DAY);
  });

  it.each([
    [undefined, DEFAULT_DAILY_CALL_LIMIT],
    ["", DEFAULT_DAILY_CALL_LIMIT],
    ["abc", DEFAULT_DAILY_CALL_LIMIT],
    ["-1", DEFAULT_DAILY_CALL_LIMIT],
    ["0", 0],
    [" 250 ", 250],
  ])("reads DAILY_CALL_LIMIT=%j as %i", (value, expected) => {
    expect(dailyCallLimit({ DAILY_CALL_LIMIT: value })).toBe(expected);
  });
});

describe("UTC day", () => {
  it.each([
    ["2026-09-22T00:00:00Z", "2026-09-22", 86_400],
    ["2026-09-22T23:00:00Z", "2026-09-22", 3_600],
    ["2026-09-22T23:59:59.500Z", "2026-09-22", 1],
  ])("at %s is %s with %i seconds left", (at, day, seconds) => {
    const now = Date.parse(at);
    expect(utcDay(now)).toBe(day);
    expect(secondsUntilUtcMidnight(now)).toBe(seconds);
  });
});

describe("D1 statements", () => {
  const NOW = Date.parse("2026-09-22T12:00:00Z");
  const session = { sid: "00000000-0000-4000-8000-000000000000", iat: 0, exp: NOW / 1000 + 60 };

  // D1 bills every row a statement scans, so a table scan here grows with traffic.
  it("finds rows through an index, never a table scan", async () => {
    const d1 = fakeD1();
    const env: Env = { DB: d1.binding, DAILY_CALL_LIMIT: "1" };
    await reserveJevCall(env, { session, client: "client-key" }, NOW);
    await reserveJevCall(env, { session, client: "client-key" }, NOW);
    await refuseSpent(env, "client-key", NOW);
    await recordInputTokens(env, 9642, NOW);
    await forgetExpired(d1.binding, NOW);
    const statements = new Set(d1.calls);
    expect(statements.size).toBeGreaterThanOrEqual(9);
    for (const sql of statements) {
      const plan = d1.sqlite.prepare(`EXPLAIN QUERY PLAN ${sql}`).all();
      const scans = plan
        .map((row) => String(row.detail))
        .filter((step) => /^SCAN (?!CONSTANT ROW)/.test(step));
      expect(scans, sql).toEqual([]);
    }
  });
});
