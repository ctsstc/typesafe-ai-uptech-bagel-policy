import type { RuleErrorCode, RuleResponse } from "@bagel/core";
import type { Plugin } from "vite";

type Core = typeof import("@bagel/core");

const ERRORS: Record<string, RuleErrorCode> = {
  "mock 429": "rate_limited",
  "mock 502": "upstream_error",
  "mock 503": "upstream_busy",
  "mock 504": "timeout",
  "mock 500": "internal",
};

// Serves /api/rule from Vite without wrangler. Type "mock 429" and friends to see each error state.
export function mockApi(): Plugin {
  return {
    name: "bagel:mock-api",
    apply: "serve",
    configureServer(server) {
      // Loaded through Vite so the workspace package's extensionless TS imports resolve.
      const core = server.ssrLoadModule("@bagel/core") as Promise<Core>;
      server.middlewares.use("/api/rule", async (req, res) => {
        const { RULE_ERROR_CODES, mockPolicyResponse, parseRuleQuery } = await core;
        const send = (status: number, body: unknown) => {
          res.writeHead(status, {
            "content-type": "application/json; charset=utf-8",
            "cache-control": "no-store",
          });
          res.end(JSON.stringify(body));
        };
        const order = parseRuleQuery((req.url ?? "").split("?")[1] ?? "");
        if (order === null) {
          send(400, { error: { code: "bad_request", message: "Not a canonical query." } });
          return;
        }
        const errorCode = ERRORS[order];
        if (errorCode) {
          send(RULE_ERROR_CODES[errorCode], {
            error: { code: errorCode, message: `Simulated ${errorCode}.` },
          });
          return;
        }
        const body: RuleResponse = { ...mockPolicyResponse(order), mock: true };
        setTimeout(() => send(200, body), 150 + (order.length % 5) * 60);
      });
    },
  };
}
