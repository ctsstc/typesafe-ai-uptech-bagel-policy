import { mockPolicyResponse, QUESTION_SET_VERSION } from "@bagel/core";
import { describe, expect, it } from "vitest";
import type { RawRecord } from "./cache";
import { parseDataset } from "./dataset";
import { scoreItem, summarize, verdictAtSandwich } from "./score";

const record = (order: string): RawRecord => ({
  order,
  version: QUESTION_SET_VERSION,
  fingerprint: "f",
  ...mockPolicyResponse(order),
  usage: { input_tokens: 4000, output_tokens: 0 },
  latencyMs: 100,
  fetchedAt: "2026-09-23T00:00:00Z",
});

const [cinnamon, croissant] = parseDataset(
  JSON.stringify([
    {
      order: "cinnamon raisin bagel",
      bagel: "not_a_bagel",
      spread: "none",
      toppings: "none",
      sandwich: false,
      source: "policy",
      note: "n",
    },
    { order: "croissant", kind: "other_food", source: "probe", note: "n" },
  ]),
);

describe("scoreItem", () => {
  it("scores a bagel order by the app's verdict", () => {
    if (!cinnamon) throw new Error("fixture");
    const outcome = scoreItem(cinnamon, record(cinnamon.order));
    expect(outcome).toMatchObject({ verdict: "violation", correct: true, sandwichCorrect: true });
    expect(outcome.fields.bagel).toMatchObject({ got: "not_a_bagel", correct: true });
  });

  it("scores a non-bagel item by the out-of-scope reason", () => {
    if (!croissant) throw new Error("fixture");
    expect(scoreItem(croissant, record(croissant.order))).toMatchObject({
      correct: true,
      verdict: null,
    });
  });

  it("recomputes verdicts for the sandwich sweep", () => {
    if (!cinnamon) throw new Error("fixture");
    const outcome = scoreItem(cinnamon, record(cinnamon.order));
    expect(verdictAtSandwich(outcome, 0.01)).toBe("violation");
  });
});

describe("summarize", () => {
  it("prices a full pass from average input tokens", () => {
    if (!cinnamon || !croissant) throw new Error("fixture");
    const outcomes = [cinnamon, croissant].map((i) => scoreItem(i, record(i.order)));
    const summary = summarize(outcomes, {
      questionSetVersion: "1",
      model: "mock",
      fingerprint: "f",
      datasetSize: 2,
    });
    expect(summary.costPerPassUsd).toBeCloseTo(0.000336, 6);
    expect(summary.splits.canon.verdict).toEqual({ right: 1, n: 1 });
  });
});
