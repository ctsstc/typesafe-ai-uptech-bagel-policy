import { mockPolicyResponse, ruleUrl } from "@bagel/core";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { App } from "./App";

describe("App", () => {
  it("rules on a typed order", async () => {
    const fetch = vi.fn(async () =>
      Response.json({ ...mockPolicyResponse("plain bagel with lox"), mock: true }),
    );
    vi.stubGlobal("fetch", fetch);
    render(<App />);

    await userEvent.type(screen.getByLabelText("What are you bringing?"), "Plain Bagel with LOX");
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    expect(await screen.findByRole("heading", { name: "Proper" })).toBeInTheDocument();
    expect(fetch).toHaveBeenCalledWith(ruleUrl("plain bagel with lox"), expect.anything());
  });
});
