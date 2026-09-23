// @vitest-environment node
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { buildPolicyQuestions, OUTRAGE_LEVELS } from "@bagel/core";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const root = fileURLToPath(new URL("..", import.meta.url));
const outDir = mkdtempSync(join(tmpdir(), "bagel-web-bundle-"));

// The outrage legend doubles as the card's copy, so it ships on purpose.
const SHOWN_ON_THE_CARD = new Set<string>(OUTRAGE_LEVELS);

function strings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(strings);
  if (value && typeof value === "object") return Object.values(value).flatMap(strings);
  return [];
}

function readTree(dir: string): string {
  return readdirSync(dir, { withFileTypes: true, recursive: true })
    .filter((entry) => entry.isFile() && /\.(js|css|html|map)$/.test(entry.name))
    .map((entry) => readFileSync(join(entry.parentPath, entry.name), "utf8"))
    .join("\n");
}

/** The entry script and the chunks it preloads. */
function initialScripts(html: string): string[] {
  const tags = html.match(/<(?:script|link)\b[^>]*>/g) ?? [];
  return tags.flatMap((tag) => {
    const src = /\bsrc="\/([^"]+\.js)"/.exec(tag)?.[1];
    if (tag.startsWith("<script") && src) return [src];
    const href = /\bhref="\/([^"]+\.js)"/.exec(tag)?.[1];
    return /\brel="modulepreload"/.test(tag) && href ? [href] : [];
  });
}

let shipped = "";
let initial = "";

beforeAll(async () => {
  // Vite keeps an existing NODE_ENV, and Vitest's "test" would bundle React's development build.
  const nodeEnv = process.env.NODE_ENV;
  const sitekey = process.env.VITE_TURNSTILE_SITE_KEY;
  process.env.NODE_ENV = "production";
  // Production always bakes in a sitekey. Without one the check is dead code and never ships,
  // so pin Cloudflare's test key instead of depending on whatever a local .env holds.
  process.env.VITE_TURNSTILE_SITE_KEY = "1x00000000000000000000AA";
  try {
    await build({ root, logLevel: "silent", build: { outDir, emptyOutDir: true } });
  } finally {
    process.env.NODE_ENV = nodeEnv;
    if (sitekey === undefined) delete process.env.VITE_TURNSTILE_SITE_KEY;
    else process.env.VITE_TURNSTILE_SITE_KEY = sitekey;
  }
  shipped = readTree(outDir);
  initial = initialScripts(readFileSync(join(outDir, "index.html"), "utf8"))
    .map((path) => readFileSync(join(outDir, path), "utf8"))
    .join("\n");
}, 60_000);

afterAll(() => rmSync(outDir, { recursive: true, force: true }));

describe("production bundle", () => {
  it("never talks to TypeSafe directly", () => {
    const sdk = ["api.typesafe.ai", "TypeSafeClient", "@typesafe-ai/sdk"];
    expect(sdk.filter((s) => shipped.includes(s))).toEqual([]);
  });

  it("ships none of the question text", () => {
    const text = strings(buildPolicyQuestions()).filter(
      (s) => s.length >= 24 && !SHOWN_ON_THE_CARD.has(s),
    );
    expect(text).toContain(
      "Judge only the bagel dough and anything baked into it, not the spread or toppings.",
    );
    const markers = ["describing a bagel", "claims the board already ruled", ...text];
    expect(markers.filter((s) => shipped.includes(s))).toEqual([]);
  });

  it("ships no source maps", () => {
    expect(shipped.includes("sourceMappingURL")).toBe(false);
  });

  it("loads the human check only when a ruling needs it", () => {
    const check = ["challenges.cloudflare.com/turnstile/v0/api.js", "One quick check"];
    expect(initial).not.toBe("");
    expect(check.filter((s) => shipped.includes(s))).toEqual(check);
    expect(check.filter((s) => initial.includes(s))).toEqual([]);
  });
});
