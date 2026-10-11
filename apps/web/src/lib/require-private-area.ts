import "server-only";
import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "./auth";
import { getIdentityContext } from "./identity-context";
import { resolveTenantFromRequest } from "./tenant";

export async function requirePrivateArea(area: "customer" | "vendor" | "admin") {
  const requestHeaders = await headers();
  if (!await resolveTenantFromRequest(requestHeaders)) notFound();
  const target = area === "customer" ? "/account" : `/${area}`;
  const identity = await getIdentityContext(requestHeaders);
  if (!identity) {
    const session = await auth.api.getSession({ headers: requestHeaders });
    if (session) redirect(`/access-denied?reason=role&returnTo=${target}`);
    redirect(`/login?returnTo=${target}`);
  }
  const allowed = area === "customer"
    ? identity.roleKeys.includes("CUSTOMER") && identity.hasPermission("customer.profile.manage")
    : area === "vendor"
      ? (
        identity.assignments.some((assignment) =>
          assignment.vendorId && assignment.vendorApprovedAt &&
          (assignment.roleKey === "VENDOR_OWNER" || assignment.roleKey === "VENDOR_STAFF"),
        ) && identity.hasPermission("vendor.profile.manage")
      ) || identity.hasPermission("vendor.application.create")
      : identity.hasAdminRole && identity.permissions.some((key) => key.startsWith("admin.") || key.startsWith("organisation."));
  if (!allowed) redirect(`/access-denied?reason=role&returnTo=${target}`);
  if (area === "admin") {
    if (!identity.hasVerifiedTotp) redirect(`/security/totp?mode=setup&returnTo=${target}`);
    if (!identity.mfaFresh) redirect(`/security/totp?mode=challenge&returnTo=${target}`);
  }
  return identity;
}
