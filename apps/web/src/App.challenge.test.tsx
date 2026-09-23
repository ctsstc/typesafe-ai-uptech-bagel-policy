import { mockPolicyResponse, ruleUrl, SESSION_PATH } from "@bagel/core";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { App } from "./App";
import type { TurnstileApi } from "./lib/challenge";
import { WAITING_FOR_CHECK } from "./lib/errors";

type Options = Parameters<TurnstileApi["render"]>[1];

const card = () => document.querySelector<HTMLElement>(".challenge");

describe("the human check inside the app", () => {
  let options: Options | undefined;
  let fetchMock: Mock<(url: string, init?: RequestInit) => Promise<Response>>;

  beforeEach(() => {
    history.replaceState(null, "", "/");
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "3x00000000000000000000FF");
    options = undefined;
    window.turnstile = {
      render: vi.fn((_container: HTMLElement, next: Options) => {
        options = next;
        return "widget-1";
      }),
      remove: vi.fn(),
    };
    fetchMock = vi.fn(async (url: string) => {
      if (url === SESSION_PATH) return new Response(null, { status: 204 });
      const posted = fetchMock.mock.calls.some(([u]) => u === SESSION_PATH);
      if (!posted) {
        return Response.json(
          { error: { code: "challenge_required", message: "check" } },
          { status: 401 },
        );
      }
      return Response.json({ ...mockPolicyResponse("plain bagel"), mock: true });
    });
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => {
    delete window.turnstile;
    vi.unstubAllEnvs();
    history.replaceState(null, "", "/");
  });

  async function showCheck() {
    render(<App />);
    const input = screen.getByLabelText("What are you bringing?");
    await userEvent.type(input, "plain bagel{Enter}");
    await waitFor(() => expect(options).toBeDefined());
    act(() => options?.["before-interactive-callback"]());
    expect(document.activeElement).toHaveAccessibleName("One quick check");
    return input;
  }

  it("says it is waiting for the check instead of deliberating", async () => {
    await showCheck();
    expect(screen.getByText(WAITING_FOR_CHECK)).toBeInTheDocument();
    expect(screen.queryByText(/deliberating/)).toBeNull();
  });

  it("rules once the check passes, after one session and one retry", async () => {
    const input = await showCheck();
    act(() => options?.callback("XXXX.DUMMY.TOKEN.XXXX"));

    expect(await screen.findByRole("heading", { name: "Proper" })).toBeInTheDocument();
    expect(card()).toBeNull();
    expect(document.activeElement).toBe(input);
    expect(fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`)).toEqual([
      `GET ${ruleUrl("plain bagel")}`,
      `POST ${SESSION_PATH}`,
      `GET ${ruleUrl("plain bagel")}`,
    ]);
  });

  it("gives focus back and says the check was skipped after Not now", async () => {
    const input = await showCheck();
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(await screen.findByText(/^Skipped the quick check\./)).toBeVisible();
    expect(document.activeElement).toBe(input);
    expect(screen.queryByText(/Couldn't confirm you're human/)).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("gives focus back to Submit when the check started from it", async () => {
    render(<App />);
    await userEvent.type(screen.getByLabelText("What are you bringing?"), "plain bagel");
    const submit = screen.getByRole("button", { name: "Submit for review" });
    submit.focus();
    await userEvent.keyboard("{Enter}");
    await waitFor(() => expect(options).toBeDefined());
    act(() => options?.["before-interactive-callback"]());
    await userEvent.click(screen.getByRole("button", { name: "Not now" }));

    expect(document.activeElement).toBe(submit);
  });

  it("shows a failed check as an error and asks Jev nothing", async () => {
    await showCheck();
    act(() => {
      options?.["error-callback"]("600010");
    });

    expect(await screen.findByText(/^Couldn't confirm you're human/)).toBeVisible();
    expect(card()).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("drops the check when the visitor goes back home", async () => {
    await showCheck();
    act(() => {
      history.back();
    });

    await waitFor(() => expect(card()).toBeNull());
    expect(location.search).toBe("");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByText(WAITING_FOR_CHECK)).toBeNull();
  });
});
