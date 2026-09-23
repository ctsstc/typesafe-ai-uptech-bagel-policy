import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { buildPolicyRequest, POLICY_MODEL, QUESTION_SET_VERSION } from "@bagel/core";
import { TypeSafeClient } from "@typesafe-ai/sdk";
import { parseRaw, type RawRecord, requestFingerprint, resultsDir, serializeRaw } from "./cache";
import { type LabelledItem, leakedNovelTerms, loadDataset, SPLITS, type Split } from "./dataset";
import { describeFailure, renderReport } from "./report";
import { scoreItem, summarize } from "./score";
import { costUsd, ledgerTotal, parseLedger, type SpendEntry } from "./spend";

const CONCURRENCY = 4;
const FALLBACK_INPUT_TOKENS = 5_000;
const DEFAULT_MAX_USD = 0.05;
// All live eval calls ever made, summed from results/spend.jsonl. Raise it deliberately, not by flag.
export const TOTAL_BUDGET_USD = 0.25;
const LEDGER_PATH = new URL("../results/spend.jsonl", import.meta.url);

interface Options {
  readonly fresh: boolean;
  readonly offline: boolean;
  readonly splits: ReadonlySet<Split> | null;
  readonly maxUsd: number;
}

function parseArgs(argv: readonly string[]): Options {
  let fresh = false;
  let offline = false;
  let splits: Set<Split> | null = null;
  let maxUsd = DEFAULT_MAX_USD;
  for (const arg of argv) {
    if (arg === "--") continue;
    const [name, value] = arg.split("=", 2);
    if (arg === "--fresh") fresh = true;
    else if (arg === "--offline") offline = true;
    else if (name === "--split" && value) {
      const names = value.split(",");
      const unknown = names.filter((n) => !(SPLITS as readonly string[]).includes(n));
      if (unknown.length > 0) throw new Error(`Unknown split ${unknown.join(", ")}`);
      splits = new Set(names as Split[]);
    } else if (name === "--max-usd" && value && Number.isFinite(Number(value))) {
      maxUsd = Number(value);
    } else {
      throw new Error(
        `Unknown argument ${arg}. Accepted: --fresh, --offline, --split=<${SPLITS.join("|")},...>, --max-usd=<n>`,
      );
    }
  }
  if (fresh && offline) throw new Error("--fresh refetches everything, so it cannot run --offline");
  return { fresh, offline, splits, maxUsd };
}

async function eachWithLimit<T>(items: readonly T[], work: (item: T) => Promise<void>) {
  const queue = [...items];
  const worker = async () => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) await work(next);
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker));
}

async function fetchRecord(
  client: TypeSafeClient,
  { order }: LabelledItem,
  fingerprint: string,
): Promise<RawRecord> {
  const started = performance.now();
  const data = await client.systemOne(buildPolicyRequest(order));
  return {
    order,
    version: QUESTION_SET_VERSION,
    fingerprint,
    model: data.model,
    answers: data.answers,
    usage: { input_tokens: data.usage.input_tokens, output_tokens: data.usage.output_tokens },
    latencyMs: Math.round(performance.now() - started),
    fetchedAt: new Date().toISOString(),
  };
}

function errorSummary(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const status = "status" in error ? ` ${String(error.status)}` : "";
  return `${error.name}${status}: ${error.message}`;
}

async function main(): Promise<void> {
  const { fresh, offline, splits, maxUsd } = parseArgs(process.argv.slice(2));
  const items = loadDataset();
  const leaks = leakedNovelTerms(items);
  if (leaks.length > 0) {
    throw new Error(`Novel terms now appear in the questions:\n  ${leaks.join("\n  ")}`);
  }
  const wanted = splits ? items.filter((item) => splits.has(item.split)) : items;
  const fingerprint = requestFingerprint();
  const dir = resultsDir(QUESTION_SET_VERSION);
  const rawPath = new URL("raw.jsonl", dir);
  mkdirSync(dir, { recursive: true });

  const cache = existsSync(rawPath) ? parseRaw(readFileSync(rawPath, "utf8")) : new Map();
  const stale = [...cache.values()].filter(
    (r) => r.fingerprint !== fingerprint || r.version !== QUESTION_SET_VERSION,
  );
  if (stale.length > 0 && !fresh) {
    throw new Error(
      `${stale.length} cached answers in ${fileURLToPath(dir)} came from a different request. The questions changed without a QUESTION_SET_VERSION bump. Bump it, or rerun with --fresh.`,
    );
  }
  for (const record of stale) cache.delete(record.order);

  const todo = fresh ? wanted : wanted.filter((item) => !cache.has(item.order));
  const known = [...cache.values()].map((r) => r.usage.input_tokens);
  const perCall = known.length
    ? known.reduce((a, b) => a + b, 0) / known.length
    : FALLBACK_INPUT_TOKENS;
  const estimate = costUsd(todo.length * perCall);
  const ledger = existsSync(LEDGER_PATH) ? parseLedger(readFileSync(LEDGER_PATH, "utf8")) : [];
  const spent = ledgerTotal(ledger);
  const errors: string[] = [];

  if (todo.length > 0 && offline) {
    console.log(
      `Offline: ${todo.length} items have no cached answer and will be reported missing.`,
    );
  } else if (todo.length > 0) {
    if (estimate > maxUsd) {
      throw new Error(
        `${todo.length} calls would cost about $${estimate.toFixed(4)}, over --max-usd=${maxUsd}. Narrow the run with --split.`,
      );
    }
    if (spent + estimate > TOTAL_BUDGET_USD) {
      throw new Error(
        `Eval spend so far is $${spent.toFixed(4)}. Another $${estimate.toFixed(4)} would pass the $${TOTAL_BUDGET_USD} budget in eval/src/run.ts.`,
      );
    }
    if (!process.env.TYPESAFE_API_KEY?.trim()) {
      throw new Error("TYPESAFE_API_KEY is not set. Add it to the root .env, or run --offline.");
    }
    console.log(
      `Fetching ${todo.length} of ${items.length} items from ${POLICY_MODEL} (question set v${QUESTION_SET_VERSION}), about $${estimate.toFixed(4)}. Spent so far $${spent.toFixed(4)} of $${TOTAL_BUDGET_USD}.`,
    );
    const client = new TypeSafeClient();
    let calls = 0;
    let inputTokens = 0;
    await eachWithLimit(todo, async (item) => {
      try {
        const record = await fetchRecord(client, item, fingerprint);
        cache.set(item.order, record);
        appendFileSync(rawPath, serializeRaw([record]));
        calls += 1;
        inputTokens += record.usage.input_tokens;
      } catch (error) {
        errors.push(`${item.order}: ${errorSummary(error)}`);
        console.error(`FAILED ${item.order}: ${errorSummary(error)}`);
      }
    });
    const entry: SpendEntry = {
      at: new Date().toISOString(),
      version: QUESTION_SET_VERSION,
      calls,
      inputTokens,
      usd: Number(costUsd(inputTokens).toFixed(6)),
    };
    appendFileSync(LEDGER_PATH, `${JSON.stringify(entry)}\n`);
    console.log(
      `Made ${calls} calls, ${inputTokens} input tokens, $${entry.usd.toFixed(4)}. Eval total now $${(spent + entry.usd).toFixed(4)}.`,
    );
  } else {
    console.log(`All ${wanted.length} requested items are cached for v${QUESTION_SET_VERSION}.`);
  }

  writeFileSync(rawPath, serializeRaw(cache.values()));

  const scored = items.flatMap((item) => {
    const record = cache.get(item.order);
    return record ? [scoreItem(item, record)] : [];
  });
  const models = [...new Set([...cache.values()].map((r) => r.model))];
  const summary = summarize(scored, {
    questionSetVersion: QUESTION_SET_VERSION,
    model: models.length ? models.join(", ") : POLICY_MODEL,
    fingerprint,
    datasetSize: items.length,
  });
  writeFileSync(new URL("summary.json", dir), `${JSON.stringify(summary, null, 2)}\n`);
  writeFileSync(new URL("report.md", dir), renderReport(summary, scored));

  const { canon, tune, holdout } = summary.splits;
  console.log(
    [
      "",
      `Verdicts: canon ${canon.verdict.right}/${canon.verdict.n}, tune ${tune.verdict.right}/${tune.verdict.n}, holdout ${holdout.verdict.right}/${holdout.verdict.n}`,
      "",
      "Canon and tune failures:",
      ...scored
        .filter((o) => (o.split === "canon" || o.split === "tune") && !o.correct)
        .map((o) => `  ${describeFailure(o)}`),
      "",
      `Wrote ${fileURLToPath(new URL("report.md", dir))}`,
    ].join("\n"),
  );
  if (errors.length > 0) process.exitCode = 1;
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
