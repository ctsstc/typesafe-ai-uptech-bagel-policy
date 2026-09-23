import { RULE_ERROR_CODES } from "@bagel/core";
import { describe, expect, it } from "vitest";
import { errorMessage, type RulingErrorCode } from "./errors";

const clock = (time: number) =>
  new Date(time).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });

const CODES: RulingErrorCode[] = [
  ...(Object.keys(RULE_ERROR_CODES) as RulingErrorCode[]),
  "offline",
  "network",
  "challenge_skipped",
  "over_capacity",
];

describe("errorMessage", () => {
  it.each(CODES)("has dash-free copy for %s", (code) => {
    for (const retryAfter of [null, 30, 4 * 3600]) {
      const message = errorMessage(code, retryAfter);
      expect(message.length).toBeGreaterThan(0);
      expect(message).not.toMatch(/[\u2013\u2014]/);
    }
  });

  it("says when new rulings open again after the daily limit", () => {
    const now = new Date(2026, 8, 22, 10, 0).getTime();
    const message = errorMessage("daily_limit", 7 * 3600, now);
    expect(message).toContain("The board has used up today's new rulings.");
    expect(message).toContain(`New rulings open again at ${clock(now + 7 * 3600_000)} your time.`);
    expect(message).toContain("already asked about usually still work");
  });

  it("says tomorrow only when the reset falls on another local day", () => {
    const now = new Date(2026, 8, 22, 22, 0).getTime();
    expect(errorMessage("client_limit", 3 * 3600, now)).toContain(
      `open again tomorrow at ${clock(now + 3 * 3600_000)} your time.`,
    );
  });

  it("falls back to midnight UTC without a Retry-After", () => {
    expect(errorMessage("daily_limit", null)).toContain("open again at midnight UTC.");
    expect(errorMessage("client_limit", 0)).toContain("open again at midnight UTC.");
  });

  it("blames the network, not the board, for the client limit", () => {
    expect(errorMessage("client_limit", null)).toMatch(/^Your network has used up/);
  });

  it("counts down a rate limit in seconds or minutes", () => {
    expect(errorMessage("rate_limited", 1)).toBe(
      "Too many new rulings at once. Try again in 1 second.",
    );
    expect(errorMessage("rate_limited", 45)).toContain("Try again in 45 seconds.");
    expect(errorMessage("rate_limited", 61)).toContain("Try again in 2 minutes.");
    expect(errorMessage("rate_limited", null)).toContain("Try again in a moment.");
  });

  it("says the board is swamped when Pages fails open", () => {
    expect(errorMessage("over_capacity", null)).toMatch(/^The board is swamped\./);
  });

  it("tells a stale tab to reload", () => {
    expect(errorMessage("stale_client", null)).toContain("Reload the page");
  });

  it("tells a skipped check apart from a failed one", () => {
    expect(errorMessage("challenge_skipped", null)).toContain("nothing was spent");
    expect(errorMessage("challenge_required", null)).toContain("Couldn't confirm you're human");
  });
});
