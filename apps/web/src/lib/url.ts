import { hasUsableText, normalizeOrder } from "@bagel/core";

export const ORDER_PARAM = "order";

export function orderFromSearch(search: string): string | null {
  const raw = new URLSearchParams(search).get(ORDER_PARAM);
  if (raw === null) return null;
  const order = normalizeOrder(raw);
  return hasUsableText(order) ? order : null;
}

export function orderHref(order: string): string {
  return `/?${new URLSearchParams({ [ORDER_PARAM]: order }).toString()}`;
}

export function shareUrl(order: string, origin = window.location.origin): string {
  return `${origin}${orderHref(order)}`;
}
