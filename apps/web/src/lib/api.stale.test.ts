import { ruleUrl } from "@bagel/core";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { fetchRuling } from "./api";

vi.mock("./challenge", () => {
  throw new TypeError("Failed to fetch dynamically imported module");
});

beforeEach(() => vi.stubEnv("VITE_TURNSTILE_SITE_KEY", "1x00000000000000000000AA"));
afterEach(() => vi.unstubAllEnvs());

it("asks for a reload when the check's chunk is gone after a deploy", async () => {
  const fetchMock = vi.fn(
    async () =>
      new Response(JSON.stringify({ error: { code: "challenge_required", message: "check" } }), {
        status: 401,
      }),
  );
  vi.stubGlobal("fetch", fetchMock);
  const outcome = await fetchRuling("plain bagel");
  expect(outcome).toMatchObject({ ok: false, code: "stale_client" });
  expect(fetchMock).toHaveBeenCalledExactlyOnceWith(ruleUrl("plain bagel"), expect.anything());
});
