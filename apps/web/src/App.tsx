import { hasUsableText, MAX_ORDER_LENGTH, normalizeOrder } from "@bagel/core";
import {
  type FormEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { AnotherButton } from "./components/AnotherButton";
import { BagelOutlines } from "./components/BagelOutlines";
import { Footer } from "./components/Footer";
import { PendingCard } from "./components/PendingCard";
import { RulingCard } from "./components/RulingCard";
import { ShareBar } from "./components/ShareBar";
import { fetchRuling, isChecking, type RuleOutcome, subscribeChecking } from "./lib/api";
import { WAITING_FOR_CHECK } from "./lib/errors";
import { EXAMPLES } from "./lib/examples";
import { POLICY_URL } from "./lib/links";
import { orderFromSearch, orderHref } from "./lib/url";

type State =
  | { status: "idle" }
  | { status: "loading"; order: string }
  | { status: "done"; order: string; outcome: RuleOutcome };

function matches(query: string): boolean {
  return typeof window.matchMedia === "function" && window.matchMedia(query).matches;
}

function scrollBehavior(): ScrollBehavior {
  return matches("(prefers-reduced-motion: reduce)") ? "auto" : "smooth";
}

// iOS drops a scroll that starts while the on-screen keyboard is still animating closed.
const KEYBOARD_CLOSE_MS = 350;

export function App() {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const inflight = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const revealPending = useRef(false);
  const keyboardClosedAt = useRef(0);
  const checking = useSyncExternalStore(subscribeChecking, isChecking, () => false);

  const loadFromUrl = useEffectEvent(() => {
    const order = orderFromSearch(window.location.search);
    if (order === null) {
      inflight.current?.abort();
      setText("");
      setState({ status: "idle" });
      return;
    }
    setText(order);
    void submit(order, { push: false });
  });

  useEffect(() => {
    loadFromUrl();
    const onPopState = () => loadFromUrl();
    window.addEventListener("popstate", onPopState);
    return () => {
      window.removeEventListener("popstate", onPopState);
      inflight.current?.abort();
    };
  }, []);

  async function submit(raw: string, { push = true } = {}) {
    const order = normalizeOrder(raw);
    if (!hasUsableText(order)) return;
    const href = orderHref(order);
    if (push && `${window.location.pathname}${window.location.search}` !== href) {
      window.history.pushState(null, "", href);
    }
    inflight.current?.abort();
    const controller = new AbortController();
    inflight.current = controller;
    setState({ status: "loading", order });
    showResult();
    try {
      const outcome = await fetchRuling(order, controller.signal);
      // Keep a declined order out of the address bar and history.
      if (outcome.ok && outcome.result.kind === "declined")
        window.history.replaceState(null, "", "/");
      setState({ status: "done", order, outcome });
    } catch {
      // Superseded by a newer submission.
    }
  }

  // On a phone the hero and form fill the screen, so a ruling would land below the fold unseen.
  function showResult() {
    if (document.activeElement instanceof HTMLInputElement && matches("(pointer: coarse)")) {
      document.activeElement.blur();
    }
    revealPending.current = true;
  }

  // Scrolls once for the pending card and again when the ruling replaces it, in case it grew.
  useEffect(() => {
    if (state.status === "idle" || !revealPending.current) return;
    if (state.status === "done") revealPending.current = false;
    const wait = Math.max(0, keyboardClosedAt.current + KEYBOARD_CLOSE_MS - performance.now());
    const timer = setTimeout(
      () => resultRef.current?.scrollIntoView({ behavior: scrollBehavior(), block: "start" }),
      wait,
    );
    return () => clearTimeout(timer);
  }, [state]);

  function reviewAnother() {
    const input = inputRef.current;
    if (!input) return;
    // On a phone the keyboard opens with focus, and iOS only reveals the field itself when the
    // focus call is allowed to scroll. A smooth scroll racing the keyboard would be dropped.
    if (matches("(pointer: coarse)")) {
      input.focus();
    } else {
      input.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
      input.focus({ preventScroll: true });
    }
    input.setSelectionRange(0, input.value.length);
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    if (state.status === "loading") return;
    void submit(text);
  }

  return (
    <>
      <header className="site-nav">
        <a className="wordmark" href="/">
          Bagel Review Board
        </a>
        <a className="button button-small" href={POLICY_URL}>
          Read the policy
        </a>
      </header>

      <section className="hero">
        <BagelOutlines />
        <div className="hero-content">
          <h1>Bagel Review Board</h1>
          <p className="hero-lede">
            Describe a bagel. Jev checks it against the Uptech Studio Bagel Policy so you know
            before the company event.
          </p>
        </div>
      </section>

      <main className="main">
        <form className="order-form" onSubmit={onSubmit}>
          <label htmlFor="order">What are you bringing?</label>
          <div className="order-row">
            <input
              ref={inputRef}
              id="order"
              // A tap on Submit or an example blurs the field before the click, so time it here.
              onBlur={() => {
                if (matches("(pointer: coarse)")) keyboardClosedAt.current = performance.now();
              }}
              value={text}
              maxLength={MAX_ORDER_LENGTH}
              onChange={(e) => setText(e.target.value)}
              placeholder="everything bagel, plain schmear, lox, capers"
              autoComplete="off"
            />
            {/* aria-disabled keeps the button focusable, so focus can return to it after the check. */}
            <button className="button" type="submit" aria-disabled={state.status === "loading"}>
              {state.status === "loading" ? (
                <>
                  <span className="spinner" aria-hidden="true" />
                  Reviewing…
                </>
              ) : (
                "Submit for review"
              )}
            </button>
          </div>
          <ul className="examples" aria-label="Examples">
            {EXAMPLES.map(({ order, note }) => (
              <li key={order}>
                <button
                  type="button"
                  className={note ? "chip chip-featured" : "chip"}
                  onClick={() => {
                    setText(order);
                    void submit(order);
                  }}
                >
                  {note && <span className="chip-note">{note}</span>}
                  {order}
                </button>
              </li>
            ))}
          </ul>
        </form>

        <section
          ref={resultRef}
          aria-live="polite"
          className="result-slot"
          data-active={state.status === "idle" ? undefined : ""}
        >
          {state.status === "loading" && (
            <PendingCard order={state.order} message={checking ? WAITING_FOR_CHECK : undefined} />
          )}
          {state.status === "done" &&
            (state.outcome.ok ? (
              <>
                <RulingCard result={state.outcome.result} mock={state.outcome.mock} />
                <ShareBar
                  order={state.order}
                  result={state.outcome.result}
                  onAnother={reviewAnother}
                />
              </>
            ) : (
              <div className="error-panel">
                <p className="error">{state.outcome.message}</p>
                <div className="share-buttons">
                  {state.outcome.code === "stale_client" && (
                    <button
                      type="button"
                      className="button button-secondary"
                      onClick={() => window.location.reload()}
                    >
                      Reload the page
                    </button>
                  )}
                  {state.outcome.code !== "stale_client" && (
                    <AnotherButton onClick={reviewAnother} />
                  )}
                </div>
              </div>
            ))}
        </section>
      </main>

      <Footer />
    </>
  );
}
