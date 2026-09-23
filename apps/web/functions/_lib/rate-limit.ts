export interface RateLimiter {
  /** Returns 0 when the call is allowed, otherwise the seconds until the window resets. */
  take(key: string, now: number): number;
  /** How many client keys (IP addresses) are held right now. */
  size(): number;
}

// Per isolate and per location only: a speed bump for a single client looping on new items,
// not a global quota. See docs/deploy.md for the trade-offs.
export function createRateLimiter({
  limit,
  windowMs,
  maxKeys = 10_000,
}: {
  limit: number;
  windowMs: number;
  maxKeys?: number;
}): RateLimiter {
  const windows = new Map<string, { start: number; count: number }>();
  return {
    take(key, now) {
      // Windows are inserted as they start, so the expired ones are always at the head.
      for (const [held, { start }] of windows) {
        if (now - start < windowMs) break;
        windows.delete(held);
      }
      let entry = windows.get(key);
      if (!entry || now - entry.start >= windowMs) {
        windows.delete(key);
        if (windows.size >= maxKeys) {
          const oldest = windows.keys().next().value;
          if (oldest !== undefined) windows.delete(oldest);
        }
        entry = { start: now, count: 0 };
        windows.set(key, entry);
      }
      if (entry.count >= limit)
        return Math.max(1, Math.ceil((entry.start + windowMs - now) / 1000));
      entry.count++;
      return 0;
    },
    size: () => windows.size,
  };
}
