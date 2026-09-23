import { createHash } from "node:crypto";
import { buildPolicyRequest, type PolicyAnswers } from "@bagel/core";

export interface RawRecord {
  readonly order: string;
  readonly version: string;
  readonly fingerprint: string;
  readonly model: string;
  readonly answers: PolicyAnswers;
  readonly usage: { readonly input_tokens: number; readonly output_tokens: number };
  readonly latencyMs: number;
  readonly fetchedAt: string;
}

export function requestFingerprint(): string {
  return createHash("sha256")
    .update(JSON.stringify(buildPolicyRequest("x")))
    .digest("hex");
}

export function resultsDir(version: string): URL {
  return new URL(`../results/v${version}/`, import.meta.url);
}

function isRawRecord(value: unknown): value is RawRecord {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.order === "string" &&
    typeof record.version === "string" &&
    typeof record.fingerprint === "string" &&
    typeof record.answers === "object" &&
    record.answers !== null &&
    typeof record.usage === "object" &&
    typeof record.latencyMs === "number"
  );
}

// Later lines win, so an interrupted --fresh run still leaves the newest answer for each order.
export function parseRaw(text: string): Map<string, RawRecord> {
  const records = new Map<string, RawRecord>();
  text.split("\n").forEach((line, index) => {
    if (line.trim() === "") return;
    const value: unknown = JSON.parse(line);
    if (!isRawRecord(value)) throw new Error(`raw.jsonl line ${index + 1} is not a raw record`);
    records.set(value.order, value);
  });
  return records;
}

export function serializeRaw(records: Iterable<RawRecord>): string {
  const sorted = [...records].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0));
  return sorted.map((record) => `${JSON.stringify(record)}\n`).join("");
}
