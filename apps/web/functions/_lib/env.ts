export interface Env {
  TYPESAFE_API_KEY?: string;
  RULINGS?: KVNamespace;
}

export type WaitUntil = (promise: Promise<unknown>) => void;

export function clientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") ?? "unknown";
}
