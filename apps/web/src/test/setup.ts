import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";

const hasDom = typeof window !== "undefined";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  if (!hasDom) return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
});

if (hasDom) {
  window.matchMedia ??= (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
  Element.prototype.scrollIntoView ??= () => {};
}
