import { describe, expect, it } from "vitest";
import { orderFromSearch, orderHref, shareUrl } from "./url";

describe("share URLs", () => {
  it("round-trips a normalized order", () => {
    const href = orderHref("everything bagel, lox & capers");
    expect(orderFromSearch(href.slice(1))).toBe("everything bagel, lox & capers");
  });

  it("normalizes a hand-edited link", () => {
    expect(orderFromSearch("?order=%20Plain%20BAGEL!!")).toBe("plain bagel");
  });

  it("ignores links without usable text", () => {
    expect(orderFromSearch("?order=123")).toBeNull();
    expect(orderFromSearch("?food=bagel")).toBeNull();
  });

  it("builds an absolute link", () => {
    expect(shareUrl("plain bagel", "https://bagels.test")).toBe(
      "https://bagels.test/?order=plain+bagel",
    );
  });
});
