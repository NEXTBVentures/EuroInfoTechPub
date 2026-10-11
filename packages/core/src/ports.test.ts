import { describe, expect, it } from "vitest";
import { DisabledProvider } from "./ports";

describe("provider neutrality", () => {
  for (const kind of ["payments", "shipping", "messaging", "ai"] as const) {
    it(`rejects live ${kind} execution`, async () => {
      const provider = new DisabledProvider(kind);
      expect(provider.enabled).toBe(false);
      await expect(provider.execute()).rejects.toThrow(`provider_disabled:${kind}`);
    });
  }
});
