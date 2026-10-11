import { NextResponse } from "next/server";
import { prisma } from "@workspace/database";
import { ROLE_KEYS } from "@workspace/core";
import { roleManagementSchema } from "@workspace/contracts";
import { requireIdentity, requireFreshSecondFactor, enforceRecentAuthentication } from "../../../../../lib/identity-api";
import { isVendorAssignment } from "../../../../../lib/identity-context";

export const dynamic = "force-dynamic";

async function guardRequest(request: Request): Promise<Awaited<ReturnType<typeof requireIdentity>>> {
  const guard = await requireIdentity(request);
  if (guard.response) return guard;
  const identity = guard.identity;
  if (!identity.hasPermission("admin.roles.manage") || !identity.hasAdminRole) {
    return { response: NextResponse.json({ error: "access_denied" }, { status: 403 }) };
  }
  const response = await requireFreshSecondFactor(identity);
  return response ? { response } : { identity };
}

export async function GET(request: Request): Promise<Response> {
  const guard = await guardRequest(request);
  if (guard.response || !guard.identity) return guard.response!;
  const members = await prisma.organizationMembership.findMany({
    where: { organizationId: guard.identity.tenant.id, status: "ACTIVE" },
    include: { user: { select: { id: true, name: true, email: true } }, assignments: true },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return NextResponse.json({
    members: members.map((member) => ({
      userId: member.user.id, name: member.user.name, email: member.user.email,
      roles: member.assignments.map((role) => ({
        id: role.id, roleKey: role.roleKey, vendorId: role.vendorId,
        approved: !isVendorAssignment(role.roleKey) || Boolean(role.vendorApprovedAt),
      })),
    })),
    roleKeys: ROLE_KEYS,
  }, { headers: { "Cache-Control": "no-store" } });
}

async function changeRole(request: Request, remove: boolean): Promise<Response> {
  const guard = await guardRequest(request);
  if (guard.response || !guard.identity) return guard.response!;
  const identity = guard.identity;
  const parsed = roleManagementSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const input = parsed.data;
  if (isVendorAssignment(input.roleKey) !== Boolean(input.vendorId)) {
    return NextResponse.json({ error: "vendor_scope_required_only_for_vendor_roles" }, { status: 400 });
  }
  const denied = await enforceRecentAuthentication(request, identity, input.password, input.code);
  if (denied) return denied;
  try {
    const outcome = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "User" WHERE "id" = ${input.userId} FOR UPDATE`;
      // Serialize owner changes in this organization, including last-owner checks.
      await tx.$queryRaw`SELECT "id" FROM "Organization" WHERE "id" = ${identity.tenant.id}::uuid FOR UPDATE`;
      const member = await tx.organizationMembership.findUnique({
        where: { organizationId_userId: { organizationId: identity.tenant.id, userId: input.userId } },
        include: { user: { include: { totpCredential: true } } },
      });
      if (!member || member.status !== "ACTIVE") return "not_found";
      if (!remove && ["ADMIN_STAFF", "ORGANISATION_OWNER"].includes(input.roleKey) &&
        (!member.user.twoFactorEnabled || !member.user.totpCredential?.verifiedAt)) return "totp_required";
      const roleWhere = { organizationId: identity.tenant.id, membershipId: member.id, roleKey: input.roleKey, vendorId: input.vendorId ?? null };
      if (remove) {
        if (input.roleKey === "ORGANISATION_OWNER" &&
          await tx.roleAssignment.count({ where: { organizationId: identity.tenant.id, roleKey: "ORGANISATION_OWNER", membership: { status: "ACTIVE" } } }) <= 1) {
          return "last_owner";
        }
        await tx.roleAssignment.deleteMany({ where: roleWhere });
      } else if (!await tx.roleAssignment.findFirst({ where: roleWhere })) {
        await tx.roleAssignment.create({ data: { ...roleWhere, assignedByUserId: identity.user.id } });
      }
      // Clear stale elevated verification on role changes; actor reauthentication
      // can remain valid unless the actor is also the target.
      await tx.session.updateMany({ where: { userId: input.userId }, data: { mfaVerifiedAt: null, mfaMethod: null } });
      for (const eventType of ["ROLE_CHANGED", "PERMISSION_CHANGED"] as const) {
        await tx.authAuditEvent.create({ data: {
          eventType, organizationId: identity.tenant.id, actorUserId: identity.user.id,
          targetUserId: input.userId,
        } });
      }
      return "ok";
    });
    if (outcome !== "ok") {
      return NextResponse.json({ error: outcome }, { status: outcome === "not_found" ? 404 : 409 });
    }
    return NextResponse.json({ success: true, vendorApprovalDeferred: isVendorAssignment(input.roleKey) && !remove });
  } catch {
    return NextResponse.json({ error: "role_change_unavailable" }, { status: 503 });
  }
}

export async function POST(request: Request): Promise<Response> { return changeRole(request, false); }
export async function DELETE(request: Request): Promise<Response> { return changeRole(request, true); }
