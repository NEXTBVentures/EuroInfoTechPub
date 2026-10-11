import { describe, expect, it } from "vitest";
import { assertOrganizationScope, denyByDefaultAuthorization } from "./context";
import { assertModuleAvailable } from "./modules";

const context = {
  organizationId: "org-a",
  actor: { kind: "anonymous" as const },
  requestId: "request-1",
};

describe("foundation access boundaries", () => {
  it("rejects cross-organization resources", () => {
    expect(() => assertOrganizationScope(context, "org-b")).toThrow(
      "organization_scope_violation",
    );
  });

  it("denies permissions until an explicit policy is implemented", async () => {
    await expect(denyByDefaultAuthorization.can(context, "admin:read")).resolves.toBe(
      false,
    );
  });

  it("blocks planned or disabled modules in application services", () => {
    expect(() =>
      assertModuleAvailable("payments", {
        enabled: false,
        implementationStatus: "PLANNED",
      }),
    ).toThrow("module_unavailable:payments");
  });
});
