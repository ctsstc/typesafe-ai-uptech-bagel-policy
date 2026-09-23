import { describe, expect, it } from "vitest";
import { mockPolicyResponse } from "./mock";
import { toPolicyResult } from "./result";

const rule = (order: string) => toPolicyResult(order, mockPolicyResponse(order));

describe("toPolicyResult", () => {
  it.each([
    ["everything bagel with cream cheese, lox, capers and red onion", "proper"],
    ["asiago bagel with scallion cream cheese", "acceptable"],
    ["plain bagel with avocado", "borderline"],
    ["cinnamon raisin bagel with cream cheese", "violation"],
    ["plain bagel with garden veggie cream cheese", "violation"],
    ["sesame bagel with peanut butter and banana", "just_stop"],
    ["bacon egg and cheese sandwich on an everything bagel", "violation"],
  ])("%s is %s", (order, verdict) => {
    const result = rule(order);
    expect(result.kind).toBe("ruling");
    if (result.kind === "ruling") expect(result.verdict).toBe(verdict);
  });

  it("sends orders without a bagel out of scope", () => {
    expect(rule("croissant")).toMatchObject({ kind: "out_of_scope", reason: "other_food" });
  });

  it("declines abusive text without echoing it", () => {
    expect(rule("slur bagel")).toEqual({ kind: "declined", model: "mock" });
  });

  it("flags sun-dried tomatoes without raising the verdict", () => {
    const result = rule("plain bagel with sun-dried tomato cream cheese");
    expect(result).toMatchObject({ kind: "ruling", sunDried: true });
  });
});
