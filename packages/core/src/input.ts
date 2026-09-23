import { QUESTION_SET_VERSION } from "./questions";

export const RULE_PATH = "/api/rule";
export const SESSION_PATH = "/api/session";
// The widget and siteverify must agree on it, or every real token is rejected.
export const TURNSTILE_ACTION = "session";
export const MAX_ORDER_LENGTH = 120;

export function normalizeOrder(raw: string): string {
  const cleaned = raw
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\p{Pi}\p{Pf}]/gu, "'")
    .replace(/\p{Pd}/gu, "-")
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s'"]+/, "");
  // Cut before stripping trailing punctuation, so the result is stable under re-normalizing.
  return Array.from(cleaned)
    .slice(0, MAX_ORDER_LENGTH)
    .join("")
    .replace(/[\s?!.,;:'"]+$/u, "");
}

const USABLE_TEXT = /\p{L}/u;

export function hasUsableText(order: string): boolean {
  return USABLE_TEXT.test(order);
}

export function ruleQuery(order: string): string {
  return new URLSearchParams({ order, v: QUESTION_SET_VERSION }).toString();
}

export function ruleUrl(order: string): string {
  return `${RULE_PATH}?${ruleQuery(order)}`;
}

function canonicalOrder(order: string | null): order is string {
  return order !== null && order === normalizeOrder(order) && hasUsableText(order);
}

// Server side: accept only the exact canonical query string, so every cache key maps to one billed request.
export function parseRuleQuery(rawSearch: string): string | null {
  const search = rawSearch.replace(/^\?/, "");
  const order = new URLSearchParams(search).get("order");
  if (!canonicalOrder(order)) return null;
  return search === ruleQuery(order) ? order : null;
}

/** True for a query that is canonical except that `v` is another question set: a tab from another deploy. */
export function isStaleRuleQuery(rawSearch: string): boolean {
  const search = rawSearch.replace(/^\?/, "");
  const params = new URLSearchParams(search);
  const order = params.get("order");
  const version = params.get("v");
  if (!canonicalOrder(order) || version === null || version === QUESTION_SET_VERSION) return false;
  return (
    /^\d{1,4}$/.test(version) && search === new URLSearchParams({ order, v: version }).toString()
  );
}
