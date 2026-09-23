import { describe, expect, it } from "vitest";
import { clientNetwork } from "./env";

const from = (ip: string | null) =>
  clientNetwork(
    new Request("https://bagels.test/", ip ? { headers: { "CF-Connecting-IP": ip } } : {}),
  );

describe("clientNetwork", () => {
  it("keeps IPv4 addresses as they are", () => {
    expect(from("203.0.113.7")).toBe("203.0.113.7");
    expect(from("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("puts every address in one IPv6 /64 under the same key", () => {
    const key = "2001:db8:1:2::/64";
    expect(from("2001:db8:1:2::1")).toBe(key);
    expect(from("2001:0db8:0001:0002:aaaa:bbbb:cccc:dddd")).toBe(key);
    expect(from("2001:DB8:1:2:ffff::")).toBe(key);
    expect(from("2001:db8:1:3::1")).not.toBe(key);
  });

  it("handles compressed prefixes", () => {
    expect(from("::1")).toBe("0:0:0:0::/64");
    expect(from("fe80::1:2:3:4")).toBe("fe80:0:0:0::/64");
  });

  it("passes through what it cannot parse", () => {
    expect(from("not:an::ip::at:all")).toBe("not:an::ip::at:all");
    expect(from(null)).toBe("unknown");
  });
});
