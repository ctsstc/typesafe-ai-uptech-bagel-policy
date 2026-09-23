#!/usr/bin/env node
// Read-only Jev spend report from the production D1 counters. See docs/deploy.md#watching-spend.
// Usage: pnpm spend [--detail]
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PRODUCTION_CONFIG, writeProductionConfig } from "./cloudflare-config.mjs";

const DATABASE = "bagel-review-board";
// Jev's public list price (https://docs.typesafe.ai/models.md). Output tokens are free.
export const USD_PER_MILLION_INPUT_TOKENS = 0.042;
export const FALLBACK_TOKENS_PER_CALL = 2795;
const DEFAULT_DAILY_CALL_LIMIT = 1000;
const WINDOW_DAYS = 30;

const root = fileURLToPath(new URL("..", import.meta.url));
const web = `${root}apps/web`;

export function utcDay(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function daysBefore(day, count) {
  return utcDay(Date.parse(`${day}T00:00:00Z`) - count * 86_400_000);
}

// Only whole-line comments are stripped, so a comment after a value makes JSON.parse throw.
export function parseDailyCallLimit(jsonc) {
  const config = JSON.parse(jsonc.replace(/^\s*\/\/.*$/gm, ""));
  const limit = Number(String(config?.vars?.DAILY_CALL_LIMIT ?? "").trim() || Number.NaN);
  return Number.isSafeInteger(limit) && limit >= 0 ? limit : DEFAULT_DAILY_CALL_LIMIT;
}

export function averageInputTokens(jsonl) {
  const tokens = jsonl
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line)?.usage?.input_tokens)
    .filter((value) => Number.isFinite(value) && value > 0);
  if (tokens.length === 0) return null;
  return tokens.reduce((sum, value) => sum + value, 0) / tokens.length;
}

// input_tokens cannot say which calls it covers, so a day prices exactly only when token_calls
// equals calls. The calls that recorded nothing are estimated on top of the recorded total.
function costOf(row, tokensPerCall) {
  const calls = Number(row.calls) || 0;
  const recorded = Math.min(Number(row.token_calls) || 0, calls);
  const tokens =
    (recorded > 0 ? Number(row.input_tokens) || 0 : 0) + (calls - recorded) * tokensPerCall;
  return { calls, exact: recorded === calls, usd: (tokens * USD_PER_MILLION_INPUT_TOKENS) / 1e6 };
}

export function summarize(rows, { today, limit, tokensPerCall }) {
  const windowStart = daysBefore(today, WINDOW_DAYS - 1);
  const days = rows
    .filter((row) => row.day >= windowStart && row.day <= today)
    .sort((a, b) => a.day.localeCompare(b.day))
    .map((row) => {
      const cost = costOf(row, tokensPerCall);
      const inputTokens = Number(row.input_tokens) || 0;
      return {
        day: row.day,
        inputTokens: inputTokens > 0 ? inputTokens : null,
        share: limit > 0 ? cost.calls / limit : null,
        ...cost,
      };
    });
  const total = (from) => {
    const picked = rows
      .filter((row) => row.day >= from && row.day <= today)
      .map((row) => costOf(row, tokensPerCall));
    return {
      calls: picked.reduce((sum, day) => sum + day.calls, 0),
      usd: picked.reduce((sum, day) => sum + day.usd, 0),
      exact: picked.every((day) => day.exact),
    };
  };
  const ceilingPerDay = (limit * tokensPerCall * USD_PER_MILLION_INPUT_TOKENS) / 1e6;
  return {
    days,
    totals: [
      ["Today", total(today)],
      ["Last 7 days", total(daysBefore(today, 6))],
      ["Last 30 days", total(windowStart)],
      ["Month to date", total(`${today.slice(0, 8)}01`)],
    ],
    ceiling: { calls: limit, usdPerDay: ceilingPerDay, usdPer30Days: ceilingPerDay * 30 },
  };
}

const count = (n) => Math.round(n).toLocaleString("en-US");
const usd = (n) => `$${n >= 1 ? n.toFixed(2) : n.toFixed(4)}`;
const percent = (share) => (share === null ? "n/a" : `${(share * 100).toFixed(1)}%`);

function table(header, rows) {
  const widths = header.map((_, i) => Math.max(...[header, ...rows].map((row) => row[i].length)));
  return [header, ...rows]
    .map((row) =>
      row.map((cell, i) => (i === 0 ? cell.padEnd(widths[i]) : cell.padStart(widths[i]))),
    )
    .map((cells) => cells.join("  ").trimEnd())
    .join("\n");
}

export function formatReport(summary, { limit, tokensPerCall, tokensSource, detail = null }) {
  const lines = [
    `Jev spend from the ${DATABASE} D1 counters, by UTC day`,
    `Daily limit ${count(limit)} calls (apps/web/wrangler.jsonc). Estimates (~) use ${count(tokensPerCall)} input tokens per call (${tokensSource}) at $${USD_PER_MILLION_INPUT_TOKENS} per million.`,
    "",
  ];
  if (summary.days.length === 0) {
    lines.push(`No Jev calls in the last ${WINDOW_DAYS} days.`);
  } else {
    lines.push(
      table(
        ["Day", "Calls", "Of limit", "Input tokens", "USD"],
        summary.days.map((day) => [
          day.day,
          count(day.calls),
          percent(day.share),
          day.inputTokens === null ? "-" : count(day.inputTokens),
          `${day.exact ? "" : "~"}${usd(day.usd)}`,
        ]),
      ),
    );
  }
  lines.push(
    "",
    table(
      ["Total", "Calls", "USD"],
      summary.totals.map(([label, total]) => [
        label,
        count(total.calls),
        `${total.exact ? "" : "~"}${usd(total.usd)}`,
      ]),
    ),
    "",
    `Ceiling: ${count(summary.ceiling.calls)} calls a day, about ${usd(summary.ceiling.usdPerDay)} a day or ${usd(summary.ceiling.usdPer30Days)} per 30 days.`,
  );
  if (detail) {
    lines.push(
      "",
      `Clients today: ${count(detail.clients)}, ${count(detail.activeClients)} with calls kept, ${count(detail.clientCalls)} calls, busiest client ${count(detail.topClientCalls)} calls.`,
      `Live sessions: ${count(detail.sessions)}, ${count(detail.sessionCalls)} calls.`,
    );
  }
  lines.push(
    "",
    "Calls count reserved Jev calls, including ones that failed after the charge, so estimates run",
    "slightly high. The TypeSafe console (https://console.typesafe.ai) is the source of truth for billing.",
  );
  return lines.join("\n");
}

function query(sql) {
  const { accountId } = writeProductionConfig();
  let stdout;
  try {
    stdout = execFileSync(
      "pnpm",
      [
        "exec",
        "wrangler",
        "d1",
        "execute",
        DATABASE,
        "--remote",
        "-c",
        PRODUCTION_CONFIG,
        "--json",
        "--command",
        sql,
      ],
      {
        cwd: web,
        env: { ...process.env, CLOUDFLARE_ACCOUNT_ID: accountId },
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      },
    );
  } catch (error) {
    const output = `${error.stdout ?? ""}${error.stderr ?? ""}`.trim();
    throw new Error(`wrangler d1 execute failed${output ? `:\n${output}` : ""}`);
  }
  const parsed = JSON.parse(stdout.slice(stdout.search(/[[{]/)));
  if (!Array.isArray(parsed)) throw new Error(`wrangler: ${parsed?.error?.text ?? stdout}`);
  return parsed.map((statement) => statement.results ?? []);
}

function tokensPerCall() {
  const questions = readFileSync(`${root}packages/core/src/questions.ts`, "utf8");
  const version = questions.match(/QUESTION_SET_VERSION = "(\d+)"/)?.[1];
  const raw = `${root}eval/results/v${version}/raw.jsonl`;
  const average = version && existsSync(raw) ? averageInputTokens(readFileSync(raw, "utf8")) : null;
  return average === null
    ? { tokensPerCall: FALLBACK_TOKENS_PER_CALL, tokensSource: "fallback" }
    : { tokensPerCall: average, tokensSource: `eval v${version} average` };
}

function main() {
  const detail = process.argv.includes("--detail");
  const now = Date.now();
  const today = utcDay(now);
  const since = [daysBefore(today, WINDOW_DAYS - 1), `${today.slice(0, 8)}01`].sort()[0];
  const statements = [`SELECT * FROM usage WHERE day >= '${since}' ORDER BY day`];
  if (detail) {
    statements.push(
      `SELECT COUNT(*) AS clients, COALESCE(SUM(calls > 0), 0) AS active, COALESCE(SUM(calls), 0) AS calls, COALESCE(MAX(calls), 0) AS top FROM clients WHERE day = '${today}'`,
      `SELECT COUNT(*) AS sessions, COALESCE(SUM(calls), 0) AS calls FROM sessions WHERE exp > ${Math.floor(now / 1000)}`,
    );
  }
  const [usage, clients, sessions] = query(statements.join("; "));
  const limit = parseDailyCallLimit(readFileSync(`${web}/wrangler.jsonc`, "utf8"));
  const tokens = tokensPerCall();
  const summary = summarize(usage, { today, limit, tokensPerCall: tokens.tokensPerCall });
  const counts = detail
    ? {
        clients: clients?.[0]?.clients ?? 0,
        activeClients: clients?.[0]?.active ?? 0,
        clientCalls: clients?.[0]?.calls ?? 0,
        topClientCalls: clients?.[0]?.top ?? 0,
        sessions: sessions?.[0]?.sessions ?? 0,
        sessionCalls: sessions?.[0]?.calls ?? 0,
      }
    : null;
  console.log(formatReport(summary, { limit, ...tokens, detail: counts }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`spend: ${error instanceof Error ? error.message : error}`);
    process.exit(1);
  }
}
