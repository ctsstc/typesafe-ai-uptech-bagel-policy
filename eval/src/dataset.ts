import { readFileSync } from "node:fs";
import {
  BAGEL_TIERS,
  type BagelTier,
  buildPolicyQuestions,
  hasUsableText,
  INPUT_KIND_IDS,
  type InputKindId,
  normalizeOrder,
  SECTIONS,
  SPREAD_TIERS,
  type SpreadTier,
  TOPPING_TIERS,
  type ToppingTier,
  type VerdictId,
  verdictOf,
} from "@bagel/core";

// policy: named on the policy page. incident: an office incident under the policy. Both are canon.
export const SOURCES = ["policy", "incident", "consensus", "probe"] as const;
export type Source = (typeof SOURCES)[number];

export const SPLITS = ["canon", "tune", "holdout"] as const;
export type Split = (typeof SPLITS)[number];

export const TUNE_PERCENT = 60;
export const DATASET_PATH = new URL("../data/orders.json", import.meta.url);

type OneOrMany<T> = T | readonly T[];

export interface EvalItem {
  readonly order: string;
  readonly kind?: InputKindId;
  readonly bagel?: OneOrMany<BagelTier>;
  readonly spread?: OneOrMany<SpreadTier>;
  readonly toppings?: OneOrMany<ToppingTier>;
  readonly sandwich?: boolean | "either";
  readonly sunDried?: boolean;
  readonly novel?: readonly string[];
  readonly source: Source;
  readonly note: string;
}

export interface BagelLabels {
  readonly bagel: readonly BagelTier[];
  readonly spread: readonly SpreadTier[];
  readonly toppings: readonly ToppingTier[];
  readonly sandwich: boolean | "either";
  readonly verdicts: readonly VerdictId[];
}

export interface LabelledItem {
  readonly order: string;
  readonly kind: InputKindId;
  readonly labels: BagelLabels | null;
  readonly sunDried?: boolean;
  readonly novel: readonly string[];
  readonly source: Source;
  readonly note: string;
  readonly split: Split;
}

const FIELDS = new Set([
  "order",
  "kind",
  "bagel",
  "spread",
  "toppings",
  "sandwich",
  "sunDried",
  "novel",
  "source",
  "note",
]);

export function fnv1a(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
  return h >>> 0;
}

export function splitFor(order: string, source: Source): Split {
  if (source === "policy" || source === "incident") return "canon";
  return fnv1a(order) % 100 < TUNE_PERCENT ? "tune" : "holdout";
}

const asList = <T>(value: OneOrMany<T>): readonly T[] =>
  Array.isArray(value) ? value : [value as T];

function tiers<T extends string>(
  value: OneOrMany<T> | undefined,
  known: Record<string, unknown>,
  where: string,
): readonly T[] {
  if (value === undefined) throw new Error(`${where}: missing`);
  const list = asList(value);
  if (list.length === 0 || new Set(list).size !== list.length) {
    throw new Error(`${where}: needs one or more distinct tiers`);
  }
  for (const tier of list) if (!Object.hasOwn(known, tier)) throw new Error(`${where}: ${tier}`);
  return list;
}

/** Every verdict some accepted combination of labels produces. */
export function expectedVerdicts(labels: Omit<BagelLabels, "verdicts">): readonly VerdictId[] {
  const verdicts = new Set<VerdictId>();
  for (const b of labels.bagel)
    for (const s of labels.spread)
      for (const t of labels.toppings) {
        const severities = [
          SECTIONS.bagel.tiers[b].severity,
          SECTIONS.spread.tiers[s].severity,
          SECTIONS.toppings.tiers[t].severity,
        ];
        verdicts.add(verdictOf(severities));
      }
  return [...verdicts];
}

export function validateItem(raw: unknown, index: number): LabelledItem {
  if (typeof raw !== "object" || raw === null) throw new Error(`item ${index}: not an object`);
  const extra = Object.keys(raw).filter((key) => !FIELDS.has(key));
  if (extra.length > 0) throw new Error(`item ${index}: unknown fields ${extra.join(", ")}`);
  const item = raw as EvalItem;
  const where = `item ${index} (${item.order})`;
  if (typeof item.order !== "string" || item.order !== normalizeOrder(item.order)) {
    throw new Error(`${where}: order must already be normalized`);
  }
  if (!hasUsableText(item.order)) throw new Error(`${where}: no usable text`);
  if (!(SOURCES as readonly string[]).includes(item.source)) throw new Error(`${where}: source`);
  if (typeof item.note !== "string" || item.note.trim() === "") throw new Error(`${where}: note`);
  const kind = item.kind ?? "bagel_order";
  if (!(INPUT_KIND_IDS as readonly string[]).includes(kind)) throw new Error(`${where}: kind`);
  if (item.kind === "bagel_order") throw new Error(`${where}: bagel_order is the default, omit it`);
  const novel = item.novel ?? [];
  if (item.source === "consensus" && novel.length === 0) {
    throw new Error(`${where}: consensus items name their novel ingredient`);
  }

  let labels: BagelLabels | null = null;
  if (kind === "bagel_order") {
    if (item.sandwich !== true && item.sandwich !== false && item.sandwich !== "either") {
      throw new Error(`${where}: sandwich`);
    }
    const base = {
      bagel: tiers(item.bagel, BAGEL_TIERS, `${where} bagel`),
      spread: tiers(item.spread, SPREAD_TIERS, `${where} spread`),
      toppings: tiers(item.toppings, TOPPING_TIERS, `${where} toppings`),
      sandwich: item.sandwich,
    };
    labels = { ...base, verdicts: expectedVerdicts(base) };
  } else if (
    [item.bagel, item.spread, item.toppings, item.sandwich, item.sunDried].some(
      (v) => v !== undefined,
    )
  ) {
    throw new Error(`${where}: only bagel orders carry section labels`);
  }

  return {
    order: item.order,
    kind,
    labels,
    ...(item.sunDried === undefined ? {} : { sunDried: item.sunDried }),
    novel,
    source: item.source,
    note: item.note,
    split: splitFor(item.order, item.source),
  };
}

export function parseDataset(text: string): LabelledItem[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) throw new Error("orders.json must be an array");
  const items = raw.map(validateItem);
  const seen = new Set<string>();
  for (const { order } of items) {
    if (seen.has(order)) throw new Error(`duplicate order: ${order}`);
    seen.add(order);
  }
  return items;
}

export function loadDataset(): LabelledItem[] {
  return parseDataset(readFileSync(DATASET_PATH, "utf8"));
}

/** Novel terms that the questions now mention, which would turn a generalization test into a lookup. */
export function leakedNovelTerms(items: readonly LabelledItem[]): string[] {
  const prompt = JSON.stringify(buildPolicyQuestions()).toLowerCase();
  return items.flatMap((item) =>
    item.novel
      .filter((term) => prompt.includes(term.toLowerCase()))
      .map((t) => `${item.order}: ${t}`),
  );
}
