import { describe, expect, it } from "vitest";
import {
  DEFAULT_ROLE_PERMISSIONS,
  hasAdminRole,
  hasPermission,
  isSafeRedirectPath,
  requiresAdminTwoFactor,
  otpVerificationAllowed,
  otpResendAllowed,
} from "./identity";

describe("identity policies", () => {
  it("uses fine-grained role permissions and denies unknown permissions", () => {
    expect(hasPermission([DEFAULT_ROLE_PERMISSIONS.VENDOR_STAFF], "vendor.orders.manage")).toBe(true);
    expect(hasPermission([DEFAULT_ROLE_PERMISSIONS.VENDOR_STAFF], "vendor.bank.manage")).toBe(false);
    expect(hasPermission([DEFAULT_ROLE_PERMISSIONS.CUSTOMER], "admin.roles.manage")).toBe(false);
    expect(hasPermission([["admin.secret.override"]], "admin.secret.override")).toBe(false);
  });

  it("requires second factor for administrator roles only", () => {
    expect(hasAdminRole(["CUSTOMER"])).toBe(false);
    expect(requiresAdminTwoFactor(["ADMIN_STAFF"])).toBe(true);
    expect(requiresAdminTwoFactor(["ORGANISATION_OWNER"])).toBe(true);
  });

  it("accepts only safe same-origin application redirects", () => {
    expect(isSafeRedirectPath("/account/security?tab=sessions")).toBe("/account/security?tab=sessions");
    expect(isSafeRedirectPath("https://attacker.example")).toBe("/account");
    expect(isSafeRedirectPath("//attacker.example/path")).toBe("/account");
    expect(isSafeRedirectPath("/\\attacker.example")).toBe("/account");
    expect(isSafeRedirectPath("/api/auth/sign-out")).toBe("/account");
  });
  it("expires phone challenges after five minutes and caps attempts at three", () => {
    expect(otpVerificationAllowed(300_000, 0, 299_999)).toBe(true);
    expect(otpVerificationAllowed(300_000, 0, 300_000)).toBe(false);
    expect(otpVerificationAllowed(300_000, 3, 20_000)).toBe(false);
    expect(otpVerificationAllowed(300_000, -1, 20_000)).toBe(false);
  });
  it("enforces the resend cooldown", () => {
    expect(otpResendAllowed(60_000, 59_999)).toBe(false);
    expect(otpResendAllowed(60_000, 60_000)).toBe(true);
  });
});
