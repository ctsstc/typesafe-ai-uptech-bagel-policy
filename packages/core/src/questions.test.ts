import { describe, expect, it } from "vitest";
import { buildPolicyQuestions, POLICY_ANSWER_TYPES } from "./questions";

describe("buildPolicyQuestions", () => {
  it("matches POLICY_ANSWER_TYPES", () => {
    const types = Object.fromEntries(
      Object.entries(buildPolicyQuestions()).map(([id, q]) => [id, q.type]),
    );
    expect(types).toEqual(POLICY_ANSWER_TYPES);
  });
});
