import type { RuleErrorCode } from "@bagel/core";

export type RulingErrorCode =
  | RuleErrorCode
  | "offline"
  | "network"
  | "challenge_skipped"
  | "over_capacity";

export const WAITING_FOR_CHECK = "Waiting for the quick check.";

function clockTime(date: Date): string {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

// The caps reset at midnight UTC, which is still this afternoon or evening west of UTC.
function reopens(retryAfter: number | null, now: number): string {
  if (!retryAfter || retryAfter <= 0) return "at midnight UTC";
  const reset = new Date(now + retryAfter * 1000);
  const sameDay = reset.toDateString() === new Date(now).toDateString();
  return `${sameDay ? "" : "tomorrow "}at ${clockTime(reset)} your time`;
}

function waitFor(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? "1 second" : `${seconds} seconds`;
  const minutes = Math.ceil(seconds / 60);
  return minutes === 1 ? "1 minute" : `${minutes} minutes`;
}

const ALREADY_RULED = "Orders someone already asked about usually still work.";

export function errorMessage(
  code: RulingErrorCode,
  retryAfter: number | null,
  now = Date.now(),
): string {
  switch (code) {
    case "rate_limited":
      return retryAfter && retryAfter > 0
        ? `Too many new rulings at once. Try again in ${waitFor(retryAfter)}.`
        : "Too many new rulings at once. Try again in a moment.";
    case "client_limit":
      return `Your network has used up today's new rulings. New rulings open again ${reopens(retryAfter, now)}. ${ALREADY_RULED}`;
    case "daily_limit":
      return `The board has used up today's new rulings. New rulings open again ${reopens(retryAfter, now)}. ${ALREADY_RULED}`;
    case "over_capacity":
      return "The board is swamped. Too many people are asking at once. Orders you already looked up on this device may still work. Try again later.";
    case "stale_client":
      return "The board was updated. Reload the page to keep submitting new orders.";
    case "challenge_required":
      return "Couldn't confirm you're human, so Jev wasn't asked. Try again. If it keeps failing, a content blocker may be stopping challenges.cloudflare.com.";
    case "challenge_skipped":
      return "Skipped the quick check. Jev wasn't asked, so nothing was spent. Submit again whenever you like.";
    case "upstream_busy":
      return "Jev is busy right now. Try again shortly.";
    case "upstream_error":
      return "Jev could not rule on that right now. Try again.";
    case "timeout":
      return "The review board took too long. Try again.";
    case "offline":
      return "You're offline. Try again once you're back online.";
    case "network":
      return "Could not reach the review board. Check your connection.";
    case "bad_request":
      return "The board could not read that order. Try rewording it.";
    case "not_found":
    case "method_not_allowed":
    case "internal":
      return "Something went wrong on our side. Try again.";
  }
}
