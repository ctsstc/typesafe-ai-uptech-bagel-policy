import { mockPolicyResponse, ruleUrl } from "@bagel/core";
import { act, render, screen, waitFor, within } from "@testing-library/react";
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

describe("while the board deliberates", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));

  it("shows progress on the Submit button and a placeholder card for the order", async () => {
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal("fetch", () => new Promise<Response>((resolve) => (answer = resolve)));
    render(<App />);
    await userEvent.type(screen.getByLabelText("What are you bringing?"), "plain bagel{Enter}");

    expect(screen.getByRole("button", { name: "Reviewing…" })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    expect(screen.getByText("The board is deliberating…")).toBeInTheDocument();
    expect(screen.getByText("“plain bagel”")).toHaveAttribute("aria-hidden", "true");

    answer(Response.json({ ...mockPolicyResponse("plain bagel"), mock: true }));
    expect(await screen.findByRole("heading", { name: "Proper" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit for review" })).not.toHaveAttribute(
      "aria-disabled",
      "true",
    );
  });

  const touchScreen = () =>
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));

  it("waits for the keyboard when Submit is tapped, not only on Enter", async () => {
    touchScreen();
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<App />);
    await userEvent.type(screen.getByLabelText("What are you bringing?"), "plain bagel");
    await userEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    expect(scroll).not.toHaveBeenCalled();
    await waitFor(() => expect(scroll).toHaveBeenCalled(), { timeout: 1000 });
  });

  it("drops the pending scroll when the visitor navigates away first", async () => {
    touchScreen();
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<App />);
    await userEvent.type(screen.getByLabelText("What are you bringing?"), "plain bagel{Enter}");
    act(() => {
      window.history.replaceState(null, "", "/");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(scroll).not.toHaveBeenCalled();
  });

  it("waits for the phone keyboard to close before scrolling", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal("fetch", () => new Promise<Response>(() => {}));
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<App />);
    await userEvent.type(screen.getByLabelText("What are you bringing?"), "plain bagel{Enter}");

    expect(scroll).not.toHaveBeenCalled();
    await waitFor(() => expect(scroll).toHaveBeenCalled(), { timeout: 1000 });
  });
});

describe("reviewing another order", () => {
  beforeEach(() => window.history.replaceState(null, "", "/"));

  it("takes the visitor back to the box with the last order selected", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      const order = new URL(url, "http://x").searchParams.get("order") ?? "";
      return Response.json({ ...mockPolicyResponse(order), mock: true });
    });
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");
    render(<App />);
    const input = screen.getByLabelText<HTMLInputElement>("What are you bringing?");
    await userEvent.click(screen.getByRole("button", { name: /plain bagel with avocado/ }));
    await screen.findByRole("heading", { name: "Borderline" });

    await userEvent.click(screen.getByRole("button", { name: "Review another order" }));
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(input.value.length);
    expect(scroll.mock.contexts.at(-1)).toBe(input);
    expect(scroll).toHaveBeenLastCalledWith({ behavior: "smooth", block: "center" });
  });

  it("lets the phone reveal the field itself instead of racing its keyboard", async () => {
    vi.stubGlobal("matchMedia", (query: string) => ({
      matches: query === "(pointer: coarse)",
      media: query,
      addEventListener: () => {},
      removeEventListener: () => {},
    }));
    vi.stubGlobal("fetch", async () =>
      Response.json({ ...mockPolicyResponse("plain bagel"), mock: true }),
    );
    render(<App />);
    const input = screen.getByLabelText<HTMLInputElement>("What are you bringing?");
    await userEvent.type(input, "plain bagel{Enter}");
    await screen.findByRole("heading", { name: "Proper" });
    const focus = vi.spyOn(input, "focus");
    const scroll = vi.spyOn(Element.prototype, "scrollIntoView");

    await userEvent.click(screen.getByRole("button", { name: "Review another order" }));
    expect(focus).toHaveBeenCalledWith();
    expect(scroll.mock.contexts).not.toContain(input);
    expect(input.selectionEnd).toBe("plain bagel".length);
  });

  it("is offered after an error", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: { code: "timeout", message: "slow" } }, { status: 504 }),
    );
    render(<App />);
    await userEvent.type(screen.getByLabelText("What are you bringing?"), "plain bagel{Enter}");
    expect(await screen.findByRole("button", { name: "Review another order" })).toBeVisible();
  });

  it("is not offered on a stale page, where only a reload helps", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: { code: "stale_client", message: "old" } }, { status: 409 }),
    );
    render(<App />);
    await userEvent.type(screen.getByLabelText("What are you bringing?"), "plain bagel{Enter}");
    expect(await screen.findByRole("button", { name: "Reload the page" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Review another order" })).toBeNull();
  });

  it("is offered after a declined order, with nothing to share", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ ...mockPolicyResponse("slur bagel"), mock: true }),
    );
    render(<App />);
    await userEvent.type(screen.getByLabelText("What are you bringing?"), "slur bagel{Enter}");
    expect(await screen.findByRole("button", { name: "Review another order" })).toBeVisible();
    expect(screen.queryByRole("button", { name: "Copy link" })).toBeNull();
  });
});
