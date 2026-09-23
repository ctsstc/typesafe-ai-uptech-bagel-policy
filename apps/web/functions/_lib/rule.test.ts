// @vitest-environment node
import {
  CLIENT_TIMEOUT_MS,
  isRuleErrorBody,
  mockPolicyResponse,
  QUESTION_SET_VERSION,
  type RuleErrorBody,
  type RuleResponse,
  ruleUrl,
} from "@bagel/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { onRequest as apiFallback } from "../api/[[path]]";
import { fakeD1 } from "./fake-d1";
import { createRateLimiter } from "./rate-limit";
import { createRuleHandler, type Env, JEV_DEADLINE_MS } from "./rule";
import { issueSession, SESSION_COOKIE } from "./session";
import { CLIENT_DAILY_CALL_LIMIT, SESSION_CALL_LIMIT } from "./usage";

const ORIGIN = "https://bagels.test";
const KEY = "ts-test-key-do-not-leak";
const IMMUTABLE = "public, max-age=31536000, immutable";

type FetchMock = Mock<(url: string, init?: RequestInit) => Promise<Response>>;

let fetchMock: FetchMock;
let pending: Promise<unknown>[];
let logs: unknown[][];

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
  pending = [];
  logs = [];
  for (const level of ["error", "warn", "log", "info", "debug"] as const) {
    vi.spyOn(console, level).mockImplementation((...args: unknown[]) => void logs.push(args));
  }
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const waitUntil = (promise: Promise<unknown>) => void pending.push(promise);

function call(
  path: string,
  env: Env = { TYPESAFE_API_KEY: KEY },
  { method = "GET", ip = "203.0.113.7", limit = 100 } = {},
) {
  const handler = createRuleHandler(createRateLimiter({ limit, windowMs: 60_000 }));
  const request = new Request(`${ORIGIN}${path}`, {
    method,
    headers: { "CF-Connecting-IP": ip },
  });
  return handler(request, env, waitUntil);
}

function upstream(status: number, body: unknown, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function jevOk(order: string) {
  const { answers } = mockPolicyResponse(order);
  return upstream(200, { model: "jev-1.13.0", answers, usage: { input_tokens: 12 } });
}

function fakeKv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key) ?? null),
    put: vi.fn(async (key: string, value: string) => void store.set(key, value)),
  };
}

function fakeCache() {
  const store = new Map<string, Response>();
  const cache = {
    store,
    match: vi.fn(async (key: Request) => store.get(key.url)?.clone()),
    put: vi.fn(async (key: Request, response: Response) => void store.set(key.url, response)),
  };
  vi.stubGlobal("caches", { default: cache });
  return cache;
}

async function errorBody(response: Response): Promise<RuleErrorBody> {
  const body: unknown = await response.json();
  if (!isRuleErrorBody(body)) throw new Error(`not an error body: ${JSON.stringify(body)}`);
  return body;
}

function expectNothingLeaked(...texts: string[]) {
  const logged = JSON.stringify(logs);
  for (const text of [...texts, logged]) {
    expect(text).not.toContain(KEY);
    expect(text).not.toContain("UPSTREAM-SECRET-DETAIL");
  }
}

it("gives up on Jev before the SPA gives up on us", () => {
  expect(JEV_DEADLINE_MS).toBeLessThan(CLIENT_TIMEOUT_MS);
});

describe("request validation", () => {
  it("rejects anything but GET with 405", async () => {
    for (const method of ["POST", "HEAD", "PUT", "OPTIONS"]) {
      const response = await call(ruleUrl("plain bagel"), undefined, { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET");
      expect(response.headers.get("Cache-Control")).toBe("no-store");
      expect((await errorBody(response)).error.code).toBe("method_not_allowed");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["no query", "/api/rule"],
    ["missing version", "/api/rule?order=plain"],
    ["params out of order", `/api/rule?v=${QUESTION_SET_VERSION}&order=plain`],
    ["extra param", `${ruleUrl("plain")}&x=1`],
    ["not normalized", `/api/rule?order=Plain+Bagel&v=${QUESTION_SET_VERSION}`],
    ["encoded differently", `/api/rule?order=plain%20bagel&v=${QUESTION_SET_VERSION}`],
    ["no usable text", `/api/rule?order=%21%21%21&v=${QUESTION_SET_VERSION}`],
  ])("returns 400 bad_request for %s", async (_label, path) => {
    const response = await call(path);
    expect(response.status).toBe(400);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(response)).error.code).toBe("bad_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("tells a tab from another deploy to reload, before looking at any cache", async () => {
    const kv = fakeKv();
    const response = await call(
      `/api/rule?order=plain+bagel&v=${Number(QUESTION_SET_VERSION) - 1}`,
      { TYPESAFE_API_KEY: KEY, RULINGS: kv as unknown as KVNamespace },
    );
    expect(response.status).toBe(409);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(response)).error.code).toBe("stale_client");
    expect(kv.get).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("accepts the canonical URL built by ruleUrl", async () => {
    fetchMock.mockResolvedValueOnce(jevOk("everything bagel with lox"));
    const response = await call(ruleUrl("everything bagel with lox"));
    expect(response.status).toBe(200);
  });

  it("answers unknown /api paths with a JSON 404 instead of the SPA", async () => {
    const response = await apiFallback({} as Parameters<typeof apiFallback>[0]);
    expect(response.status).toBe(404);
    expect(response.headers.get("Content-Type")).toContain("application/json");
    expect((await errorBody(response)).error.code).toBe("not_found");
  });
});

describe("mock mode", () => {
  it.each([
    ["no key", {}],
    ["blank key", { TYPESAFE_API_KEY: "  " }],
  ])("serves uncached mock rulings with %s", async (_label, env) => {
    const response = await call(ruleUrl("plain bagel"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const body = (await response.json()) as RuleResponse;
    expect(body).toEqual({ ...mockPolicyResponse("plain bagel"), mock: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("live rulings", () => {
  it("calls Jev once and returns only model and answers, cached immutably", async () => {
    const kv = fakeKv();
    const cache = fakeCache();
    fetchMock.mockResolvedValueOnce(jevOk("everything bagel with lox"));

    const response = await call(ruleUrl("everything bagel with lox"), {
      TYPESAFE_API_KEY: KEY,
      RULINGS: kv as unknown as KVNamespace,
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe(IMMUTABLE);
    expect(response.headers.get("X-Bagel-Cache")).toBe("MISS");
    expect(response.headers.get("Content-Type")).toBe("application/json; charset=utf-8");
    const text = await response.text();
    const body = JSON.parse(text) as RuleResponse;
    expect(body).toEqual({
      model: "jev-1.13.0",
      answers: mockPolicyResponse("everything bagel with lox").answers,
    });
    expect(body).not.toHaveProperty("usage");
    expect(body).not.toHaveProperty("mock");

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(url).toBe("https://api.typesafe.ai/v1/systemone");
    expect(new Headers(init?.headers).get("Authorization")).toBe(`Bearer ${KEY}`);
    const sent = JSON.parse(String(init?.body)) as { state: unknown; model: string };
    expect(sent.state).toEqual({ order: "everything bagel with lox" });

    await Promise.all(pending);
    expect(kv.put).toHaveBeenCalledWith(`v${QUESTION_SET_VERSION}:everything bagel with lox`, text);
    expect(cache.put).toHaveBeenCalledTimes(1);
    expect(cache.put.mock.calls[0]?.[0].url).toBe(
      `${ORIGIN}${ruleUrl("everything bagel with lox")}`,
    );
    expectNothingLeaked(text);
  });

  it("serves a Cache API hit without calling Jev or KV", async () => {
    const kv = fakeKv();
    const cache = fakeCache();
    fetchMock.mockResolvedValueOnce(jevOk("plain bagel"));
    const env = { TYPESAFE_API_KEY: KEY, RULINGS: kv as unknown as KVNamespace };
    const first = await (await call(ruleUrl("plain bagel"), env)).text();
    await Promise.all(pending);

    const response = await call(ruleUrl("plain bagel"), env);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Bagel-Cache")).toBe("HIT");
    expect(response.headers.get("Cache-Control")).toBe(IMMUTABLE);
    expect(await response.text()).toBe(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(kv.get).toHaveBeenCalledTimes(1);
    expect(cache.match).toHaveBeenCalledTimes(2);
  });

  it("serves a KV hit and refills the edge cache", async () => {
    const stored = JSON.stringify(mockPolicyResponse("sesame bagel"));
    const kv = fakeKv({ [`v${QUESTION_SET_VERSION}:sesame bagel`]: stored });
    const cache = fakeCache();

    const response = await call(ruleUrl("sesame bagel"), {
      TYPESAFE_API_KEY: KEY,
      RULINGS: kv as unknown as KVNamespace,
    });
    expect(response.headers.get("X-Bagel-Cache")).toBe("KV");
    expect(response.headers.get("Cache-Control")).toBe(IMMUTABLE);
    expect(await response.text()).toBe(stored);
    expect(fetchMock).not.toHaveBeenCalled();
    await Promise.all(pending);
    expect(cache.put).toHaveBeenCalledTimes(1);
  });

  it("still answers when the cache and KV throw", async () => {
    const broken = vi.fn(async () => {
      throw new Error("storage down");
    });
    vi.stubGlobal("caches", { default: { match: broken, put: broken } });
    const kv = { get: broken, put: broken } as unknown as KVNamespace;
    fetchMock.mockResolvedValueOnce(jevOk("plain bagel"));

    const response = await call(ruleUrl("plain bagel"), { TYPESAFE_API_KEY: KEY, RULINGS: kv });
    expect(response.status).toBe(200);
    await Promise.all(pending);
    expect(broken).toHaveBeenCalledTimes(4);
  });
});

describe("rate limiting", () => {
  it("limits live Jev calls per IP with Retry-After", async () => {
    const handler = createRuleHandler(createRateLimiter({ limit: 1, windowMs: 60_000 }));
    const request = (order: string, ip: string) =>
      new Request(`${ORIGIN}${ruleUrl(order)}`, { headers: { "CF-Connecting-IP": ip } });
    const env = { TYPESAFE_API_KEY: KEY };
    fetchMock.mockImplementation(async () => jevOk("plain bagel"));

    expect((await handler(request("plain bagel", "198.51.100.1"), env, waitUntil)).status).toBe(
      200,
    );
    const limited = await handler(request("egg bagel", "198.51.100.1"), env, waitUntil);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect((await errorBody(limited)).error.code).toBe("rate_limited");
    expect((await handler(request("egg bagel", "198.51.100.2"), env, waitUntil)).status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not count mock rulings", async () => {
    for (let i = 0; i < 3; i++) {
      expect((await call(ruleUrl("plain bagel"), {}, { limit: 1 })).status).toBe(200);
    }
  });
});

describe("upstream error mapping", () => {
  async function failWith(respond: () => Promise<Response>) {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    fetchMock.mockImplementation(respond);
    const result = call(ruleUrl("plain bagel"));
    await vi.runAllTimersAsync();
    const response = await result;
    const text = await response.clone().text();
    expectNothingLeaked(text);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    return response;
  }

  const secret = { detail: "UPSTREAM-SECRET-DETAIL" };

  it("maps 429 to rate_limited with the upstream Retry-After, without retrying", async () => {
    const response = await failWith(async () => upstream(429, secret, { "retry-after": "7" }));
    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("7");
    expect((await errorBody(response)).error.code).toBe("rate_limited");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("defaults Retry-After when upstream sends none", async () => {
    const response = await failWith(async () => upstream(429, secret));
    expect(response.headers.get("Retry-After")).toBe("10");
  });

  it.each([529, 503])("maps %i to upstream_busy after one retry", async (status) => {
    const response = await failWith(async () => upstream(status, secret));
    expect(response.status).toBe(503);
    expect((await errorBody(response)).error.code).toBe("upstream_busy");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([500, 401, 422])("maps %i to upstream_error", async (status) => {
    const response = await failWith(async () => upstream(status, secret));
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error.code).toBe("upstream_error");
  });

  it("maps a connection failure to upstream_error", async () => {
    const response = await failWith(async () => {
      throw new TypeError("fetch failed UPSTREAM-SECRET-DETAIL");
    });
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error.code).toBe("upstream_error");
  });

  it("maps an attempt timeout to 504 without retrying", async () => {
    const response = await failWith(
      (_url?: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason));
        }),
    );
    expect(response.status).toBe(504);
    expect((await errorBody(response)).error.code).toBe("timeout");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("refuses to cache a malformed 200", async () => {
    const kv = fakeKv();
    const cache = fakeCache();
    fetchMock.mockImplementation(async () => upstream(200, { answers: "UPSTREAM-SECRET-DETAIL" }));
    const response = await call(ruleUrl("plain bagel"), {
      TYPESAFE_API_KEY: KEY,
      RULINGS: kv as unknown as KVNamespace,
    });
    expect(response.status).toBe(502);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(response)).error.code).toBe("upstream_error");
    await Promise.all(pending);
    expect(kv.put).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("maps a null 200 to upstream_error", async () => {
    fetchMock.mockResolvedValueOnce(upstream(200, null));
    const response = await call(ruleUrl("plain bagel"));
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error.code).toBe("upstream_error");
  });

  it("refuses to cache a 200 that is missing an answer", async () => {
    const kv = fakeKv();
    const cache = fakeCache();
    const { outrage: _missing, ...partial } = mockPolicyResponse("plain bagel").answers;
    fetchMock.mockImplementation(async () =>
      upstream(200, { model: "jev-1.13.0", answers: partial }),
    );
    const response = await call(ruleUrl("plain bagel"), {
      TYPESAFE_API_KEY: KEY,
      RULINGS: kv as unknown as KVNamespace,
    });
    expect(response.status).toBe(502);
    await Promise.all(pending);
    expect(kv.put).not.toHaveBeenCalled();
    expect(cache.put).not.toHaveBeenCalled();
  });

  it("turns unexpected exceptions into a JSON 500", async () => {
    const handler = createRuleHandler({
      take: () => {
        throw new Error("limiter bug");
      },
      size: () => 0,
    });
    const request = new Request(`${ORIGIN}${ruleUrl("plain bagel")}`);
    const response = await handler(request, { TYPESAFE_API_KEY: KEY }, waitUntil);
    expect(response.status).toBe(500);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(response)).error.code).toBe("internal");
  });

  it("logs the failure without the key or upstream body", async () => {
    await failWith(async () => upstream(422, secret, { "x-typesafe-request-id": "req_123" }));
    expect(logs).toContainEqual([
      "rule: Jev call failed",
      {
        code: "upstream_error",
        error: "UnprocessableEntityError",
        status: 422,
        requestId: "req_123",
      },
    ]);
  });
});

describe("challenge and spend caps", () => {
  const TURNSTILE = "1x0000000000000000000000000000000AA";
  const SESSION_SECRET = "0123456789abcdef0123456789abcdef-do-not-leak";

  function guardedEnv(overrides: Partial<Env> = {}) {
    const d1 = fakeD1();
    const env: Env = {
      TYPESAFE_API_KEY: KEY,
      TURNSTILE_SECRET_KEY: TURNSTILE,
      SESSION_SECRET,
      DB: d1.binding,
      ...overrides,
    };
    return { d1, env };
  }

  async function cookie(now = Date.now()) {
    return `${SESSION_COOKIE}=${await issueSession(SESSION_SECRET, now)}`;
  }

  function ask(
    order: string,
    env: Env,
    sessionCookie?: string,
    extra: Record<string, string> = {},
  ) {
    const handler = createRuleHandler(createRateLimiter({ limit: 100, windowMs: 60_000 }));
    const headers: Record<string, string> = { "CF-Connecting-IP": "203.0.113.7", ...extra };
    if (sessionCookie) headers.Cookie = sessionCookie;
    return handler(new Request(`${ORIGIN}${ruleUrl(order)}`, { headers }), env, waitUntil);
  }

  const usage = (d1: ReturnType<typeof fakeD1>) =>
    d1.sqlite.prepare("SELECT day, calls FROM usage").all();

  it("serves an edge cache hit without a cookie", async () => {
    const cache = fakeCache();
    const { d1, env } = guardedEnv();
    fetchMock.mockResolvedValueOnce(jevOk("plain bagel"));
    expect((await ask("plain bagel", env, await cookie())).status).toBe(200);
    await Promise.all(pending);

    const response = await ask("plain bagel", env);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Bagel-Cache")).toBe("HIT");
    expect(cache.match).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usage(d1)).toEqual([{ day: expect.any(String), calls: 1 }]);
  });

  it("serves a KV hit without a cookie or any D1 read", async () => {
    const stored = JSON.stringify(mockPolicyResponse("sesame bagel"));
    const kv = fakeKv({ [`v${QUESTION_SET_VERSION}:sesame bagel`]: stored });
    const { d1, env } = guardedEnv({ RULINGS: kv as unknown as KVNamespace });
    const response = await ask("sesame bagel", env);
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Bagel-Cache")).toBe("KV");
    expect(d1.calls).toEqual([]);
  });

  it("answers a miss without a cookie with 401 challenge_required", async () => {
    const { d1, env } = guardedEnv();
    const response = await ask("plain bagel", env);
    expect(response.status).toBe(401);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(response)).error.code).toBe("challenge_required");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(d1.calls).toHaveLength(1);
    expect(usage(d1)).toEqual([]);
  });

  it("skips the human check with 503 daily_limit once the day is spent", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T23:00:00Z"));
    const { d1, env } = guardedEnv({ DAILY_CALL_LIMIT: "2" });
    d1.sqlite.exec("INSERT INTO usage (day, calls) VALUES ('2026-09-22', 1)");
    expect((await ask("plain bagel", env)).status).toBe(401);

    d1.sqlite.exec("UPDATE usage SET calls = 2");
    d1.calls.length = 0;
    const refused = await ask("plain bagel", env);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("Retry-After")).toBe("3600");
    expect(refused.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(refused)).error.code).toBe("daily_limit");
    expect(d1.calls).toHaveLength(1);
    expect(fetchMock).not.toHaveBeenCalled();

    vi.setSystemTime(new Date("2026-09-23T00:00:01Z"));
    expect((await ask("plain bagel", env)).status).toBe(401);
  });

  it("skips the human check without reading D1 when DAILY_CALL_LIMIT is 0", async () => {
    const { d1, env } = guardedEnv({ DAILY_CALL_LIMIT: "0" });
    const response = await ask("plain bagel", env);
    expect(response.status).toBe(503);
    expect((await errorBody(response)).error.code).toBe("daily_limit");
    expect(d1.calls).toEqual([]);
  });

  it("still challenges when the early daily read fails, leaving the charge to refuse", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1_ERROR: rows read limit");
      },
    } as unknown as D1Database;
    const { env } = guardedEnv({ DB: broken });
    const response = await ask("plain bagel", env);
    expect(response.status).toBe(401);
    expect((await errorBody(response)).error.code).toBe("challenge_required");
    expect(JSON.stringify(logs)).toContain("rule: early spend read failed");
  });

  it("skips the human check with 429 client_limit once this client is spent for the day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T20:00:00Z"));
    const { d1, env } = guardedEnv();
    fetchMock.mockImplementation(async () => jevOk("plain bagel"));
    expect((await ask("plain bagel", env, await cookie())).status).toBe(200);
    d1.sqlite.exec(`UPDATE clients SET calls = ${CLIENT_DAILY_CALL_LIMIT}`);
    d1.calls.length = 0;

    const refused = await ask("egg bagel", env);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe(String(4 * 3600));
    expect((await errorBody(refused)).error.code).toBe("client_limit");
    expect(d1.calls).toHaveLength(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    const elsewhere = { "CF-Connecting-IP": "198.51.100.4" };
    expect((await ask("egg bagel", env, undefined, elsewhere)).status).toBe(401);
  });

  it.each([
    ["the day", { DAILY_CALL_LIMIT: "1" }, "daily_limit", 503],
    ["the client", {}, "client_limit", 429],
  ] as const)(
    "tells a spent session that %s is spent instead of sending it to a check",
    async (_label, overrides, code, status) => {
      const { d1, env } = guardedEnv(overrides);
      const session = await cookie();
      fetchMock.mockImplementation(async () => jevOk("plain bagel"));
      expect((await ask("plain bagel", env, session)).status).toBe(200);
      d1.sqlite.exec(`UPDATE sessions SET calls = ${SESSION_CALL_LIMIT}`);
      d1.sqlite.exec(`UPDATE clients SET calls = ${CLIENT_DAILY_CALL_LIMIT}`);
      if (code === "daily_limit") d1.sqlite.exec("UPDATE clients SET calls = 1");

      const response = await ask("egg bagel", env, session);
      expect(response.status).toBe(status);
      expect((await errorBody(response)).error.code).toBe(code);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(d1.sqlite.prepare("SELECT calls FROM sessions").all()).toEqual([
        { calls: SESSION_CALL_LIMIT },
      ]);
    },
  );

  it("rejects an expired or tampered cookie", async () => {
    const { env } = guardedEnv();
    const stale = await cookie(Date.now() - 3601 * 1000);
    const valid = await cookie();
    // The signature's last base64url character carries padding bits, so tamper with the payload.
    const at = valid.indexOf("=") + 1;
    const tampered = `${valid.slice(0, at)}${valid[at] === "e" ? "f" : "e"}${valid.slice(at + 1)}`;
    for (const value of [stale, tampered, `${SESSION_COOKIE}=junk`]) {
      expect((await ask("plain bagel", env, value)).status).toBe(401);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("calls Jev with a valid cookie and counts the call", async () => {
    const { d1, env } = guardedEnv();
    fetchMock.mockResolvedValueOnce(jevOk("plain bagel"));
    const response = await ask("plain bagel", env, await cookie());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Bagel-Cache")).toBe("MISS");
    expect(usage(d1)).toEqual([{ day: new Date().toISOString().slice(0, 10), calls: 1 }]);
    expect(d1.sqlite.prepare("SELECT calls FROM sessions").all()).toEqual([{ calls: 1 }]);
  });

  it("adds each call's input tokens to the day it was charged to", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T23:59:59Z"));
    const { d1, env } = guardedEnv();
    fetchMock.mockImplementation(async () => {
      vi.setSystemTime(new Date("2026-09-23T00:00:01Z"));
      return jevOk("plain bagel");
    });
    expect((await ask("plain bagel", env, await cookie())).status).toBe(200);
    await Promise.all(pending);
    const rows = d1.sqlite.prepare("SELECT day, calls, input_tokens, token_calls FROM usage").all();
    expect(rows).toEqual([{ day: "2026-09-22", calls: 1, input_tokens: 12, token_calls: 1 }]);
  });

  it("records the tokens of a malformed 200, since Jev may still bill it", async () => {
    const { d1, env } = guardedEnv();
    const { outrage: _missing, ...answers } = mockPolicyResponse("plain bagel").answers;
    fetchMock.mockResolvedValueOnce(
      upstream(200, { model: "jev-1.13.0", answers, usage: { input_tokens: 12 } }),
    );
    expect((await ask("plain bagel", env, await cookie())).status).toBe(502);
    await Promise.all(pending);
    const rows = d1.sqlite.prepare("SELECT calls, input_tokens, token_calls FROM usage").all();
    expect(rows).toEqual([{ calls: 1, input_tokens: 12, token_calls: 1 }]);
  });

  it("still answers when the token count cannot be written", async () => {
    const { d1, env } = guardedEnv();
    d1.sqlite.exec("ALTER TABLE usage DROP COLUMN input_tokens");
    fetchMock.mockResolvedValueOnce(jevOk("plain bagel"));
    const response = await ask("plain bagel", env, await cookie());
    expect(response.status).toBe(200);
    expect(response.headers.get("X-Bagel-Cache")).toBe("MISS");
    await Promise.all(pending);
    expect(JSON.stringify(logs)).toContain("rule: token count failed");
  });

  it("skips the token count when Jev reports no usage", async () => {
    const { d1, env } = guardedEnv();
    fetchMock.mockResolvedValueOnce(
      upstream(200, { model: "jev-1.13.0", answers: mockPolicyResponse("plain bagel").answers }),
    );
    expect((await ask("plain bagel", env, await cookie())).status).toBe(200);
    await Promise.all(pending);
    expect(d1.calls.filter((sql) => sql.includes("input_tokens"))).toEqual([]);
  });

  it("refuses Jev past DAILY_CALL_LIMIT until UTC midnight, but keeps serving the cache", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T23:00:00Z"));
    const cache = fakeCache();
    const { d1, env } = guardedEnv({ DAILY_CALL_LIMIT: "2" });
    const session = await cookie();
    fetchMock.mockImplementation(async () => jevOk("plain bagel"));

    expect((await ask("plain bagel", env, session)).status).toBe(200);
    expect((await ask("egg bagel", env, session)).status).toBe(200);
    const refused = await ask("sesame bagel", env, session);
    expect(refused.status).toBe(503);
    expect(refused.headers.get("Retry-After")).toBe("3600");
    expect(refused.headers.get("Cache-Control")).toBe("no-store");
    expect((await errorBody(refused)).error.code).toBe("daily_limit");
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(usage(d1)).toEqual([{ day: "2026-09-22", calls: 2 }]);
    expect(d1.sqlite.prepare("SELECT calls FROM sessions").all()).toEqual([{ calls: 2 }]);

    await Promise.all(pending);
    expect(cache.store.size).toBe(2);
    expect((await ask("plain bagel", env)).status).toBe(200);

    vi.setSystemTime(new Date("2026-09-23T00:00:01Z"));
    expect((await ask("sesame bagel", env, await cookie())).status).toBe(200);
  });

  it("caps new rulings per client per UTC day, without spending the session or the day", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T20:00:00Z"));
    const { d1, env } = guardedEnv();
    fetchMock.mockImplementation(async () => jevOk("plain bagel"));
    expect((await ask("plain bagel", env, await cookie())).status).toBe(200);
    d1.sqlite.exec(`UPDATE clients SET calls = ${CLIENT_DAILY_CALL_LIMIT}`);

    const session = await cookie();
    const refused = await ask("egg bagel", env, session);
    expect(refused.status).toBe(429);
    expect(refused.headers.get("Retry-After")).toBe(String(4 * 3600));
    expect((await errorBody(refused)).error.code).toBe("client_limit");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usage(d1)).toEqual([{ day: "2026-09-22", calls: 1 }]);
    const sessions = d1.sqlite.prepare("SELECT calls FROM sessions ORDER BY calls").all();
    expect(sessions).toEqual([{ calls: 0 }, { calls: 1 }]);

    const elsewhere = { "CF-Connecting-IP": "198.51.100.4" };
    expect((await ask("egg bagel", env, session, elsewhere)).status).toBe(200);
    vi.setSystemTime(new Date("2026-09-23T00:00:01Z"));
    expect((await ask("sesame bagel", env, await cookie())).status).toBe(200);
  });

  it("keys the client counter on a daily HMAC, never the raw IP", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-22T20:00:00Z"));
    const { d1, env } = guardedEnv();
    fetchMock.mockImplementation(async () => jevOk("plain bagel"));
    await ask("plain bagel", env, await cookie());
    vi.setSystemTime(new Date("2026-09-23T01:00:00Z"));
    await ask("egg bagel", env, await cookie());
    const rows = d1.sqlite.prepare("SELECT key, day, calls FROM clients ORDER BY day").all();
    expect(rows).toEqual([
      { key: expect.stringMatching(/^[\w-]{43}$/), day: "2026-09-22", calls: 1 },
      { key: expect.stringMatching(/^[\w-]{43}$/), day: "2026-09-23", calls: 1 },
    ]);
    expect(rows[0]?.key).not.toBe(rows[1]?.key);
    expect(JSON.stringify(rows)).not.toContain("203.0.113.7");
  });

  it("refunds the client too when the day refuses", async () => {
    const { d1, env } = guardedEnv({ DAILY_CALL_LIMIT: "0" });
    await ask("plain bagel", env, await cookie());
    expect(d1.sqlite.prepare("SELECT calls FROM clients").all()).toEqual([{ calls: 0 }]);
  });

  it("does not spend the session on refusals once the day is spent", async () => {
    const { d1, env } = guardedEnv({ DAILY_CALL_LIMIT: "0" });
    const session = await cookie();
    for (let i = 0; i <= SESSION_CALL_LIMIT; i++) {
      const response = await ask(`bagel ${i}`, env, session);
      expect((await errorBody(response)).error.code).toBe("daily_limit");
    }
    expect(d1.sqlite.prepare("SELECT calls FROM sessions").all()).toEqual([{ calls: 0 }]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("treats DAILY_CALL_LIMIT=0 as a kill switch", async () => {
    const { env } = guardedEnv({ DAILY_CALL_LIMIT: "0" });
    const response = await ask("plain bagel", env, await cookie());
    expect(response.status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("re-challenges a session that used its calls without spending the daily budget", async () => {
    const { d1, env } = guardedEnv();
    const session = await cookie();
    fetchMock.mockImplementation(async () => jevOk("plain bagel"));
    expect((await ask("plain bagel", env, session)).status).toBe(200);
    d1.sqlite.exec(`UPDATE sessions SET calls = ${SESSION_CALL_LIMIT}`);

    const response = await ask("egg bagel", env, session);
    expect(response.status).toBe(401);
    expect((await errorBody(response)).error.code).toBe("challenge_required");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(usage(d1)).toEqual([{ day: expect.any(String), calls: 1 }]);
    expect((await ask("egg bagel", env, await cookie())).status).toBe(200);
  });

  it("fails closed when TURNSTILE_SECRET_KEY is set without SESSION_SECRET", async () => {
    const cache = fakeCache();
    const { d1, env } = guardedEnv({ SESSION_SECRET: undefined });
    const response = await ask("plain bagel", env, await cookie());
    expect(response.status).toBe(500);
    expect((await errorBody(response)).error.code).toBe("internal");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(d1.calls).toEqual([]);
    expect(JSON.stringify(logs)).toContain("SESSION_SECRET is missing");

    const stored = new Response(JSON.stringify(mockPolicyResponse("plain bagel")));
    cache.store.set(`${ORIGIN}${ruleUrl("plain bagel")}`, stored);
    expect((await ask("plain bagel", env)).status).toBe(200);
  });

  it("refuses Jev when the spend check itself fails", async () => {
    const broken = {
      prepare: () => {
        throw new Error("D1_ERROR: no such table: usage");
      },
    } as unknown as D1Database;
    const { env } = guardedEnv({ DB: broken });
    const response = await ask("plain bagel", env, await cookie());
    expect(response.status).toBe(500);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(JSON.stringify(logs)).not.toContain("no such table");
  });

  it("skips the caps with one warning when DB is not bound", async () => {
    fetchMock.mockImplementation(async () => jevOk("plain bagel"));
    const { env } = guardedEnv({ DB: undefined, TURNSTILE_SECRET_KEY: undefined });
    expect((await ask("plain bagel", env)).status).toBe(200);
    expect((await ask("egg bagel", env)).status).toBe(200);
    const warnings = logs.filter(([message]) => String(message).includes("no DB binding"));
    expect(warnings.length).toBeLessThanOrEqual(1);
  });

  it("challenges mock rulings too, so the flow can be tried without a key", async () => {
    const { d1, env } = guardedEnv({ TYPESAFE_API_KEY: undefined });
    expect((await ask("plain bagel", env)).status).toBe(401);
    const response = await ask("plain bagel", env, await cookie());
    expect(response.status).toBe(200);
    expect(((await response.json()) as RuleResponse).mock).toBe(true);
    expect(d1.calls).toEqual([]);
  });

  it("never logs the session secret or cookie", async () => {
    const { env } = guardedEnv();
    const value = await cookie();
    fetchMock.mockResolvedValueOnce(jevOk("plain bagel"));
    await ask("plain bagel", env, value);
    await ask("egg bagel", env, `${value}x`);
    const logged = JSON.stringify(logs);
    expect(logged).not.toContain(SESSION_SECRET);
    expect(logged).not.toContain(value.split("=")[1]);
  });
});
