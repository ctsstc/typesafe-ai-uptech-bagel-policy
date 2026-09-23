import { mockPolicyResponse, toPolicyResult } from "@bagel/core";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { RulingCard } from "./RulingCard";

const card = (order: string) =>
  render(<RulingCard result={toPolicyResult(order, mockPolicyResponse(order))} mock={false} />);

describe("RulingCard", () => {
  it("flags a sandwich without changing the verdict", () => {
    card("bacon egg and cheese sandwich on an everything bagel");
    expect(screen.getByRole("heading", { name: "Borderline" })).toBeInTheDocument();
    expect(screen.getByText("Sandwich alert.")).toBeInTheDocument();
  });

  it("shows no flag on an open-faced bagel", () => {
    card("everything bagel with cream cheese, lox and capers");
    expect(screen.queryByText("Sandwich alert.")).toBeNull();
  });
});
