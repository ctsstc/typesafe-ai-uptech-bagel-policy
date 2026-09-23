import { TURNSTILE_ACTION } from "@bagel/core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ChallengeError, solveChallenge, TURNSTILE_SCRIPT, type TurnstileApi } from "./challenge";

type Options = Parameters<TurnstileApi["render"]>[1];

const SITE_KEY = "1x00000000000000000000AA";

function fakeTurnstile() {
  const rendered: { container: HTMLElement; options: Options }[] = [];
  const api = {
    render: vi.fn((container: HTMLElement, options: Options) => {
      rendered.push({ container, options });
      return `widget-${rendered.length}`;
    }),
    remove: vi.fn(),
  };
  return { api, rendered, last: () => rendered.at(-1) as (typeof rendered)[number] };
}

const host = () => document.querySelector<HTMLElement>(".challenge");

describe("solveChallenge", () => {
  let turnstile: ReturnType<typeof fakeTurnstile>;

  beforeEach(() => {
    turnstile = fakeTurnstile();
    window.turnstile = turnstile.api;
  });

  afterEach(() => {
    delete window.turnstile;
    for (const script of document.querySelectorAll("script")) script.remove();
    vi.useRealTimers();
  });

  it("renders an interaction-only widget for the session action and resolves its token", async () => {
    const pending = solveChallenge(SITE_KEY);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(1));
    const { container, options } = turnstile.last();
    expect(options).toMatchObject({
      sitekey: SITE_KEY,
      action: TURNSTILE_ACTION,
      appearance: "interaction-only",
      execution: "render",
      retry: "never",
      "response-field": false,
      theme: "auto",
    });
    expect(host()?.contains(container)).toBe(true);
    expect(host()?.getAttribute("aria-hidden")).toBe("true");

    options.callback("XXXX.DUMMY.TOKEN.XXXX");
    await expect(pending).resolves.toBe("XXXX.DUMMY.TOKEN.XXXX");
    expect(turnstile.api.remove).toHaveBeenCalledWith("widget-1");
    expect(host()).toBeNull();
  });

  it("shows its copy and takes focus only when Cloudflare asks for a click", async () => {
    document.documentElement.dataset.theme = "dark";
    const pending = solveChallenge(SITE_KEY);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    expect(turnstile.last().options.theme).toBe("dark");
    expect(host()?.dataset.state).toBe("checking");

    turnstile.last().options["before-interactive-callback"]();
    const shown = host();
    expect(shown?.dataset.state).toBe("interactive");
    expect(shown?.hasAttribute("aria-hidden")).toBe(false);
    expect(document.activeElement).toBe(shown);
    expect(shown).toHaveAccessibleName("One quick check");
    expect(shown?.textContent).toContain("Cloudflare Turnstile");
    expect(shown?.textContent).not.toMatch(/[\u2013\u2014]/);

    turnstile.last().options.callback("token");
    await pending;
  });

  it("uses the compact widget on a narrow phone", async () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) => ({ matches: query === "(max-width: 379px)" }) as MediaQueryList,
    );
    const pending = solveChallenge(SITE_KEY);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    expect(turnstile.last().options.size).toBe("compact");
    turnstile.last().options.callback("token");
    await pending;
  });

  it("rejects on a widget error, reports it as a real failure and cleans up", async () => {
    const pending = solveChallenge(SITE_KEY);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    expect(turnstile.last().options["error-callback"]("600010")).toBe(true);
    const error = await pending.catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ChallengeError);
    expect(error).toMatchObject({ message: "error 600010", skipped: false });
    expect(host()).toBeNull();
  });

  it("rejects when the browser is unsupported", async () => {
    const pending = solveChallenge(SITE_KEY);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    turnstile.last().options["unsupported-callback"]();
    await expect(pending).rejects.toMatchObject({ message: "unsupported browser", skipped: false });
  });

  it("rejects when the widget cannot render", async () => {
    turnstile.api.render.mockImplementationOnce(() => {
      throw new Error("bad sitekey");
    });
    await expect(solveChallenge(SITE_KEY)).rejects.toThrow("bad sitekey");
    expect(host()).toBeNull();
  });

  it("lets the visitor back out, and says the check was skipped rather than failed", async () => {
    const pending = solveChallenge(SITE_KEY);
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    turnstile.last().options["before-interactive-callback"]();
    host()?.querySelector("button")?.click();
    await expect(pending).rejects.toMatchObject({ message: "cancelled", skipped: true });
    expect(turnstile.api.remove).toHaveBeenCalled();
  });

  it("removes the card when the ruling it was for goes away", async () => {
    const wanted = new AbortController();
    const pending = solveChallenge(SITE_KEY, { signal: wanted.signal });
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    turnstile.last().options["before-interactive-callback"]();
    expect(host()).not.toBeNull();
    wanted.abort();
    await expect(pending).rejects.toMatchObject({ skipped: true });
    expect(host()).toBeNull();
  });

  it("never mounts the card for a ruling that already went away", async () => {
    const wanted = new AbortController();
    wanted.abort();
    await expect(solveChallenge(SITE_KEY, { signal: wanted.signal })).rejects.toMatchObject({
      skipped: true,
    });
    expect(turnstile.api.render).not.toHaveBeenCalled();
    expect(host()).toBeNull();
  });

  it("tells its caller when the card shows, and gives focus back when it closes", async () => {
    const button = document.createElement("button");
    document.body.append(button);
    button.focus();
    const onInteractive = vi.fn();
    const pending = solveChallenge(SITE_KEY, { onInteractive });
    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    turnstile.last().options["before-interactive-callback"]();
    expect(onInteractive).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(host());

    host()?.querySelector("button")?.click();
    await expect(pending).rejects.toThrow("cancelled");
    expect(document.activeElement).toBe(button);
    button.remove();
  });

  it("gives up after two minutes", async () => {
    vi.useFakeTimers();
    const pending = solveChallenge(SITE_KEY);
    const settled = expect(pending).rejects.toMatchObject({ message: "timed out", skipped: true });
    await vi.advanceTimersByTimeAsync(120_000);
    await settled;
    expect(host()).toBeNull();
  });

  it("loads the explicit-render script only when asked, from Cloudflare's exact URL", async () => {
    delete window.turnstile;
    expect(document.querySelector("script")).toBeNull();

    const pending = solveChallenge(SITE_KEY);
    const script = document.querySelector<HTMLScriptElement>("script");
    expect(script?.src).toBe(TURNSTILE_SCRIPT);
    expect(new URL(TURNSTILE_SCRIPT).origin).toBe("https://challenges.cloudflare.com");
    window.turnstile = turnstile.api;
    script?.dispatchEvent(new Event("load"));

    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalled());
    turnstile.last().options.callback("token");
    await expect(pending).resolves.toBe("token");
  });

  it("loads the script once for checks that start together", async () => {
    delete window.turnstile;
    const first = solveChallenge(SITE_KEY);
    const second = solveChallenge(SITE_KEY);
    expect(document.querySelectorAll("script")).toHaveLength(1);
    window.turnstile = turnstile.api;
    document.querySelector("script")?.dispatchEvent(new Event("load"));

    await vi.waitFor(() => expect(turnstile.api.render).toHaveBeenCalledTimes(2));
    for (const { options } of turnstile.rendered) options.callback("token");
    await expect(Promise.all([first, second])).resolves.toEqual(["token", "token"]);
  });

  it("rejects when the script loads without its API", async () => {
    delete window.turnstile;
    const pending = solveChallenge(SITE_KEY);
    document.querySelector("script")?.dispatchEvent(new Event("load"));
    await expect(pending).rejects.toThrow("without its API");
  });

  it("rejects when the script is blocked, and tries again next time", async () => {
    delete window.turnstile;
    const first = solveChallenge(SITE_KEY);
    document.querySelector("script")?.dispatchEvent(new Event("error"));
    await expect(first).rejects.toThrow("failed to load");
    expect(document.querySelector("script")).toBeNull();

    const second = solveChallenge(SITE_KEY);
    expect(document.querySelectorAll("script")).toHaveLength(1);
    document.querySelector("script")?.dispatchEvent(new Event("error"));
    await expect(second).rejects.toThrow();
  });

  it("gives up on a script that stalls, and starts a fresh load next time", async () => {
    vi.useFakeTimers();
    delete window.turnstile;
    const first = solveChallenge(SITE_KEY).catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await first).toBeInstanceOf(ChallengeError);
    expect(document.querySelector("script")).toBeNull();

    void solveChallenge(SITE_KEY).catch(() => {});
    expect(document.querySelectorAll("script")).toHaveLength(1);
  });

  it("stops waiting on a stalled script when the ruling goes away", async () => {
    delete window.turnstile;
    const gone = new AbortController();
    const pending = solveChallenge(SITE_KEY, { signal: gone.signal });
    gone.abort();
    await expect(pending).rejects.toMatchObject({ skipped: true });
    expect(host()).toBeNull();
  });
});
