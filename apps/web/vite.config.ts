import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { mockApi } from "./plugins/mockApi.ts";

const FUNCTIONS_DEV = "http://localhost:8788";

// Setting deny replaces Vite's defaults, so they are repeated here. .dev.vars is a symlink to the
// root .env (the TypeSafe key), and Vite would otherwise serve it at /.dev.vars.
export const FS_DENY = [
  ".env",
  ".env.*",
  "*.{crt,pem,key,p12,pfx,cer,der}",
  ".npmrc",
  ".yarnrc.yml",
  "**/.git/**",
  ".dev.vars",
  ".dev.vars.*",
];

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const mock = env.BAGEL_MOCK_API === "1";
  const proxy = mock ? undefined : { "/api": FUNCTIONS_DEV };
  return {
    plugins: [react(), mock && mockApi()],
    server: { port: 5173, strictPort: true, proxy, fs: { deny: FS_DENY } },
    preview: { port: 4173, proxy },
    // Source maps would ship the full source of @bagel/core, question text included.
    build: { target: "es2022", sourcemap: false },
  };
});
