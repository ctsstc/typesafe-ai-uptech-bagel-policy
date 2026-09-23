import { describe, expect, it } from "vitest";
import { expectedVerdicts, leakedNovelTerms, loadDataset, parseDataset, splitFor } from "./dataset";

describe("orders.json", () => {
  const items = loadDataset();

  it("loads and validates", () => {
    expect(items.length).toBeGreaterThan(0);
  });

  it("keeps novel terms out of the questions", () => {
    expect(leakedNovelTerms(items)).toEqual([]);
  });

  it("puts policy and incident items in canon only", () => {
    for (const item of items) {
      expect(item.split === "canon").toBe(item.source === "policy" || item.source === "incident");
    }
  });
});

describe("validation", () => {
  const bagel = { bagel: "proper", spread: "none", toppings: "none", sandwich: false };
  const parse = (item: object) => parseDataset(JSON.stringify([item]));

  it("rejects unnormalized orders, unknown fields and tiers", () => {
    expect(() => parse({ order: "Plain Bagel", ...bagel, source: "policy", note: "n" })).toThrow();
    expect(() =>
      parse({ order: "plain bagel", ...bagel, source: "policy", note: "n", x: 1 }),
    ).toThrow();
    expect(() =>
      parse({ order: "plain bagel", ...bagel, bagel: "great", source: "policy", note: "n" }),
    ).toThrow();
  });

  it("requires a novel term on consensus items", () => {
    expect(() =>
      parse({ order: "za'atar bagel", ...bagel, source: "consensus", note: "n" }),
    ).toThrow();
    expect(
      parse({
        order: "za'atar bagel",
        ...bagel,
        source: "consensus",
        note: "n",
        novel: ["za'atar"],
      }),
    ).toHaveLength(1);
  });

  it("keeps section labels off non-bagel items", () => {
    expect(() =>
      parse({ order: "croissant", kind: "other_food", ...bagel, source: "probe", note: "n" }),
    ).toThrow();
  });
});

describe("expectedVerdicts", () => {
  it("covers every accepted combination", () => {
    const verdicts = expectedVerdicts({
      bagel: ["proper"],
      spread: ["none"],
      toppings: ["proper", "borderline"],
      sandwich: "either",
    });
    expect([...verdicts].sort()).toEqual(["borderline", "proper", "violation"]);
  });
});

describe("splitFor", () => {
  it("depends only on the order text", () => {
    expect(splitFor("za'atar bagel", "consensus")).toBe(splitFor("za'atar bagel", "probe"));
  });
});
