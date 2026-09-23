import type { Plugin } from "vite";

// og:image and og:url must be absolute, so the deploy origin is baked in at build time.
export function siteMeta(siteUrl: string): Plugin {
  const origin = siteUrl.replace(/\/+$/, "");
  return {
    name: "bagel:site-meta",
    transformIndexHtml(html) {
      return html.replaceAll("%SITE_URL%", origin);
    },
  };
}
