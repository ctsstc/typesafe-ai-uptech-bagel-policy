import type { ChoiceResponse, NoulResponse, ScoreResponse } from "@typesafe-ai/sdk";
import {
  BAGEL_TIERS,
  type BagelTier,
  INPUT_KIND_IDS,
  type InputKindId,
  SPREAD_TIERS,
  type SpreadTier,
  TOPPING_TIERS,
  type ToppingTier,
} from "./policy";
import { OUTRAGE_LEVELS, type PolicyResponse } from "./questions";

// Keyless development only: keyword answers shaped like a live response, never real rulings.
export const MOCK_DECLINE_TRIGGER = "slur";
const MOCK_NONSENSE = /[bcdfghjklmnpqrstvwxz]{5,}/;
const MOCK_NOT_FOOD = /\b(stapler|chair|phone|boss|moon|car|shoe|laptop)s?\b/;

const NOT_A_BAGEL = /cinnamon|raisin|blueberry|chocolate chip|pumpkin|french toast|funfetti/;
const CHEESE_BAKED = /asiago|cheddar|parmesan|cheese bagel/;
const SPREAD = /cream cheese|schmear|spread/;
const SWEET_SPREAD = /vanilla|honey|strawberry|sweet|cinnamon sugar|maple/;
const VEGGIE_SPREAD = /veggie|vegetable|garden/;
const SAVORY_SPREAD = /chive|scallion|onion|garlic|herb|lox|jalape/;
const JUST_STOP = /peanut butter|jelly|jam|nutella|chocolate chip|banana/;
const MISC_VEG = /carrot|spinach|pepper|sprout|lettuce/;
const BORDERLINE = /avocado|cucumber|bacon|cheese/;
const ACCEPTABLE_TOPPING = /whitefish|dill|chive|yellow onion|white onion|smoked|cured/;
const PROPER_TOPPING = /lox|nova|red onion|caper|tomato/;
const SANDWICH = /sandwich|\bblt\b|egg and cheese|turkey|ham\b|club/;

function hashOrder(text: string): number {
  let h = 2166136261;
  for (const ch of text) h = Math.imul(h ^ (ch.codePointAt(0) ?? 0), 16777619);
  return h >>> 0;
}

function mockChoice<K extends string>(
  ids: readonly K[],
  pick: K,
  seed: number,
): ChoiceResponse<Record<K, null>> {
  const top = [0.91, 0.7, 0.46][seed % 3] ?? 0.91;
  const rest = (1 - top) / Math.max(1, ids.length - 1);
  const probabilities = Object.fromEntries(
    ids.map((id) => [id, id === pick ? top : rest]),
  ) as Record<K, number>;
  return { type: "choice", choice: pick, confidence: top, probabilities };
}

const mockNoul = (yes: boolean): NoulResponse => ({ type: "noul", noul: yes ? 0.9 : 0.05 });

function mockScore(score: number): ScoreResponse<typeof OUTRAGE_LEVELS> {
  const probabilities = { 0: 0.25, 1: 0.25, 2: 0.25, 3: 0.25 };
  const legend = {
    0: OUTRAGE_LEVELS[0],
    1: OUTRAGE_LEVELS[1],
    2: OUTRAGE_LEVELS[2],
    3: OUTRAGE_LEVELS[3],
  };
  return { type: "score", score, confidence: 0.6, legend, probabilities };
}

function inputKind(order: string): InputKindId {
  if (MOCK_NONSENSE.test(order)) return "nonsense";
  if (MOCK_NOT_FOOD.test(order)) return "not_food";
  return /bagel|lox|schmear|cream cheese/.test(order) ? "bagel_order" : "other_food";
}

function bagelTier(head: string): BagelTier {
  if (NOT_A_BAGEL.test(head)) return "not_a_bagel";
  if (CHEESE_BAKED.test(head)) return "acceptable";
  if (
    /plain|onion|sesame|poppy|garlic|salt|everything|pumpernickel|rye|egg|whole wheat/.test(head)
  ) {
    return "proper";
  }
  return "unspecified";
}

function spreadTier(spread: string | undefined): SpreadTier {
  if (spread === undefined) return "none";
  if (SWEET_SPREAD.test(spread)) return "sweet";
  if (VEGGIE_SPREAD.test(spread)) return "garden_veggie";
  if (SAVORY_SPREAD.test(spread)) return "acceptable";
  return "proper";
}

function toppingTier(rest: string): ToppingTier {
  if (JUST_STOP.test(rest)) return "just_stop";
  if (MISC_VEG.test(rest)) return "misc_vegetables";
  if (BORDERLINE.test(rest)) return "borderline";
  if (ACCEPTABLE_TOPPING.test(rest)) return "acceptable";
  if (PROPER_TOPPING.test(rest)) return "proper";
  return "none";
}

export function mockPolicyResponse(order: string): PolicyResponse {
  const seed = hashOrder(order);
  const [head = "", ...tail] = order.split(/\s+with\s+|,|\s+and\s+|\s*\+\s*/);
  const parts = tail.map((p) => p.trim());
  const spread = SPREAD.test(head) ? head : parts.find((p) => SPREAD.test(p));
  const toppings = parts.filter((p) => p !== spread).join(" ");
  const bagel = bagelTier(head);
  const worst = [bagel, spreadTier(spread), toppingTier(toppings)];
  const outrage =
    worst.includes("just_stop") || worst.includes("sweet")
      ? 3
      : worst.includes("not_a_bagel")
        ? 2
        : 0;

  return {
    model: "mock",
    answers: {
      is_abusive: mockNoul(order.includes(MOCK_DECLINE_TRIGGER)),
      input_kind: mockChoice(INPUT_KIND_IDS, inputKind(order), seed),
      bagel: mockChoice(Object.keys(BAGEL_TIERS) as BagelTier[], bagel, seed),
      spread: mockChoice(Object.keys(SPREAD_TIERS) as SpreadTier[], spreadTier(spread), seed),
      toppings: mockChoice(
        Object.keys(TOPPING_TIERS) as ToppingTier[],
        toppingTier(toppings),
        seed,
      ),
      is_sandwich: mockNoul(SANDWICH.test(order)),
      sun_dried_tomatoes: mockNoul(order.includes("sun-dried") || order.includes("sun dried")),
      outrage: mockScore(outrage),
    },
  };
}
