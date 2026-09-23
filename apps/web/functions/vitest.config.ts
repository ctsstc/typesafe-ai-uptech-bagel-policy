import { defineProject } from "vitest/config";

export default defineProject({
  test: {
    name: "functions",
    environment: "node",
    execArgv: ["--disable-warning=ExperimentalWarning"],
  },
});
