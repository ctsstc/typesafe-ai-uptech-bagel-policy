import { describe, expect, it } from "vitest";
import { normalizeOrder, parseRuleQuery, ruleQuery } from "./input";

describe("normalizeOrder", () => {
  it("lowercases, collapses whitespace and trims trailing punctuation", () => {
    expect(normalizeOrder("  Everything   Bagel, LOX!! ")).toBe("everything bagel, lox");
  });

  it("is stable when applied twice", () => {
    const once = normalizeOrder("\u201cPlain\u201d bagel \u2014 with capers?");
    expect(normalizeOrder(once)).toBe(once);
  });
});

describe("parseRuleQuery", () => {
  it("accepts only the canonical query", () => {
    expect(parseRuleQuery(ruleQuery("plain bagel"))).toBe("plain bagel");
    expect(parseRuleQuery("order=Plain%20Bagel&v=1")).toBeNull();
    expect(parseRuleQuery(`${ruleQuery("plain bagel")}&x=1`)).toBeNull();
    expect(parseRuleQuery(ruleQuery("123"))).toBeNull();
  });
});
