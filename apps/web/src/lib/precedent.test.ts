import { mockPolicyResponse, toPolicyResult } from "@bagel/core";
import { describe, expect, it } from "vitest";
import { isFoundingIncident } from "./precedent";

const rule = (order: string) => toPolicyResult(order, mockPolicyResponse(order));

describe("isFoundingIncident", () => {
  it("matches vanilla cream cheese however the order is phrased", () => {
    expect(isFoundingIncident(rule("bagel with vanilla cream cheese"))).toBe(true);
    expect(isFoundingIncident(rule("everything bagel, vanilla cream cheese, lox"))).toBe(true);
  });

  it("ignores other sweet spreads and orders without a vanilla spread", () => {
    expect(isFoundingIncident(rule("plain bagel with honey cream cheese"))).toBe(false);
    expect(isFoundingIncident(rule("plain bagel with plain cream cheese"))).toBe(false);
    expect(isFoundingIncident(rule("croissant with vanilla"))).toBe(false);
  });
});
