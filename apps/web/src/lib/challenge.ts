import { TURNSTILE_ACTION } from "@bagel/core";
import "../styles/challenge.css";

// Must be loaded from this exact URL. Cloudflare warns that proxied or cached copies break.
export const TURNSTILE_SCRIPT =
  "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
const SOLVE_TIMEOUT_MS = 120_000;
const SCRIPT_TIMEOUT_MS = 20_000;

interface RenderOptions {
  sitekey: string;
  action: string;
  appearance: "interaction-only";
  execution: "render";
  retry: "never";
  size: "flexible" | "compact";
  theme: "auto" | "light" | "dark";
  "response-field": false;
  callback: (token: string) => void;
  "error-callback": (code: string) => boolean;
  "unsupported-callback": () => void;
  "before-interactive-callback": () => void;
}

export interface TurnstileApi {
  render(container: HTMLElement, options: RenderOptions): string | null | undefined;
  remove(widgetId: string): void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

export class ChallengeError extends Error {
  override name = "ChallengeError";
  /** True when nobody failed the check: it was dismissed, ignored, or no longer needed. */
  constructor(
    message: string,
    readonly skipped = false,
  ) {
    super(message);
  }
}

export interface SolveOptions {
  /** Aborting removes the card and rejects as skipped. */
  readonly signal?: AbortSignal;
  /** Called when Cloudflare asks for a click and the card shows. */
  readonly onInteractive?: () => void;
}

let loading: Promise<TurnstileApi> | null = null;

function loadTurnstile(): Promise<TurnstileApi> {
  if (window.turnstile) return Promise.resolve(window.turnstile);
  loading ??= new Promise<TurnstileApi>((resolve, reject) => {
    const script = document.createElement("script");
    // A stalled request never fires onload or onerror, so give up and let the next try start fresh.
    const timer = setTimeout(() => {
      script.remove();
      reject(new ChallengeError("Turnstile took too long to load"));
    }, SCRIPT_TIMEOUT_MS);
    script.src = TURNSTILE_SCRIPT;
    script.async = true;
    script.onload = () => {
      clearTimeout(timer);
      if (window.turnstile) resolve(window.turnstile);
      else reject(new ChallengeError("Turnstile loaded without its API"));
    };
    script.onerror = () => {
      clearTimeout(timer);
      script.remove();
      reject(new ChallengeError("Turnstile failed to load"));
    };
    document.head.append(script);
  }).finally(() => {
    loading = null;
  });
  return loading;
}

// The flexible widget needs 300px, which a 320px phone cannot spare inside the card.
function sizeFor(): RenderOptions["size"] {
  return window.matchMedia("(max-width: 379px)").matches ? "compact" : "flexible";
}

function themeFor(root: HTMLElement): RenderOptions["theme"] {
  const theme = root.dataset.theme;
  return theme === "light" || theme === "dark" ? theme : "auto";
}

interface Host {
  readonly slot: HTMLElement;
  readonly cancel: HTMLButtonElement;
  interactive(): void;
  remove(): void;
}

// Turnstile needs its container mounted before it decides whether a click is needed, so the card
// stays invisible while Cloudflare checks in the background.
function mountHost(): Host {
  const root = document.createElement("section");
  let previous: Element | null = null;
  root.className = "challenge";
  root.dataset.state = "checking";
  root.setAttribute("aria-labelledby", "challenge-title");
  root.setAttribute("aria-hidden", "true");
  root.tabIndex = -1;

  const title = document.createElement("h2");
  title.id = "challenge-title";
  title.className = "challenge-title";
  title.textContent = "One quick check";

  const body = document.createElement("p");
  body.className = "challenge-body";
  body.textContent =
    "Each new order costs real money to ask Jev about, so Cloudflare Turnstile checks that a person is asking. Orders someone already asked about usually skip this.";

  const slot = document.createElement("div");
  slot.className = "challenge-widget";

  const cancel = document.createElement("button");
  cancel.type = "button";
  cancel.className = "button button-secondary challenge-cancel";
  cancel.textContent = "Not now";

  root.append(title, body, slot, cancel);
  document.body.append(root);

  return {
    slot,
    cancel,
    interactive() {
      previous = document.activeElement;
      root.dataset.state = "interactive";
      root.removeAttribute("aria-hidden");
      root.focus({ preventScroll: true });
    },
    remove() {
      const hadFocus = root.contains(document.activeElement);
      root.remove();
      if (hadFocus && previous instanceof HTMLElement && previous !== document.body) {
        if (previous.isConnected) previous.focus({ preventScroll: true });
      }
    },
  };
}

function rejectOnAbort(signal?: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    if (!signal) return;
    const abandon = () => reject(new ChallengeError("cancelled", true));
    if (signal.aborted) abandon();
    else signal.addEventListener("abort", abandon, { once: true });
  });
}

/** Runs one interaction-only Turnstile widget and resolves with its single-use token. */
export async function solveChallenge(
  sitekey: string,
  { signal, onInteractive }: SolveOptions = {},
): Promise<string> {
  const turnstile = await Promise.race([loadTurnstile(), rejectOnAbort(signal)]);
  if (signal?.aborted) throw new ChallengeError("cancelled", true);
  const host = mountHost();
  let widgetId: string | null | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;

  return new Promise<string>((resolve, reject) => {
    let settled = false;
    const finish = (outcome: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", abandon);
      if (widgetId) turnstile.remove(widgetId);
      host.remove();
      outcome();
    };
    const fail = (reason: string, skipped = false) =>
      finish(() => reject(new ChallengeError(reason, skipped)));
    const abandon = () => fail("cancelled", true);

    timer = setTimeout(() => fail("timed out", true), SOLVE_TIMEOUT_MS);
    host.cancel.addEventListener("click", abandon);
    signal?.addEventListener("abort", abandon, { once: true });
    try {
      widgetId = turnstile.render(host.slot, {
        sitekey,
        action: TURNSTILE_ACTION,
        appearance: "interaction-only",
        execution: "render",
        retry: "never",
        size: sizeFor(),
        theme: themeFor(document.documentElement),
        "response-field": false,
        callback: (token) => finish(() => resolve(token)),
        "error-callback": (code) => {
          fail(`error ${code}`);
          return true;
        },
        "unsupported-callback": () => fail("unsupported browser"),
        "before-interactive-callback": () => {
          host.interactive();
          onInteractive?.();
        },
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : "render failed");
    }
  });
}
