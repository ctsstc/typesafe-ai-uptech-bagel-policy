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

describe("share links", () => {
  it("rules on the order in the URL and pushes new orders", async () => {
    window.history.replaceState(null, "", "/?order=plain+bagel");
    vi.stubGlobal("fetch", async (url: string) => {
      const order = new URL(url, "http://x").searchParams.get("order") ?? "";
      return Response.json({ ...mockPolicyResponse(order), mock: true });
    });
    render(<App />);

    expect(await screen.findByRole("heading", { name: "Proper" })).toBeInTheDocument();
    expect(screen.getByLabelText("What are you bringing?")).toHaveValue("plain bagel");

    await userEvent.click(
      screen.getByRole("button", { name: "cinnamon raisin with strawberry cream cheese" }),
    );
    expect(await screen.findByRole("heading", { name: "Violation" })).toBeInTheDocument();
    expect(window.location.search).toBe("?order=cinnamon+raisin+with+strawberry+cream+cheese");
  });

  it("copies the link", async () => {
    window.history.replaceState(null, "", "/?order=plain+bagel");
    vi.stubGlobal("fetch", async () =>
      Response.json({ ...mockPolicyResponse("plain bagel"), mock: true }),
    );
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    render(<App />);

    await userEvent.click(await screen.findByRole("button", { name: "Copy link" }));
    expect(writeText).toHaveBeenCalledWith(`${window.location.origin}/?order=plain+bagel`);
    expect(screen.getByText("Link copied.")).toBeInTheDocument();
  });

  it("keeps a declined order out of the URL and offers no share", async () => {
    window.history.replaceState(null, "", "/?order=slur+bagel");
    vi.stubGlobal("fetch", async () =>
      Response.json({ ...mockPolicyResponse("slur bagel"), mock: true }),
    );
    render(<App />);

    expect(await screen.findByText("The board declines to review that.")).toBeInTheDocument();
    expect(window.location.search).toBe("");
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });
});

describe("errors", () => {
  const refuse = (code: string, status: number, headers: Record<string, string> = {}) =>
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: { code, message: "nope" } }, { status, headers }),
    );

  it("offers a reload when the page is from another deploy", async () => {
    window.history.replaceState(null, "", "/?order=plain+bagel");
    refuse("stale_client", 409);
    render(<App />);

    expect(await screen.findByText(/^The board was updated\./)).toBeInTheDocument();
    const reload = vi.fn();
    vi.spyOn(window, "location", "get").mockReturnValue({ ...window.location, reload });
    await userEvent.click(screen.getByRole("button", { name: "Reload the page" }));
    expect(reload).toHaveBeenCalledOnce();
  });

  it("says the board is swamped when Pages answers with the SPA shell", async () => {
    window.history.replaceState(null, "", "/?order=plain+bagel");
    vi.stubGlobal(
      "fetch",
      async () =>
        new Response("<!doctype html><title>Bagel Review Board</title>", {
          headers: { "content-type": "text/html" },
        }),
    );
    render(<App />);

    expect(await screen.findByText(/^The board is swamped\./)).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reload the page" })).toBeNull();
  });

  it("says when new rulings open again after the daily limit", async () => {
    window.history.replaceState(null, "", "/?order=plain+bagel");
    refuse("daily_limit", 503, { "retry-after": "3600" });
    render(<App />);

    expect(
      await screen.findByText(/New rulings open again (tomorrow )?at .+ your time\./),
    ).toBeInTheDocument();
  });
});
