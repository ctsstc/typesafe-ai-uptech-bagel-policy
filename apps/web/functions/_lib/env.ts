export interface Env {
  TYPESAFE_API_KEY?: string;
  RULINGS?: KVNamespace;
  DB?: D1Database;
  TURNSTILE_SECRET_KEY?: string;
  SESSION_SECRET?: string;
  DAILY_CALL_LIMIT?: string;
}

export type WaitUntil = (promise: Promise<unknown>) => void;

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}

/**
 * The key for per-client caps and rate limits. An IPv6 host can usually pick any address in its
 * /64, so IPv6 collapses to that prefix. IPv4, IPv4-mapped IPv6 and anything unparseable pass through.
 */
export function clientNetwork(request: Request): string {
  const ip = clientIp(request);
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped?.[1]) return mapped[1];
  const hextets = expandIpv6(ip);
  return hextets ? `${hextets.slice(0, 4).join(":")}::/64` : ip;
}

function expandIpv6(ip: string): string[] | null {
  const halves = ip.toLowerCase().split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0].split(":") : [];
  const tail = halves[1] ? halves[1].split(":") : [];
  const missing = 8 - head.length - tail.length;
  if (halves.length === 1 ? missing !== 0 : missing < 1) return null;
  const all = [...head, ...Array(Math.max(0, missing)).fill("0"), ...tail];
  if (!all.every((h) => /^[0-9a-f]{1,4}$/.test(h))) return null;
  return all.map((h) => h.replace(/^0+(?=.)/, ""));
}
