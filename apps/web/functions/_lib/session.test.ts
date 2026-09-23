// @vitest-environment node
import { createHmac } from "node:crypto";
import { CLIENT_TIMEOUT_MS, isRuleErrorBody, type RuleErrorBody } from "@bagel/core";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import type { Env } from "./env";
import { fakeD1 } from "./fake-d1";
import { createRateLimiter } from "./rate-limit";
import {
  clientKey,
  createSessionHandler,
  issueSession,
  readSession,
  SESSION_COOKIE,
  SESSION_TTL_S,
  SITEVERIFY_DEADLINE_MS,
  SITEVERIFY_URL,
} from "./session";

const ORIGIN = "https://bagel-review-board.pages.dev";
const HOST = new URL(ORIGIN).hostname;
const PASS_SECRET = "1x0000000000000000000000000000000AA";
const FAIL_SECRET = "2x0000000000000000000000000000000AA";
const REAL_SECRET = "0x4AAAAAAA-real-looking-secret-DO-NOT-LEAK";
const SESSION_SECRET = `${"s".repeat(24)}-session-secret-do-not-leak`;
const TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

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

function env(overrides: Partial<Env> = {}): Env {
  return { TURNSTILE_SECRET_KEY: PASS_SECRET, SESSION_SECRET, ...overrides };
}

function post(
  body: unknown,
  {
    origin = ORIGIN,
    method = "POST",
    type = "application/json",
    ip = "203.0.113.9",
  }: { origin?: string; method?: string; type?: string; ip?: string } = {},
) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return new Request(`${origin}/api/session`, {
    method,
    headers: { "Content-Type": type, "CF-Connecting-IP": ip },
    ...(method === "GET" || method === "HEAD" ? {} : { body: text }),
  });
}

function call(request: Request, e: Env = env(), limit = 100) {
  const handler = createSessionHandler(createRateLimiter({ limit, windowMs: 60_000 }));
  return handler(request, e, waitUntil);
}

function siteverify(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const passed = (extra: Record<string, unknown> = {}) =>
  siteverify({ success: true, "error-codes": [], hostname: "example.com", ...extra });

function sentTo(index = 0): Record<string, unknown> {
  const [url, init] = fetchMock.mock.calls[index] ?? [];
  expect(url).toBe(SITEVERIFY_URL);
  return JSON.parse(String(init?.body)) as Record<string, unknown>;
}

async function errorBody(response: Response): Promise<RuleErrorBody> {
  const body: unknown = await response.json();
  if (!isRuleErrorBody(body)) throw new Error(`not an error body: ${JSON.stringify(body)}`);
  return body;
}

function cookieOf(response: Response): string {
  const header = response.headers.get("Set-Cookie") ?? "";
  const [pair = ""] = header.split(";");
  return pair;
}

function withCookie(cookie: string) {
  return new Request(`${ORIGIN}/api/rule`, { headers: { Cookie: cookie } });
}

function forge(claims: Record<string, unknown>, secret = SESSION_SECRET): string {
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${SESSION_COOKIE}=${payload}.${signature}`;
}

function expectNothingLeaked() {
  const logged = JSON.stringify(logs);
  for (const secret of [PASS_SECRET, REAL_SECRET, SESSION_SECRET, TOKEN]) {
    expect(logged).not.toContain(secret);
  }
}

describe("POST /api/session", () => {
  it("verifies the token once and sets a signed session cookie", async () => {
    fetchMock.mockResolvedValueOnce(passed());
    const response = await call(post({ token: TOKEN }));

    expect(response.status).toBe(204);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    const header = response.headers.get("Set-Cookie") ?? "";
    expect(header).toMatch(new RegExp(`^${SESSION_COOKIE}=[\\w-]+\\.[\\w-]+;`));
    expect(header.split("; ").slice(1).sort()).toEqual(
      [`Max-Age=${SESSION_TTL_S}`, "Path=/api", "HttpOnly", "SameSite=Strict", "Secure"].sort(),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const sent = sentTo();
    expect(sent).toMatchObject({ secret: PASS_SECRET, response: TOKEN, remoteip: "203.0.113.9" });
    expect(sent.idempotency_key).toMatch(/^[0-9a-f-]{36}$/);

    const session = await readSession(withCookie(cookieOf(response)), SESSION_SECRET, Date.now());
    expect(session?.exp).toBe((session?.iat ?? 0) + SESSION_TTL_S);
    expectNothingLeaked();
  });

  it("drops Secure on localhost so plain http dev keeps the cookie", async () => {
    fetchMock.mockResolvedValueOnce(passed());
    const response = await call(post({ token: TOKEN }, { origin: "http://localhost:8788" }));
    expect(response.status).toBe(204);
    expect(response.headers.get("Set-Cookie")).not.toContain("Secure");
  });

  it("answers 401 challenge_required when siteverify says no", async () => {
    fetchMock.mockResolvedValueOnce(
      siteverify({ success: false, "error-codes": ["invalid-input-response"] }),
    );
    const response = await call(post({ token: TOKEN }), env({ TURNSTILE_SECRET_KEY: FAIL_SECRET }));
    expect(response.status).toBe(401);
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect((await errorBody(response)).error.code).toBe("challenge_required");
    expect(logs).toContainEqual(["session: token rejected", { codes: ["invalid-input-response"] }]);
    expectNothingLeaked();
  });

  it("checks hostname and action for real secrets", async () => {
    const realEnv = env({ TURNSTILE_SECRET_KEY: REAL_SECRET });
    const cases = [
      [{ hostname: "evil.example", action: "session" }, 401],
      [{ hostname: HOST, action: "login" }, 401],
      [{ hostname: HOST }, 401],
      [{ hostname: HOST, action: "session" }, 204],
    ] as const;
    for (const [extra, status] of cases) {
      fetchMock.mockResolvedValueOnce(passed(extra));
      const response = await call(post({ token: TOKEN }), realEnv);
      expect(response.status, JSON.stringify(extra)).toBe(status);
    }
    expectNothingLeaked();
  });

  it("skips the hostname and action checks only for Cloudflare's test secrets", async () => {
    fetchMock.mockResolvedValueOnce(passed({ hostname: "example.com" }));
    expect((await call(post({ token: TOKEN }))).status).toBe(204);
  });

  it("retries a failed siteverify once with the same idempotency key", async () => {
    fetchMock.mockRejectedValueOnce(new TypeError("network down")).mockResolvedValueOnce(passed());
    const response = await call(post({ token: TOKEN }));
    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentTo(0).idempotency_key).toBe(sentTo(1).idempotency_key);
  });

  it("reports a refused secret as our fault, not a failed check, and logs it once", async () => {
    const realEnv = env({ TURNSTILE_SECRET_KEY: REAL_SECRET });
    for (const code of ["invalid-input-secret", "missing-input-secret"]) {
      fetchMock.mockResolvedValueOnce(siteverify({ success: false, "error-codes": [code] }, 400));
      const response = await call(post({ token: TOKEN }), realEnv);
      expect(response.status, code).toBe(502);
      expect((await errorBody(response)).error.code).toBe("upstream_error");
    }
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const errors = logs.filter(([message]) => String(message).includes("refused TURNSTILE"));
    expect(errors).toHaveLength(1);
    expect(logs.some(([message]) => message === "session: token rejected")).toBe(false);
    expectNothingLeaked();
  });

  it("retries a siteverify internal-error with the same idempotency key", async () => {
    fetchMock
      .mockResolvedValueOnce(siteverify({ success: false, "error-codes": ["internal-error"] }))
      .mockResolvedValueOnce(passed());
    const response = await call(post({ token: TOKEN }));
    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentTo(0).idempotency_key).toBe(sentTo(1).idempotency_key);
  });

  it("answers 502 after a second siteverify internal-error", async () => {
    fetchMock.mockImplementation(async () =>
      siteverify({ success: false, "error-codes": ["internal-error"] }),
    );
    const response = await call(post({ token: TOKEN }));
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error.code).toBe("upstream_error");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("gives up on siteverify with time to answer before the SPA's own timeout", () => {
    expect(SITEVERIFY_DEADLINE_MS).toBeLessThanOrEqual(CLIENT_TIMEOUT_MS - 2_000);
  });

  it("stops retrying once the overall siteverify deadline passes", async () => {
    const timers = new Map<number, AbortController[]>();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      timers.set(ms, [...(timers.get(ms) ?? []), controller]);
      return controller.signal;
    });
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          const abort = () => reject(new DOMException("timed out", "TimeoutError"));
          init?.signal?.addEventListener("abort", abort, { once: true });
        }),
    );
    const response = call(post({ token: TOKEN }));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    timers.get(SITEVERIFY_DEADLINE_MS)?.[0]?.abort();
    expect((await response).status).toBe(502);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("answers 502 when siteverify stays down", async () => {
    fetchMock.mockImplementation(async () => siteverify({}, 500));
    const response = await call(post({ token: TOKEN }));
    expect(response.status).toBe(502);
    expect((await errorBody(response)).error.code).toBe("upstream_error");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["wrong content type", post({ token: TOKEN }, { type: "text/plain" })],
    ["invalid JSON", post("{token")],
    ["no token", post({ nope: TOKEN })],
    ["empty token", post({ token: "" })],
    ["non-string token", post({ token: 42 })],
    ["oversized token", post({ token: "x".repeat(2049) })],
    ["oversized body", post({ token: TOKEN, pad: "x".repeat(5000) })],
  ])("rejects %s with 400 before calling siteverify", async (_label, request) => {
    const response = await call(request);
    expect(response.status).toBe(400);
    expect((await errorBody(response)).error.code).toBe("bad_request");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("only accepts POST", async () => {
    const response = await call(post(null, { method: "GET" }));
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect((await errorBody(response)).error.code).toBe("method_not_allowed");
  });

  it("is a 404 when challenges are off", async () => {
    const response = await call(post({ token: TOKEN }), {});
    expect(response.status).toBe(404);
    expect((await errorBody(response)).error.code).toBe("not_found");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it.each([
    ["missing", {}],
    ["too short", { SESSION_SECRET: "short" }],
  ])("fails closed when SESSION_SECRET is %s", async (_label, overrides) => {
    const response = await call(post({ token: TOKEN }), {
      TURNSTILE_SECRET_KEY: PASS_SECRET,
      ...overrides,
    });
    expect(response.status).toBe(500);
    expect((await errorBody(response)).error.code).toBe("internal");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("limits session attempts per IP", async () => {
    fetchMock.mockImplementation(async () => passed());
    const handler = createSessionHandler(createRateLimiter({ limit: 1, windowMs: 60_000 }));
    expect((await handler(post({ token: TOKEN }), env(), waitUntil)).status).toBe(204);
    const limited = await handler(post({ token: TOKEN }), env(), waitUntil);
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("Retry-After"))).toBeGreaterThan(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("forgets expired sessions and past days' client counters in the background", async () => {
    const d1 = fakeD1();
    const past = Math.floor(Date.now() / 1000) - 10;
    const today = new Date().toISOString().slice(0, 10);
    d1.sqlite.exec(
      `INSERT INTO sessions (sid, calls, exp) VALUES ('old', 3, ${past}), ('live', 1, ${past + 3600})`,
    );
    d1.sqlite.exec(
      `INSERT INTO clients (key, day, calls) VALUES ('old', '2000-01-01', 3), ('live', '${today}', 1)`,
    );
    fetchMock.mockResolvedValueOnce(passed());
    expect((await call(post({ token: TOKEN }), env({ DB: d1.binding }))).status).toBe(204);
    await Promise.all(pending);
    expect(d1.sqlite.prepare("SELECT sid FROM sessions").all()).toEqual([{ sid: "live" }]);
    expect(d1.sqlite.prepare("SELECT key FROM clients").all()).toEqual([{ key: "live" }]);
  });
});

describe("session cookie", () => {
  const now = Date.parse("2026-09-22T12:00:00Z");
  const iat = now / 1000;
  const sid = "0b7c2f7e-3f5e-4a53-9d2b-1f4c6c7c8d9e";

  async function read(cookie: string, at = now) {
    return readSession(withCookie(cookie), SESSION_SECRET, at);
  }

  it("round trips a fresh session", async () => {
    const value = await issueSession(SESSION_SECRET, now);
    const session = await read(`${SESSION_COOKIE}=${value}`);
    expect(session).toMatchObject({ iat, exp: iat + SESSION_TTL_S });
    expect(session?.sid).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("reads the cookie among others", async () => {
    const value = await issueSession(SESSION_SECRET, now);
    expect(await read(`theme=dark; ${SESSION_COOKIE}=${value}; x=1`)).not.toBeNull();
  });

  it("accepts a cookie signed the documented way", async () => {
    expect(await read(forge({ sid, iat, exp: iat + 60 }))).toEqual({ sid, iat, exp: iat + 60 });
  });

  it.each([
    ["no cookie", ""],
    ["another secret", forge({ sid, iat, exp: iat + 60 }, "t".repeat(40))],
    ["expired", forge({ sid, iat: iat - 3600, exp: iat })],
    ["issued in the future", forge({ sid, iat: iat + 600, exp: iat + 900 })],
    ["longer than an hour", forge({ sid, iat, exp: iat + SESSION_TTL_S + 1 })],
    ["a bad sid", forge({ sid: "../../etc", iat, exp: iat + 60 })],
    ["non-integer times", forge({ sid, iat: "now", exp: iat + 60 })],
    ["garbage", `${SESSION_COOKIE}=not-a-session`],
    ["three parts", `${forge({ sid, iat, exp: iat + 60 })}.extra`],
    ["an oversized value", `${SESSION_COOKIE}=${"a".repeat(600)}.${"b".repeat(43)}`],
  ])("rejects %s", async (_label, cookie) => {
    expect(await read(cookie)).toBeNull();
  });

  it("rejects any change to the payload or signature", async () => {
    const value = await issueSession(SESSION_SECRET, now);
    const [payload = "", signature = ""] = value.split(".");
    const flip = (text: string, at: number) =>
      text.slice(0, at) + (text[at] === "A" ? "B" : "A") + text.slice(at + 1);
    expect(await read(`${SESSION_COOKIE}=${flip(payload, 5)}.${signature}`)).toBeNull();
    expect(await read(`${SESSION_COOKIE}=${payload}.${flip(signature, 5)}`)).toBeNull();
    expect(await read(`${SESSION_COOKIE}=${payload}.${signature.slice(0, -2)}`)).toBeNull();
  });

  it("expires after an hour", async () => {
    const value = await issueSession(SESSION_SECRET, now);
    const cookie = `${SESSION_COOKIE}=${value}`;
    expect(await read(cookie, now + (SESSION_TTL_S - 1) * 1000)).not.toBeNull();
    expect(await read(cookie, now + SESSION_TTL_S * 1000)).toBeNull();
  });
});

describe("clientKey", () => {
  const at = (ip: string) =>
    clientKey(new Request(ORIGIN, { headers: { "CF-Connecting-IP": ip } }), env(), "2026-09-23");

  it("gives every address in one IPv6 /64 the same key, and other networks their own", async () => {
    const key = await at("2001:db8:1:2::1");
    expect(key).not.toBeNull();
    expect(await at("2001:db8:1:2:ffff:ffff:ffff:ffff")).toBe(key);
    expect(await at("2001:db8:1:3::1")).not.toBe(key);
    expect(await at("203.0.113.7")).not.toBe(await at("203.0.113.8"));
  });

  it("never contains the address itself", async () => {
    expect(await at("203.0.113.7")).not.toContain("203.0.113.7");
  });
});
