import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  D1_PLACEHOLDER,
  KV_PLACEHOLDER,
  parseDotenv,
  productionConfig,
  readSettings,
} from "./cloudflare-config.mjs";

const ACCOUNT = "0123456789abcdef0123456789abcdef";
const KV = "fedcba9876543210fedcba9876543210";
const D1 = "12345678-9abc-def0-1234-56789abcdef0";
const DOTENV = `TYPESAFE_API_KEY=x\nCLOUDFLARE_ACCOUNT_ID=${ACCOUNT}\nCLOUDFLARE_KV_RULINGS_ID=${KV}\nCLOUDFLARE_D1_DATABASE_ID=${D1}\n`;

describe("parseDotenv", () => {
  it("reads assignments and skips comments and blank lines", () => {
    const text = "# CLOUDFLARE_ACCOUNT_ID=commented\n\nA=1\n  B = two words \nnot a line\n";
    expect(parseDotenv(text)).toEqual({ A: "1", B: "two words" });
  });

  it("strips matching quotes and an export prefix, and lets the last assignment win", () => {
    const text = `export A="${KV}"\nB='${D1}'\nC="unbalanced'\nA=${ACCOUNT}\r\n`;
    expect(parseDotenv(text)).toEqual({ A: ACCOUNT, B: D1, C: `"unbalanced'` });
  });

  it("keeps an empty value empty", () => {
    expect(parseDotenv("CLOUDFLARE_KV_RULINGS_ID=\n")).toEqual({ CLOUDFLARE_KV_RULINGS_ID: "" });
  });
});

describe("readSettings", () => {
  it("reads the ids from the root .env, with the environment taking precedence", () => {
    expect(readSettings({}, DOTENV)).toEqual({
      settings: {
        CLOUDFLARE_ACCOUNT_ID: ACCOUNT,
        CLOUDFLARE_KV_RULINGS_ID: KV,
        CLOUDFLARE_D1_DATABASE_ID: D1,
      },
      missing: [],
    });
    const other = "abcdefabcdefabcdefabcdefabcdefab";
    expect(
      readSettings({ CLOUDFLARE_ACCOUNT_ID: other }, DOTENV).settings.CLOUDFLARE_ACCOUNT_ID,
    ).toBe(other);
  });

  it("refuses missing, malformed and placeholder ids", () => {
    const dotenv = `CLOUDFLARE_ACCOUNT_ID=nope\nCLOUDFLARE_KV_RULINGS_ID=${KV_PLACEHOLDER}\nCLOUDFLARE_D1_DATABASE_ID=${D1_PLACEHOLDER}\n`;
    expect(readSettings({}, dotenv).missing).toEqual([
      "CLOUDFLARE_ACCOUNT_ID",
      "CLOUDFLARE_KV_RULINGS_ID",
      "CLOUDFLARE_D1_DATABASE_ID",
    ]);
    expect(readSettings({}, "").missing).toHaveLength(3);
  });

  it("ignores the old cube variable name", () => {
    const dotenv = DOTENV.replace("CLOUDFLARE_KV_RULINGS_ID", "CLOUDFLARE_KV_CLASSIFICATIONS_ID");
    expect(readSettings({}, dotenv).missing).toEqual(["CLOUDFLARE_KV_RULINGS_ID"]);
  });
});

describe("productionConfig", () => {
  const template = `{ "kv_namespaces": [{ "id": "${KV_PLACEHOLDER}" }], "d1_databases": [{ "database_id": "${D1_PLACEHOLDER}" }] }`;
  const settings = { CLOUDFLARE_KV_RULINGS_ID: KV, CLOUDFLARE_D1_DATABASE_ID: D1 };

  it("swaps each placeholder for the real id", () => {
    const config = productionConfig(template, settings);
    expect(config).toContain(KV);
    expect(config).toContain(D1);
    expect(config).not.toContain(KV_PLACEHOLDER);
    expect(config).not.toContain(D1_PLACEHOLDER);
  });

  it("refuses a template without exactly one of each placeholder", () => {
    expect(() => productionConfig("{}", settings)).toThrow(/exactly once/);
    expect(() => productionConfig(`${template}${template}`, settings)).toThrow(/exactly once/);
  });
});

describe("apps/web/wrangler.jsonc", () => {
  const committed = readFileSync(new URL("../apps/web/wrangler.jsonc", import.meta.url), "utf8");

  it("keeps the placeholder ids, so real ones never get committed", () => {
    expect(committed.split(KV_PLACEHOLDER)).toHaveLength(2);
    expect(committed.split(D1_PLACEHOLDER)).toHaveLength(2);
  });

  it("holds no id but the placeholders, even in a binding added beside them", () => {
    const ids = committed.match(
      /\b(?:[0-9a-f]{32}|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/g,
    );
    expect(new Set(ids)).toEqual(new Set([KV_PLACEHOLDER, D1_PLACEHOLDER]));
  });

  it("names the bindings and database the scripts expect", () => {
    expect(committed).toMatch(/"binding":\s*"RULINGS"/);
    expect(committed).toMatch(/"binding":\s*"DB"/);
    expect(committed).toMatch(/"database_name":\s*"bagel-review-board"/);
  });
});
