// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createRateLimiter } from "./rate-limit";

describe("createRateLimiter", () => {
  it("allows up to the limit per window, then reports seconds until reset", () => {
    const limiter = createRateLimiter({ limit: 2, windowMs: 60_000 });
    expect(limiter.take("a", 0)).toBe(0);
    expect(limiter.take("a", 1_000)).toBe(0);
    expect(limiter.take("a", 1_500)).toBe(59);
    expect(limiter.take("b", 1_500)).toBe(0);
  });

  it("starts a fresh window once the old one expires", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 10_000 });
    expect(limiter.take("a", 0)).toBe(0);
    expect(limiter.take("a", 9_999)).toBe(1);
    expect(limiter.take("a", 10_000)).toBe(0);
  });

  it("forgets every key once its window is over, even if that client never returns", () => {
    const limiter = createRateLimiter({ limit: 5, windowMs: 60_000 });
    limiter.take("a", 0);
    limiter.take("b", 30_000);
    expect(limiter.size()).toBe(2);
    limiter.take("c", 60_000);
    expect(limiter.size()).toBe(2);
    limiter.take("c", 90_000);
    expect(limiter.size()).toBe(1);
  });

  it("forgets the oldest key instead of growing without bound", () => {
    const limiter = createRateLimiter({ limit: 1, windowMs: 60_000, maxKeys: 2 });
    limiter.take("a", 0);
    limiter.take("b", 0);
    limiter.take("c", 0);
    expect(limiter.take("a", 1)).toBe(0);
    expect(limiter.take("c", 1)).toBeGreaterThan(0);
  });
});
