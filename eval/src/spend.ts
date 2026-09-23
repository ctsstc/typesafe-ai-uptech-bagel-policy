export { costUsd } from "./score";

export interface SpendEntry {
  readonly at: string;
  readonly version: string;
  readonly calls: number;
  readonly inputTokens: number;
  readonly usd: number;
}

export function parseLedger(text: string): SpendEntry[] {
  return text
    .split("\n")
    .filter((line) => line.trim() !== "")
    .map((line, index) => {
      const entry = JSON.parse(line) as Partial<SpendEntry>;
      if (typeof entry.usd !== "number" || typeof entry.calls !== "number") {
        throw new Error(`spend.jsonl line ${index + 1} is not a spend entry`);
      }
      return entry as SpendEntry;
    });
}

export function ledgerTotal(entries: readonly SpendEntry[]): number {
  return entries.reduce((sum, entry) => sum + entry.usd, 0);
}
