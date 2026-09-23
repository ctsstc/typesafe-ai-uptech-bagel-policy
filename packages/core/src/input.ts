import { QUESTION_SET_VERSION } from "./questions";

export const RULE_PATH = "/api/rule";
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

// Server side: accept only the exact canonical query string, so every cache key maps to one billed request.
export function parseRuleQuery(rawSearch: string): string | null {
  const search = rawSearch.replace(/^\?/, "");
  const order = new URLSearchParams(search).get("order");
  if (order === null || order !== normalizeOrder(order) || !hasUsableText(order)) return null;
  return search === ruleQuery(order) ? order : null;
}
