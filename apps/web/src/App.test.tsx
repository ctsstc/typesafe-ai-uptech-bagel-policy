import { mockPolicyResponse, ruleUrl } from "@bagel/core";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("examples", () => {
  it("leads with the vanilla cream cheese incident, labelled where everyone can see it", () => {
    vi.stubGlobal("fetch", async () => Response.json({}));
    render(<App />);
    const [first] = within(screen.getByRole("list", { name: "Examples" })).getAllByRole("button");
    expect(first).toHaveTextContent("Where it all began");
    expect(first).toHaveTextContent("bagel with vanilla cream cheese");
  });

  it("fills in only the order, not the label", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ ...mockPolicyResponse("bagel with vanilla cream cheese"), mock: true }),
    );
    render(<App />);
    await userEvent.click(screen.getByRole("button", { name: /Where it all began/ }));
    expect(screen.getByLabelText("What are you bringing?")).toHaveValue(
      "bagel with vanilla cream cheese",
    );
    expect(await screen.findByText("Precedent.")).toBeInTheDocument();
  });
});

describe("footer", () => {
  it("says who made it and links the source", () => {
    vi.stubGlobal("fetch", async () => Response.json({}));
    render(<App />);
    expect(
      screen.getByText(/Made by an Uptech employee, not an official Uptech product\./),
    ).toBeInTheDocument();
    expect(screen.getByText(/not affiliated with or endorsing this site/)).toBeInTheDocument();
    expect(screen.getByText(/Built with/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Claude Code" })).toHaveAttribute(
      "href",
      "https://claude.com/claude-code",
    );
    expect(screen.getByRole("link", { name: "Cody Swartz on LinkedIn" })).toBeInTheDocument();
    expect(screen.getByText("v0.0.0-test")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Source code on GitHub" })).toHaveAttribute(
      "href",
      "https://github.com/ctsstc/typesafe-ai-uptech-bagel-policy",
    );
  });
});

describe("showing the ruling", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));

  const media = (matching: string[]) =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: matching.includes(query),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }));

  const ruling = () =>
    vi.stubGlobal("fetch", async (url: string) => {
      const order = new URL(url, "http://x").searchParams.get("order") ?? "";
      return Response.json({ ...mockPolicyResponse(order), mock: true });
    });

  it("scrolls the ruling into view when an order is submitted", async () => {
    ruling();
    media([]);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<App />);
    expect(scroll).not.toHaveBeenCalled();

    await userEvent.click(screen.getByRole("button", { name: /plain bagel with avocado/ }));
    await waitFor(() =>
      expect(scroll).toHaveBeenCalledWith({ behavior: "smooth", block: "start" }),
    );
    expect(scroll.mock.contexts.at(-1)).toHaveClass("result-slot");
    // Once for the pending state, and again once the card has made the page tall enough.
    expect(await screen.findByRole("heading", { name: "Borderline" })).toBeInTheDocument();
    await waitFor(() => expect(scroll.mock.calls.length).toBeGreaterThanOrEqual(2));
  });

  it("jumps instead of gliding when the visitor prefers reduced motion", async () => {
    ruling();
    media(["(prefers-reduced-motion: reduce)"]);
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    window.history.replaceState(null, "", "/?order=plain+bagel");
    render(<App />);
    await waitFor(() => expect(scroll).toHaveBeenCalledWith({ behavior: "auto", block: "start" }));
  });

  it("closes the phone keyboard on submit, but keeps focus on a desktop", async () => {
    ruling();
    media(["(pointer: coarse)"]);
    const { unmount } = render(<App />);
    const input = screen.getByLabelText("What are you bringing?");
    await userEvent.type(input, "plain bagel{Enter}");
    expect(document.activeElement).not.toBe(input);
    unmount();

    media([]);
    window.history.replaceState(null, "", "/");
    render(<App />);
    const desktopInput = screen.getByLabelText("What are you bringing?");
    await userEvent.type(desktopInput, "plain bagel{Enter}");
    expect(document.activeElement).toBe(desktopInput);
  });
});
