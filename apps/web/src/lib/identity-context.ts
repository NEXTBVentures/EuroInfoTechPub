import "server-only";
import { auth } from "./auth";
import { prisma } from "@workspace/database";
import {
  PERMISSION_KEYS,
  hasAdminRole,
  hasPermission,
  requiresAdminTwoFactor,
} from "@workspace/core";
import { resolveTenantFromRequest } from "./tenant";

const MFA_FRESHNESS_MS = 12 * 60 * 60 * 1000;

export async function getIdentityContext(requestHeaders: Headers) {
  const [tenant, session] = await Promise.all([
    resolveTenantFromRequest(requestHeaders),
    auth.api.getSession({ headers: requestHeaders }),
  ]);
  if (!tenant?.identityEnabled || !session) return null;

  const membership = await prisma.organizationMembership.findUnique({
    where: {
      organizationId_userId: {
        organizationId: tenant.id,
        userId: session.user.id,
      },
    },
    include: {
      assignments: {
        include: {
          role: {
            include: {
              permissions: {
                include: { permission: true },
              },
            },
          },
        },
      },
    },
  });
  if (!membership || membership.status !== "ACTIVE") return null;

  const assignedVendorIds = [...new Set(membership.assignments
    .filter((assignment) => assignment.roleKey === "VENDOR_OWNER" || assignment.roleKey === "VENDOR_STAFF")
    .map((assignment) => assignment.vendorId)
    .filter((id): id is string => Boolean(id)))];
  const activeVendorIds = new Set(assignedVendorIds.length
    ? (await prisma.vendor.findMany({
      where: { organizationId: tenant.id, id: { in: assignedVendorIds }, status: "ACTIVE" },
      select: { id: true },
    })).map(({ id }) => id)
    : []);
  const assignments = membership.assignments.filter((assignment) => {
    if (assignment.roleKey !== "VENDOR_OWNER" && assignment.roleKey !== "VENDOR_STAFF") return true;
    return Boolean(
      assignment.vendorId &&
      assignment.vendorApprovedAt &&
      activeVendorIds.has(assignment.vendorId),
    );
  });
  const roleKeys = assignments.map((assignment) => assignment.roleKey);
  const rolePermissionKeys = assignments.map((assignment) =>
    assignment.role.permissions.map(({ permission }) => permission.key)
  );
  const vendorAssignments = assignments.filter((assignment) =>
    assignment.roleKey === "VENDOR_STAFF" && assignment.vendorId,
  );
  const vendorPermissionGrants = vendorAssignments.length
    ? await prisma.vendorStaffPermission.findMany({
      where: {
        organizationId: tenant.id,
        membershipId: membership.id,
        vendorId: { in: vendorAssignments.map((assignment) => assignment.vendorId!) },
        permissionKey: {
          in: PERMISSION_KEYS.filter((key) => key.startsWith("vendor.")),
        },
      },
      select: { vendorId: true, permissionKey: true },
    })
    : [];
  const permissions = [...new Set(rolePermissionKeys.flat())];
  const mfaCredential = await prisma.adminTotpCredential.findUnique({
    where: { userId: session.user.id },
    select: { verifiedAt: true },
  });
  const verifiedAt = session.session.mfaVerifiedAt;
  const mfaFresh = Boolean(
    verifiedAt &&
    Date.now() - new Date(verifiedAt).getTime() <= MFA_FRESHNESS_MS
  );

  return {
    tenant,
    session: session.session,
    user: session.user,
    membership,
    assignments,
    vendorPermissionGrants,
    roleKeys,
    permissions,
    hasPermission: (permission: string) => hasPermission(rolePermissionKeys, permission),
    needsAdminTwoFactor: requiresAdminTwoFactor(roleKeys),
    hasAdminRole: hasAdminRole(roleKeys),
    hasVerifiedTotp: Boolean(mfaCredential?.verifiedAt && session.user.twoFactorEnabled),
    mfaFresh,
  };
}

export type IdentityContext = NonNullable<Awaited<ReturnType<typeof getIdentityContext>>>;

export function isVendorAssignment(roleKey: string): boolean {
  return roleKey === "VENDOR_OWNER" || roleKey === "VENDOR_STAFF";
}

export function hasRequiredMfa(identity: IdentityContext): boolean {
  if (!identity.needsAdminTwoFactor && !identity.user.twoFactorEnabled) return true;
  return identity.hasVerifiedTotp && identity.mfaFresh;
}

export function hasVendorPermission(
  identity: IdentityContext,
  vendorId: string,
  permission: string,
): boolean {
  const assignment = identity.assignments.find((candidate) =>
    candidate.vendorId === vendorId &&
    (candidate.roleKey === "VENDOR_OWNER" || candidate.roleKey === "VENDOR_STAFF"),
  );
  if (!assignment) return false;
  if (assignment.role.permissions.some(({ permission: item }) => item.key === permission)) return true;
  return assignment.roleKey === "VENDOR_STAFF" &&
    identity.vendorPermissionGrants.some((grant) =>
      grant.vendorId === vendorId && grant.permissionKey === permission,
    );
}
