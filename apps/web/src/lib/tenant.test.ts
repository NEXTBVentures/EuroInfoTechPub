import { describe, expect, it } from "vitest";
import { normalizeHost } from "./tenant";

describe("request tenant host validation", () => {
  it("normalizes DNS host casing, trailing dot and explicit port", () => {
    expect(normalizeHost("Euro-Infotech.Test:3000")).toBe("euro-infotech.test");
    expect(normalizeHost("euro-infotech.test.")).toBe("euro-infotech.test");
  });
  it("fails closed for missing, ambiguous or malformed authority", () => {
    for (const value of [null, "", "a.test,b.test", "a.test/path", "user@a.test", "a.test\\path", "a.test?q=x"]) {
      expect(normalizeHost(value)).toBeNull();
    }
  });
});
