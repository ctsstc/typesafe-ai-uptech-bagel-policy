import { describe, expect, it } from "vitest";
import { mockPolicyResponse } from "./mock";
import { isRuleErrorBody, isRuleResponse } from "./wire";

describe("isRuleResponse", () => {
  it("accepts a complete response", () => {
    expect(isRuleResponse(mockPolicyResponse("plain bagel"))).toBe(true);
  });

  it("rejects a response missing an answer", () => {
    const { answers, model } = mockPolicyResponse("plain bagel");
    const { outrage: _dropped, ...partial } = answers;
    expect(isRuleResponse({ model, answers: partial })).toBe(false);
  });
});

describe("isRuleErrorBody", () => {
  it("accepts known codes only", () => {
    expect(isRuleErrorBody({ error: { code: "timeout", message: "slow" } })).toBe(true);
    expect(isRuleErrorBody({ error: { code: "nope", message: "slow" } })).toBe(false);
  });
});
