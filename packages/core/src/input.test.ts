import { describe, expect, it } from "vitest";
import { isStaleRuleQuery, normalizeOrder, parseRuleQuery, ruleQuery } from "./input";
import { QUESTION_SET_VERSION } from "./questions";

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

describe("isStaleRuleQuery", () => {
  it("spots a canonical query from another question set only", () => {
    const old = new URLSearchParams({ order: "plain bagel", v: "0" }).toString();
    expect(isStaleRuleQuery(old)).toBe(true);
    expect(isStaleRuleQuery(ruleQuery("plain bagel"))).toBe(false);
    expect(isStaleRuleQuery(`order=Plain&v=0`)).toBe(false);
    expect(QUESTION_SET_VERSION).not.toBe("0");
  });
});
