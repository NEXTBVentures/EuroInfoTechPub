import { NextResponse } from "next/server";
import { vendorStaffRevokeSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { enforceRecentAuthentication, requireIdentity } from "../../../../../../lib/identity-api";
import { hasVendorPermission } from "../../../../../../lib/identity-context";
import { writeVendorAudit } from "../../../../../../lib/vendor-service";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ membershipId: string }> };

export async function DELETE(request: Request, context: RouteContext): Promise<Response> {
  const parsed = vendorStaffRevokeSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const { membershipId } = await context.params;
  const { vendorId, password, code } = parsed.data;
  if (!hasVendorPermission(guard.identity, vendorId, "vendor.staff.manage")) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }
  const denied = await enforceRecentAuthentication(request, guard.identity, password, code);
  if (denied) return denied;
  const member = await prisma.organizationMembership.findFirst({
    where: {
      id: membershipId,
      organizationId: guard.identity.tenant.id,
      status: "ACTIVE",
      assignments: { some: { vendorId, roleKey: "VENDOR_STAFF" } },
    },
    select: { id: true, userId: true },
  });
  if (!member) return NextResponse.json({ error: "vendor_staff_not_found" }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.roleAssignment.deleteMany({
      where: {
        organizationId: guard.identity.tenant.id,
        membershipId,
        vendorId,
        roleKey: "VENDOR_STAFF",
      },
    });
    await tx.vendorStaffPermission.deleteMany({
      where: { organizationId: guard.identity.tenant.id, vendorId, membershipId },
    });
    await tx.vendorStaffInvitation.updateMany({
      where: { organizationId: guard.identity.tenant.id, vendorId, acceptedMembershipId: membershipId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    await tx.session.deleteMany({ where: { userId: member.userId } });
    await writeVendorAudit(tx, {
      organizationId: guard.identity.tenant.id,
      vendorId,
      actorUserId: guard.identity.user.id,
      action: "staff.access_revoked",
      targetId: membershipId,
    });
  });
  return NextResponse.json({ success: true });
}
