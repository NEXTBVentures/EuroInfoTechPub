import { describe, expect, it } from "vitest";
import {
  vendorApplicationCreateSchema,
  vendorProfileSchema,
  vendorStaffInviteSchema,
  vendorStaffPermissionSchema,
} from "./vendor";

describe("vendor request contracts", () => {
  it("accepts incomplete information as a draft without weakening final profile validation", () => {
    expect(vendorApplicationCreateSchema.parse({
      profile: {
        legalName: "",
        storeName: "",
        contactEmail: "",
        registeredAddress: {},
      },
    }).profile).toMatchObject({
      legalName: "",
      storeName: "",
      contactEmail: "",
      registeredAddress: {},
    });
    expect(() => vendorProfileSchema.parse({
      legalName: "",
      storeName: "",
      contactEmail: "",
    })).toThrow();
  });

  it("requires a verified contact and rejects administrator permissions in invitations", () => {
    const vendorId = "9c9f0a00-1100-4000-8000-000000000001";
    const base = { vendorId, password: "synthetic-test-password" };
    expect(() => vendorStaffInviteSchema.parse(base)).toThrow();
    expect(() => vendorStaffInviteSchema.parse({
      ...base,
      email: "staff@example.invalid",
      permissionKeys: ["admin.roles.manage"],
    })).toThrow();
    expect(vendorStaffInviteSchema.parse({
      ...base,
      email: " Staff@Example.invalid ",
      permissionKeys: ["vendor.profile.manage"],
    }).email).toBe("staff@example.invalid");
  });

  it("limits sensitive bank grants to the explicit vendor-bank permission", () => {
    const vendorId = "9c9f0a00-1100-4000-8000-000000000001";
    expect(vendorStaffPermissionSchema.parse({
      vendorId,
      permissionKeys: ["vendor.bank.manage"],
      password: "synthetic-test-password",
    }).permissionKeys).toEqual(["vendor.bank.manage"]);
    expect(() => vendorStaffPermissionSchema.parse({
      vendorId,
      permissionKeys: ["admin.vendors.approve"],
      password: "synthetic-test-password",
    })).toThrow();
  });
});
