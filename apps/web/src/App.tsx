import { hasUsableText, MAX_ORDER_LENGTH, normalizeOrder } from "@bagel/core";
import {
  type FormEvent,
  useEffect,
  useEffectEvent,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { BagelOutlines } from "./components/BagelOutlines";
import { Footer } from "./components/Footer";
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

function scrollIntoViewTop(target: HTMLElement | null) {
  target?.scrollIntoView({
    behavior: matches("(prefers-reduced-motion: reduce)") ? "auto" : "smooth",
    block: "start",
  });
}

export function App() {
  const [text, setText] = useState("");
  const [state, setState] = useState<State>({ status: "idle" });
  const inflight = useRef<AbortController | null>(null);
  const resultRef = useRef<HTMLElement>(null);
  const revealPending = useRef(false);
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

  // Scrolls once for the pending state and again when the card is in: the first scroll stops short
  // while the page is still too short to bring the result to the top.
  useEffect(() => {
    if (state.status === "idle" || !revealPending.current) return;
    if (state.status === "done") revealPending.current = false;
    scrollIntoViewTop(resultRef.current);
  }, [state]);

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
              id="order"
              value={text}
              maxLength={MAX_ORDER_LENGTH}
              onChange={(e) => setText(e.target.value)}
              placeholder="everything bagel, plain schmear, lox, capers"
              autoComplete="off"
            />
            {/* aria-disabled keeps the button focusable, so focus can return to it after the check. */}
            <button className="button" type="submit" aria-disabled={state.status === "loading"}>
              Submit for review
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

        <section ref={resultRef} aria-live="polite" className="result-slot">
          {state.status === "loading" && (
            <p className="pending">{checking ? WAITING_FOR_CHECK : "The board is deliberating…"}</p>
          )}
          {state.status === "done" &&
            (state.outcome.ok ? (
              <>
                <RulingCard result={state.outcome.result} mock={state.outcome.mock} />
                <ShareBar order={state.order} result={state.outcome.result} />
              </>
            ) : (
              <div className="error-panel">
                <p className="error">{state.outcome.message}</p>
                {state.outcome.code === "stale_client" && (
                  <button
                    type="button"
                    className="button button-secondary"
                    onClick={() => window.location.reload()}
                  >
                    Reload the page
                  </button>
                )}
              </div>
            ))}
        </section>
      </main>

      <Footer />
    </>
  );
}
