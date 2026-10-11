export const PERMISSION_KEYS = [
  "customer.profile.manage",
  "customer.address.manage",
  "vendor.application.create",
  "vendor.profile.manage",
  "vendor.staff.manage",
  "vendor.application.view",
  "vendor.kyc.upload",
  "vendor.catalogue.manage",
  "vendor.orders.manage",
  "vendor.finance.view",
  "vendor.bank.manage",
  "admin.customers.manage",
  "admin.vendors.manage",
  "admin.vendors.view",
  "admin.vendors.review",
  "admin.vendors.approve",
  "admin.vendors.suspend",
  "admin.vendor_bank.verify",
  "admin.catalogue.moderate",
  "admin.orders.manage",
  "admin.finance.manage",
  "admin.roles.manage",
  "organisation.settings.manage",
] as const;

export type PermissionKey = (typeof PERMISSION_KEYS)[number];

export const ROLE_KEYS = [
  "CUSTOMER",
  "VENDOR_OWNER",
  "VENDOR_STAFF",
  "ADMIN_STAFF",
  "ORGANISATION_OWNER",
] as const;

export type RoleKey = (typeof ROLE_KEYS)[number];

export const ROLE_LABELS: Record<RoleKey, string> = {
  CUSTOMER: "Customer",
  VENDOR_OWNER: "Vendor Owner",
  VENDOR_STAFF: "Vendor Staff",
  ADMIN_STAFF: "Admin Staff",
  ORGANISATION_OWNER: "Organisation Owner",
};

export const DEFAULT_ROLE_PERMISSIONS: Record<RoleKey, readonly PermissionKey[]> = {
  CUSTOMER: [
    "customer.profile.manage",
    "customer.address.manage",
    "vendor.application.create",
    "vendor.kyc.upload",
  ],
  VENDOR_OWNER: [
    "vendor.profile.manage",
    "vendor.staff.manage",
    "vendor.application.view",
    "vendor.kyc.upload",
    "vendor.catalogue.manage",
    "vendor.orders.manage",
    "vendor.finance.view",
    "vendor.bank.manage",
  ],
  VENDOR_STAFF: [
    "vendor.profile.manage",
    "vendor.application.view",
    "vendor.catalogue.manage",
    "vendor.orders.manage",
  ],
  ADMIN_STAFF: [
    "admin.customers.manage",
    "admin.vendors.manage",
    "admin.vendors.view",
    "admin.vendors.review",
    "admin.catalogue.moderate",
    "admin.orders.manage",
  ],
  ORGANISATION_OWNER: [
    ...PERMISSION_KEYS,
  ],
};

export function hasPermission(
  rolePermissionKeys: readonly (readonly string[])[],
  permission: string,
): boolean {
  return PERMISSION_KEYS.includes(permission as PermissionKey) &&
    rolePermissionKeys.some((permissions) => permissions.includes(permission));
}

export function hasAdminRole(roleKeys: readonly string[]): boolean {
  return roleKeys.includes("ADMIN_STAFF") || roleKeys.includes("ORGANISATION_OWNER");
}

export function requiresAdminTwoFactor(roleKeys: readonly string[]): boolean {
  return hasAdminRole(roleKeys);
}

export function isSafeRedirectPath(
  target: string | null | undefined,
  fallback = "/account",
): string {
  if (!target || !target.startsWith("/") || target.startsWith("//") ||
    target.includes("\\") || /[\u0000-\u001f\u007f]/.test(target)) {
    return fallback;
  }
  try {
    const base = new URL("https://same-origin.invalid");
    const parsed = new URL(target, base);
    if (parsed.origin !== base.origin || parsed.pathname.startsWith("/api/")) return fallback;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return fallback;
  }
}

export function otpVerificationAllowed(expiresAtMs: number, attempts: number, nowMs: number): boolean {
  return Number.isFinite(expiresAtMs) && expiresAtMs > nowMs && attempts >= 0 && attempts < 3;
}

export function otpResendAllowed(resendAfterMs: number, nowMs: number): boolean {
  return Number.isFinite(resendAfterMs) && resendAfterMs <= nowMs;
}
