import { CLIENT_TIMEOUT_MS, mockPolicyResponse, ruleUrl, SESSION_PATH } from "@bagel/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { fetchRuling, isChecking, parseRetryAfter, type RuleOutcome, RulingError } from "./api";
import { solveChallenge } from "./challenge";

vi.mock("./challenge", () => ({ solveChallenge: vi.fn() }));

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...init.headers },
  });

const ruling = (order: string) =>
  json({ ...mockPolicyResponse(order), mock: true }, { headers: { "x-bagel-cache": "MISS" } });

type Failed = Extract<RuleOutcome, { ok: false }>;

async function failure(order: string, signal?: AbortSignal): Promise<Failed> {
  const outcome = await fetchRuling(order, signal);
  if (outcome.ok) throw new Error("expected a failed outcome");
  return outcome;
}

describe("fetchRuling", () => {
  afterEach(() => vi.useRealTimers());

  it("calls only the canonical same-origin URL and returns the ruling", async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => ruling("plain bagel"));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await fetchRuling("plain bagel");
    expect(outcome).toMatchObject({ ok: true, mock: true, result: { kind: "ruling" } });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(ruleUrl("plain bagel"));
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("accept")).toBe(
      "application/json",
    );
  });

  it.each([
    [400, "bad_request"],
    [404, "not_found"],
    [405, "method_not_allowed"],
    [409, "stale_client"],
    [429, "rate_limited"],
    [429, "client_limit"],
    [503, "daily_limit"],
    [502, "upstream_error"],
    [503, "upstream_busy"],
    [504, "timeout"],
    [500, "internal"],
  ] as const)("maps a %s error body to %s", async (status, code) => {
    vi.stubGlobal("fetch", async () =>
      json({ error: { code, message: "nope" } }, { status, headers: { "retry-after": "12" } }),
    );
    const outcome = await failure("plain bagel");
    expect(outcome.code).toBe(code);
    expect(outcome.message).not.toBe("nope");
  });

  it("falls back to the status when the body is not ours", async () => {
    vi.stubGlobal("fetch", async () => new Response("<html>bad gateway</html>", { status: 503 }));
    expect((await failure("plain bagel")).code).toBe("upstream_busy");
  });

  it("says how long to wait out a rate limit", async () => {
    vi.stubGlobal("fetch", async () =>
      json(
        { error: { code: "rate_limited", message: "slow" } },
        { status: 429, headers: { "retry-after": "12" } },
      ),
    );
    expect((await failure("plain bagel")).message).toContain("Try again in 12 seconds.");
  });

  it.each([
    ["daily_limit", 503, "The board has used up"],
    ["client_limit", 429, "Your network has used up"],
  ] as const)("says when new rulings open again after %s", async (code, status, opening) => {
    vi.stubGlobal("fetch", async () =>
      json({ error: { code, message: "resting" } }, { status, headers: { "retry-after": "5400" } }),
    );
    const { message } = await failure("plain bagel");
    expect(message).toContain(opening);
    expect(message).toMatch(/New rulings open again (tomorrow )?at .+ your time\./);
    expect(solveChallenge).not.toHaveBeenCalled();
  });

  it("offers a reload to a tab from another deploy", async () => {
    vi.stubGlobal("fetch", async () =>
      json({ error: { code: "stale_client", message: "old" } }, { status: 409 }),
    );
    const outcome = await failure("plain bagel");
    expect(outcome.code).toBe("stale_client");
    expect(outcome.message).toContain("Reload the page");
  });

  it.each([
    ["the SPA shell", "<!doctype html><html><body>Bagel Review Board</body></html>", "text/html"],
    ["an HTML page with a JSON-looking body", "{}", "text/html; charset=utf-8"],
    ["a body that is not JSON", "Service temporarily unavailable", "text/plain"],
  ])("reads %s on a 200 as over capacity, never a ruling", async (_label, body, type) => {
    const fetchMock = vi.fn(async () => new Response(body, { headers: { "content-type": type } }));
    vi.stubGlobal("fetch", fetchMock);
    const outcome = await failure("plain bagel");
    expect(outcome.code).toBe("over_capacity");
    expect(outcome.message).toMatch(/^The board is swamped\./);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it.each([
    [true, "network"],
    [false, "offline"],
  ] as const)(
    "reads a 200 whose body drops mid-download (online: %s) as %s",
    async (online, code) => {
      const half = JSON.stringify(mockPolicyResponse("plain bagel")).slice(0, 40);
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(half));
          controller.error(new TypeError("terminated"));
        },
      });
      vi.stubGlobal(
        "fetch",
        async () => new Response(body, { headers: { "content-type": "application/json" } }),
      );
      vi.spyOn(navigator, "onLine", "get").mockReturnValue(online);
      expect((await failure("plain bagel")).code).toBe(code);
    },
  );

  it("keeps a JSON ruling sent without a JSON content type", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response(JSON.stringify(mockPolicyResponse("plain bagel"))),
    );
    await expect(fetchRuling("plain bagel")).resolves.toMatchObject({ ok: true, mock: false });
  });

  it("rejects a success body that is not a ruling", async () => {
    vi.stubGlobal("fetch", async () => json({ hello: "world" }));
    expect((await failure("plain bagel")).code).toBe("internal");
  });

  it("rejects a ruling with a tier the SPA does not know", async () => {
    const response = mockPolicyResponse("plain bagel");
    const answers = {
      ...response.answers,
      bagel: { ...response.answers.bagel, choice: "sourdough" },
    };
    vi.stubGlobal("fetch", async () => json({ ...response, answers }));
    expect((await failure("plain bagel")).code).toBe("internal");
  });

  it("reports offline when the browser says so", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect((await failure("plain bagel")).code).toBe("offline");
  });

  it("aborts after the client timeout", async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      "fetch",
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () => reject(new DOMException("", "AbortError")));
        }),
    );
    const pending = failure("plain bagel", new AbortController().signal);
    await vi.advanceTimersByTimeAsync(CLIENT_TIMEOUT_MS);
    expect((await pending).code).toBe("timeout");
  });

  it("times out a body that stalls after the headers", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", async (_url: string, init: RequestInit) => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          init.signal?.addEventListener("abort", () =>
            controller.error(new DOMException("", "AbortError")),
          );
        },
      });
      return new Response(body, { headers: { "content-type": "application/json" } });
    });
    const pending = failure("plain bagel");
    await vi.advanceTimersByTimeAsync(CLIENT_TIMEOUT_MS);
    expect((await pending).code).toBe("timeout");
  });

  it("lets a superseded ruling finish on the server but still rejects for the caller", async () => {
    let init: RequestInit | undefined;
    let answer: (response: Response) => void = () => {};
    vi.stubGlobal(
      "fetch",
      (_url: string, sent: RequestInit) =>
        new Promise<Response>((resolve) => {
          init = sent;
          answer = resolve;
        }),
    );
    const wanted = new AbortController();
    const pending = fetchRuling("plain bagel", wanted.signal);
    wanted.abort();
    expect(init?.signal?.aborted).toBe(false);
    answer(json({ ...mockPolicyResponse("plain bagel"), mock: true }));
    await expect(pending).rejects.toThrow();
  });
});

describe("fetchRuling behind the human check", () => {
  const SITE_KEY = "1x00000000000000000000AA";
  const solve = solveChallenge as Mock<typeof solveChallenge>;
  const challenge = () =>
    json({ error: { code: "challenge_required", message: "check first" } }, { status: 401 });
  const sessionOk = () => new Response(null, { status: 204 });

  type Call = [url: string, init?: RequestInit];
  let fetchMock: Mock<(...args: Call) => Promise<Response>>;
  const urls = () => fetchMock.mock.calls.map(([url, init]) => `${init?.method ?? "GET"} ${url}`);

  // Challenged until a session is posted, then every order gets its ruling.
  const afterSession = async (url: string) => {
    if (url === SESSION_PATH) return sessionOk();
    const sessions = fetchMock.mock.calls.filter(([u]) => u === SESSION_PATH).length;
    if (sessions === 0) return challenge();
    return ruling(new URL(url, "http://x").searchParams.get("order") ?? "");
  };

  beforeEach(() => {
    solve.mockReset();
    solve.mockResolvedValue("XXXX.DUMMY.TOKEN.XXXX");
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", SITE_KEY);
    fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
  });

  afterEach(() => vi.unstubAllEnvs());

  it("runs one challenge, starts a session, then retries once", async () => {
    fetchMock
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(sessionOk())
      .mockResolvedValueOnce(ruling("plain bagel"));

    const outcome = await fetchRuling("plain bagel");
    expect(outcome).toMatchObject({ ok: true, result: { kind: "ruling" } });
    expect(solve).toHaveBeenCalledExactlyOnceWith(
      SITE_KEY,
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(urls()).toEqual([
      `GET ${ruleUrl("plain bagel")}`,
      `POST ${SESSION_PATH}`,
      `GET ${ruleUrl("plain bagel")}`,
    ]);
    const init = fetchMock.mock.calls[1]?.[1];
    expect(JSON.parse(String(init?.body))).toEqual({ token: "XXXX.DUMMY.TOKEN.XXXX" });
    expect(new Headers(init?.headers).get("content-type")).toBe("application/json");
  });

  it.each([
    ["an unreachable or refused siteverify", 502, "upstream_error"],
    ["a malformed session request", 400, "bad_request"],
  ])("blames our side, not Jev, for %s", async (_label, status, code) => {
    fetchMock
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(json({ error: { code, message: "nope" } }, { status }));
    const outcome = await failure("plain bagel");
    expect(outcome.code).toBe("internal");
    expect(outcome.message).not.toMatch(/jev/i);
  });

  it("does not loop when the retry is challenged again", async () => {
    fetchMock
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(sessionOk())
      .mockResolvedValueOnce(challenge());
    const outcome = await failure("plain bagel");
    expect(outcome.code).toBe("challenge_required");
    expect(outcome.message).toContain("Couldn't confirm you're human");
    expect(solve).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("treats a bare 401 as a challenge too", async () => {
    fetchMock
      .mockResolvedValueOnce(new Response("", { status: 401 }))
      .mockResolvedValueOnce(sessionOk())
      .mockResolvedValueOnce(ruling("plain bagel"));
    await expect(fetchRuling("plain bagel")).resolves.toMatchObject({ ok: true });
    expect(solve).toHaveBeenCalledTimes(1);
  });

  it("reports a failed widget as challenge_required without posting a session", async () => {
    fetchMock.mockResolvedValueOnce(challenge());
    solve.mockRejectedValueOnce(new Error("error 600010"));
    expect((await failure("plain bagel")).code).toBe("challenge_required");
    expect(urls()).toEqual([`GET ${ruleUrl("plain bagel")}`]);
  });

  it("reports a failed widget as offline when the browser is offline", async () => {
    fetchMock.mockResolvedValueOnce(challenge());
    solve.mockRejectedValueOnce(new Error("Turnstile failed to load"));
    vi.spyOn(navigator, "onLine", "get").mockReturnValue(false);
    expect((await failure("plain bagel")).code).toBe("offline");
  });

  it("surfaces a rejected session without retrying the ruling", async () => {
    fetchMock
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(
        json(
          { error: { code: "rate_limited", message: "slow" } },
          { status: 429, headers: { "retry-after": "30" } },
        ),
      );
    const outcome = await failure("plain bagel");
    expect(outcome.code).toBe("rate_limited");
    expect(outcome.message).toContain("Try again in 30 seconds.");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("cannot solve a challenge without a sitekey in the build", async () => {
    vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "");
    fetchMock.mockResolvedValueOnce(challenge());
    expect((await failure("plain bagel")).code).toBe("challenge_required");
    expect(solve).not.toHaveBeenCalled();
  });

  it("shares one challenge between rulings that miss together", async () => {
    let release = () => {};
    solve.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve("XXXX.DUMMY.TOKEN.XXXX");
        }),
    );
    fetchMock.mockImplementation(afterSession);

    const both = Promise.all([fetchRuling("plain bagel"), fetchRuling("sesame bagel")]);
    await vi.waitFor(() => expect(solve).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    release();
    expect(await both).toMatchObject([{ ok: true }, { ok: true }]);
    expect(solve).toHaveBeenCalledTimes(1);
    expect(urls().filter((u) => u.startsWith("POST"))).toHaveLength(1);
  });

  const skipped = () => Object.assign(new Error("cancelled"), { skipped: true });
  const solveUntilAborted = (release: { current: () => void }) =>
    solve.mockImplementationOnce(
      (_key, options) =>
        new Promise((resolve, reject) => {
          release.current = () => resolve("XXXX.DUMMY.TOKEN.XXXX");
          options?.signal?.addEventListener("abort", () => reject(skipped()));
        }),
    );

  it("reports a dismissed check as skipped, not failed", async () => {
    fetchMock.mockResolvedValueOnce(challenge());
    solve.mockRejectedValueOnce(skipped());
    const outcome = await failure("plain bagel");
    expect(outcome.code).toBe("challenge_skipped");
    expect(outcome.message).toContain("nothing was spent");
    expect(urls()).toEqual([`GET ${ruleUrl("plain bagel")}`]);
  });

  it("drops the check once the only ruling waiting on it is gone", async () => {
    solveUntilAborted({ current: () => {} });
    fetchMock.mockResolvedValueOnce(challenge());
    const wanted = new AbortController();
    const pending = fetchRuling("plain bagel", wanted.signal).catch((e: unknown) => e);
    await vi.waitFor(() => expect(solve).toHaveBeenCalled());
    wanted.abort();
    const error = await pending;
    expect(error).toBeInstanceOf(RulingError);
    expect(error).toMatchObject({ code: "challenge_skipped" });
    expect(solve.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
    expect(urls()).toEqual([`GET ${ruleUrl("plain bagel")}`]);
  });

  it("starts a fresh check after an abandoned one", async () => {
    solveUntilAborted({ current: () => {} });
    fetchMock.mockImplementation(afterSession);
    const first = new AbortController();
    const abandoned = fetchRuling("plain bagel", first.signal).catch((e: unknown) => e);
    await vi.waitFor(() => expect(solve).toHaveBeenCalledTimes(1));
    first.abort();
    await abandoned;

    await expect(fetchRuling("sesame bagel")).resolves.toMatchObject({ ok: true });
    expect(solve).toHaveBeenCalledTimes(2);
  });

  it("keeps the check for a ruling that still needs it, and pays only for that one", async () => {
    const release = { current: () => {} };
    solveUntilAborted(release);
    fetchMock.mockImplementation(afterSession);

    const first = new AbortController();
    const plain = fetchRuling("plain bagel", first.signal).catch((e: unknown) => e);
    await vi.waitFor(() => expect(solve).toHaveBeenCalledTimes(1));
    const sesame = fetchRuling("sesame bagel", new AbortController().signal);
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    await new Promise((resolve) => setTimeout(resolve, 0));
    first.abort();
    release.current();

    expect(await sesame).toMatchObject({ ok: true });
    expect(await plain).toMatchObject({ code: "challenge_skipped" });
    expect(urls()).toEqual([
      `GET ${ruleUrl("plain bagel")}`,
      `GET ${ruleUrl("sesame bagel")}`,
      `POST ${SESSION_PATH}`,
      `GET ${ruleUrl("sesame bagel")}`,
    ]);
  });

  it("says when the check card is on screen", async () => {
    const release = { current: () => {} };
    solve.mockImplementationOnce(
      (_key, options) =>
        new Promise((resolve) => {
          options?.onInteractive?.();
          release.current = () => resolve("XXXX.DUMMY.TOKEN.XXXX");
        }),
    );
    fetchMock
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(sessionOk())
      .mockResolvedValueOnce(ruling("plain bagel"));
    const pending = fetchRuling("plain bagel");
    await vi.waitFor(() => expect(isChecking()).toBe(true));
    release.current();
    await pending;
    expect(isChecking()).toBe(false);
  });

  it("refuses before the check when the day is already spent", async () => {
    fetchMock.mockResolvedValueOnce(
      json(
        { error: { code: "daily_limit", message: "resting" } },
        { status: 503, headers: { "retry-after": "5400" } },
      ),
    );
    expect((await failure("plain bagel")).code).toBe("daily_limit");
    expect(solve).not.toHaveBeenCalled();
  });

  it("reports a client limit that lands on the retry", async () => {
    fetchMock
      .mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(sessionOk())
      .mockResolvedValueOnce(
        json(
          { error: { code: "client_limit", message: "enough" } },
          { status: 429, headers: { "retry-after": "3600" } },
        ),
      );
    const outcome = await failure("plain bagel");
    expect(outcome.code).toBe("client_limit");
    expect(outcome.message).toMatch(/open again (tomorrow )?at .+ your time/);
    expect(solve).toHaveBeenCalledTimes(1);
  });
});

describe("parseRetryAfter", () => {
  it("reads seconds and HTTP dates", () => {
    expect(parseRetryAfter("7")).toBe(7);
    expect(parseRetryAfter("7.2")).toBe(8);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("soon")).toBeNull();
    const now = Date.parse("2026-09-22T12:00:00Z");
    expect(parseRetryAfter("Tue, 22 Sep 2026 12:00:30 GMT", now)).toBe(30);
    expect(parseRetryAfter("Tue, 22 Sep 2026 11:00:00 GMT", now)).toBe(0);
  });
});
