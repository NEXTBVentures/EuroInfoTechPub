import { createHash, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";
import { vendorStaffInviteSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { auth } from "../../../../../lib/auth";
import { requireIdentity, enforceRecentAuthentication, stateChangingOriginIsValid } from "../../../../../lib/identity-api";
import { hasVendorPermission } from "../../../../../lib/identity-context";
import { writeVendorAudit } from "../../../../../lib/vendor-service";
import { resolveTenantFromRequest } from "../../../../../lib/tenant";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const vendorId = new URL(request.url).searchParams.get("vendorId");
  if (!vendorId || !hasVendorPermission(guard.identity, vendorId, "vendor.staff.manage")) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }
  const members = await prisma.organizationMembership.findMany({
    where: {
      organizationId: guard.identity.tenant.id,
      status: "ACTIVE",
      assignments: { some: { vendorId, roleKey: "VENDOR_STAFF" } },
    },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  const [grants, invitations] = await Promise.all([
    prisma.vendorStaffPermission.findMany({
      where: { organizationId: guard.identity.tenant.id, vendorId },
      select: { membershipId: true, permissionKey: true },
    }),
    prisma.vendorStaffInvitation.findMany({
      where: { organizationId: guard.identity.tenant.id, vendorId, acceptedAt: null, revokedAt: null, expiresAt: { gt: new Date() } },
      select: { id: true, email: true, phone: true, permissionKeys: true, expiresAt: true },
      orderBy: { createdAt: "desc" },
    }),
  ]);
  return NextResponse.json({
    staff: members.map((member) => ({
      membershipId: member.id,
      name: member.user.name,
      email: member.user.email,
      permissionKeys: grants.filter((grant) => grant.membershipId === member.id).map((grant) => grant.permissionKey),
    })),
    invitations,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const parsed = vendorStaffInviteSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const { vendorId, email, phone, permissionKeys, password, code } = parsed.data;
  if (!hasVendorPermission(guard.identity, vendorId, "vendor.staff.manage")) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }
  const denied = await enforceRecentAuthentication(request, guard.identity, password, code);
  if (denied) return denied;
  const token = randomBytes(32).toString("base64url");
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const expiresAt = new Date(Date.now() + 72 * 60 * 60 * 1000);
  try {
    const invitation = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "Vendor" WHERE "id" = ${vendorId}::uuid AND "organizationId" = ${guard.identity.tenant.id}::uuid FOR UPDATE`;
      const vendor = await tx.vendor.findFirst({
        where: { id: vendorId, organizationId: guard.identity.tenant.id, status: "ACTIVE" },
        select: { id: true },
      });
      if (!vendor) return null;
      await tx.vendorStaffInvitation.updateMany({
        where: {
          organizationId: guard.identity.tenant.id,
          vendorId,
          acceptedAt: null,
          revokedAt: null,
          ...(email ? { email } : { phone }),
        },
        data: { revokedAt: new Date() },
      });
      const created = await tx.vendorStaffInvitation.create({
        data: {
          organizationId: guard.identity.tenant.id,
          vendorId,
          invitedByMembershipId: guard.identity.membership.id,
          email,
          phone,
          tokenHash,
          permissionKeys,
          expiresAt,
        },
      });
      await writeVendorAudit(tx, {
        organizationId: guard.identity.tenant.id,
        vendorId,
        actorUserId: guard.identity.user.id,
        action: "staff.invited",
        targetId: created.id,
        requestId: request.headers.get("x-request-id"),
        metadata: { contactChannel: email ? "email" : "phone", permissions: permissionKeys },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: guard.identity.tenant.id,
          dedupeKey: `vendor.staff.invited:${created.id}`,
          eventType: "vendor.staff.invited",
          payload: { vendorId, invitationId: created.id },
        },
      });
      return created;
    });
    if (!invitation) return NextResponse.json({ error: "vendor_not_active" }, { status: 409 });
    const link = new URL(`/vendor/invitations/${token}`, request.url).toString();
    return NextResponse.json({
      invitation: { id: invitation.id, email, phone, expiresAt, link },
      delivery: "Copy this one-time link to share it. Email and SMS delivery are not configured.",
    }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "vendor_invite_unavailable" }, { status: 503 });
  }
}

export async function PUT(request: Request): Promise<Response> {
  if (!stateChangingOriginIsValid(request)) {
    return NextResponse.json({ error: "invalid_request_origin" }, { status: 403 });
  }
  const body = await request.json().catch(() => null);
  const token = typeof body?.token === "string" ? body.token : "";
  if (token.length < 32 || token.length > 256) {
    return NextResponse.json({ error: "invalid_invitation" }, { status: 400 });
  }
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session) return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  const tenant = await resolveTenantFromRequest(request.headers);
  if (!tenant?.identityEnabled) return NextResponse.json({ error: "access_denied" }, { status: 403 });
  const user = session.user;
  const tokenHash = createHash("sha256").update(token).digest("hex");
  const result = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "VendorStaffInvitation" WHERE "tokenHash" = ${tokenHash} AND "organizationId" = ${tenant.id}::uuid FOR UPDATE`;
    const invite = await tx.vendorStaffInvitation.findUnique({
      where: { tokenHash },
      include: { invitedByMembership: { select: { userId: true } } },
    });
    if (!invite || invite.organizationId !== tenant.id || invite.acceptedAt || invite.revokedAt || invite.expiresAt <= new Date()) return "invalid";
    const verifiedEmail = invite.email &&
      user.emailVerified &&
      user.email.toLowerCase() === invite.email;
    const verifiedPhone = invite.phone &&
      user.phoneNumberVerified &&
      user.phoneNumber === invite.phone;
    if (!verifiedEmail && !verifiedPhone) return "contact_mismatch";
    const vendor = await tx.vendor.findFirst({
      where: { id: invite.vendorId, organizationId: invite.organizationId, status: "ACTIVE" },
      select: { id: true },
    });
    if (!vendor) return "vendor_inactive";
    let membership = await tx.organizationMembership.findUnique({
      where: { organizationId_userId: { organizationId: invite.organizationId, userId: user.id } },
    });
    if (membership && membership.status !== "ACTIVE") return "membership_inactive";
    if (!membership) {
      membership = await tx.organizationMembership.create({
        data: { organizationId: invite.organizationId, userId: user.id, status: "ACTIVE" },
      });
    }
    const assignment = await tx.roleAssignment.findFirst({
      where: {
        organizationId: invite.organizationId,
        membershipId: membership.id,
        roleKey: "VENDOR_STAFF",
        vendorId: invite.vendorId,
      },
    });
    if (!assignment) {
      await tx.roleAssignment.create({
        data: {
          organizationId: invite.organizationId,
          membershipId: membership.id,
          roleKey: "VENDOR_STAFF",
          vendorId: invite.vendorId,
          vendorApprovedAt: new Date(),
          assignedByUserId: invite.invitedByMembership.userId,
        },
      });
    }
    if (invite.permissionKeys.length) {
      await tx.vendorStaffPermission.createMany({
        data: invite.permissionKeys.map((permissionKey) => ({
          organizationId: invite.organizationId,
          vendorId: invite.vendorId,
          membershipId: membership.id,
          permissionKey,
          grantedByMembershipId: invite.invitedByMembershipId,
        })),
        skipDuplicates: true,
      });
    }
    await tx.vendorStaffInvitation.update({
      where: { id: invite.id },
      data: { acceptedAt: new Date(), acceptedMembershipId: membership.id },
    });
    await writeVendorAudit(tx, {
      organizationId: invite.organizationId,
      vendorId: invite.vendorId,
      actorUserId: user.id,
      action: "staff.invitation_accepted",
      targetId: invite.id,
      metadata: { permissions: invite.permissionKeys },
    });
    await tx.outboxEvent.create({ data: {
      organizationId: invite.organizationId,
      dedupeKey: `vendor.staff.invitation_accepted:${invite.id}`,
      eventType: "vendor.staff.invitation_accepted",
      payload: { vendorId: invite.vendorId, invitationId: invite.id },
    } });
    return "accepted";
  });
  if (result !== "accepted") {
    return NextResponse.json({ error: result }, { status: result === "contact_mismatch" ? 403 : 409 });
  }
  return NextResponse.json({ success: true, message: "Vendor staff access is active." });
}
