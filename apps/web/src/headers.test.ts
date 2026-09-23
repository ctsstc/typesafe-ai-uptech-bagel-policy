// @vitest-environment node
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (path: string) =>
  readFileSync(fileURLToPath(new URL(path, import.meta.url).href), "utf8");
const headers = read("../public/_headers");
const indexHtml = read("../index.html");
const routes = JSON.parse(read("../public/_routes.json")) as unknown;

function csp(): Map<string, string[]> {
  const line = headers.split("\n").find((l) => l.trim().startsWith("Content-Security-Policy:"));
  if (!line) throw new Error("no Content-Security-Policy in _headers");
  const value = line.slice(line.indexOf(":") + 1);
  return new Map(
    value
      .split(";")
      .map((part) => part.trim().split(/\s+/))
      .filter((tokens) => tokens[0])
      .map(([name = "", ...sources]) => [name, sources]),
  );
}

const TURNSTILE = "https://challenges.cloudflare.com";
const REMOTE_SOURCES: Record<string, string[]> = {
  "script-src": [TURNSTILE],
  "frame-src": [TURNSTILE],
};

describe("public/_headers", () => {
  it("keeps the CSP free of unsafe sources", () => {
    const policy = csp();
    expect(policy.get("default-src")).toEqual(["'self'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    for (const [directive, sources] of policy) {
      expect(sources, directive).not.toContain("'unsafe-inline'");
      expect(sources, directive).not.toContain("'unsafe-eval'");
      expect(sources, directive).not.toContain("*");
      const remote = sources.filter((s) => /^(https?:|wss?:|\*\.|[\w-]+\.[\w.-]+)/.test(s));
      expect(remote, directive).toEqual(REMOTE_SOURCES[directive] ?? []);
    }
  });

  it("lets only Turnstile load its script and challenge frame", () => {
    const policy = csp();
    expect(policy.get("script-src")).toEqual(["'self'", TURNSTILE]);
    expect(policy.get("frame-src")).toEqual([TURNSTILE]);
    expect(policy.get("connect-src")).toEqual(["'self'"]);
    expect(policy.get("object-src")).toEqual(["'none'"]);
    expect(policy.get("base-uri")).toEqual(["'none'"]);
  });

  it("allows every inline script in index.html by hash", () => {
    const inline = [...indexHtml.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)];
    const allowed = csp().get("script-src") ?? [];
    for (const [, body = ""] of inline) {
      const hash = `'sha256-${createHash("sha256").update(body).digest("base64")}'`;
      expect(allowed, `update the script-src hash for: ${body.slice(0, 60)}`).toContain(hash);
    }
  });

  it("turns off device features the app never uses", () => {
    expect(headers).toMatch(/^\s+Permissions-Policy: .*\bcamera=\(\).*\bgeolocation=\(\)/m);
  });

  it("caches fingerprinted assets forever and revalidates the HTML shell", () => {
    expect(headers).toMatch(
      /^\/assets\/\*\n\s+Cache-Control: public, max-age=31536000, immutable$/m,
    );
    expect(headers).toMatch(/^\/\n\s+Cache-Control: no-cache$/m);
    expect(headers).toMatch(/^\/index\.html\n\s+Cache-Control: no-cache$/m);
  });

  it("keeps preview deployments out of search results", () => {
    expect(headers).toMatch(
      /^https:\/\/:version\.:project\.pages\.dev\/\*\n\s+X-Robots-Tag: noindex$/m,
    );
  });
});

describe("public/_routes.json", () => {
  it("invokes Functions only for /api/*", () => {
    expect(routes).toEqual({ version: 1, include: ["/api/*"], exclude: [] });
  });
});
