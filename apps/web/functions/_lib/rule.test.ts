import { ruleUrl } from "@bagel/core";
import { describe, expect, it } from "vitest";
import { createRuleHandler } from "./rule";

const ORIGIN = "https://bagels.test";
const noWait = () => {};

describe("rule handler", () => {
  const handle = createRuleHandler();

  it("serves a mock ruling when no key is set", async () => {
    const response = await handle(new Request(`${ORIGIN}${ruleUrl("plain bagel")}`), {}, noWait);
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toBe("no-store");
    expect(await response.json()).toMatchObject({ mock: true, model: "mock" });
  });

  it("rejects a non-canonical query", async () => {
    const response = await handle(new Request(`${ORIGIN}/api/rule?order=Plain`), {}, noWait);
    expect(response.status).toBe(400);
  });

  it("rejects other methods", async () => {
    const request = new Request(`${ORIGIN}${ruleUrl("plain bagel")}`, { method: "POST" });
    const response = await handle(request, {}, noWait);
    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("GET");
  });
});
