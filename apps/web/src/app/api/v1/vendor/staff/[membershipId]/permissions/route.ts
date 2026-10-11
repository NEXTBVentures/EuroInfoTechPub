import { NextResponse } from "next/server";
import { vendorStaffPermissionSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { enforceRecentAuthentication, requireIdentity } from "../../../../../../../lib/identity-api";
import { hasVendorPermission } from "../../../../../../../lib/identity-context";
import { writeVendorAudit } from "../../../../../../../lib/vendor-service";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ membershipId: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const parsed = vendorStaffPermissionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const { membershipId } = await context.params;
  const { vendorId, permissionKeys, password, code } = parsed.data;
  if (!hasVendorPermission(guard.identity, vendorId, "vendor.staff.manage")) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }
  const denied = await enforceRecentAuthentication(request, guard.identity, password, code);
  if (denied) return denied;
  const member = await prisma.organizationMembership.findFirst({
    where: { id: membershipId, organizationId: guard.identity.tenant.id, assignments: { some: { roleKey: "VENDOR_STAFF", vendorId } } },
    select: { id: true, userId: true },
  });
  if (!member) return NextResponse.json({ error: "vendor_staff_not_found" }, { status: 404 });
  await prisma.$transaction(async (tx) => {
    await tx.vendorStaffPermission.deleteMany({
      where: { organizationId: guard.identity.tenant.id, vendorId, membershipId, permissionKey: "vendor.bank.manage" },
    });
    if (permissionKeys.length) {
      await tx.vendorStaffPermission.createMany({
        data: permissionKeys.map((permissionKey) => ({
          organizationId: guard.identity.tenant.id,
          vendorId,
          membershipId,
          permissionKey,
          grantedByMembershipId: guard.identity.membership.id,
        })),
        skipDuplicates: true,
      });
    }
    await tx.session.deleteMany({ where: { userId: member.userId } });
    await writeVendorAudit(tx, {
      organizationId: guard.identity.tenant.id,
      vendorId,
      actorUserId: guard.identity.user.id,
      action: "staff.permissions_updated",
      targetId: membershipId,
      metadata: { permissionKeys },
    });
  });
  return NextResponse.json({ success: true, permissionKeys });
}
