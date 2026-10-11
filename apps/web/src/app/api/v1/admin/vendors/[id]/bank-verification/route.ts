import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { vendorBankVerificationSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { requireVendorAdminPermission } from "../../../../../../../lib/vendor-auth";
import { enforceRecentAuthentication } from "../../../../../../../lib/identity-api";
import { writeVendorAudit } from "../../../../../../../lib/vendor-service";
import { maskBankProfile } from "../../../../../../../lib/vendor-security";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const guard = await requireVendorAdminPermission(request, "admin.vendor_bank.verify");
  if (guard.response || !guard.identity) return guard.response!;
  const parsed = vendorBankVerificationSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const denied = await enforceRecentAuthentication(request, guard.identity, parsed.data.password, parsed.data.code);
  if (denied) return denied;

  const { id: applicationId } = await context.params;
  const application = await prisma.vendorApplication.findFirst({
    where: { id: applicationId, organizationId: guard.identity.tenant.id },
    select: { id: true, vendorId: true },
  });
  if (!application) return NextResponse.json({ error: "application_not_found" }, { status: 404 });
  const profile = await prisma.vendorBankProfile.findUnique({
    where: { vendorId_organizationId: { vendorId: application.vendorId, organizationId: guard.identity.tenant.id } },
    select: { lastFour: true },
  });
  if (!profile) return NextResponse.json({ error: "bank_profile_not_found" }, { status: 404 });

  const verifiedAt = parsed.data.status === "VERIFIED" ? new Date() : null;
  await prisma.$transaction(async (tx) => {
    await tx.vendorBankProfile.update({
      where: { vendorId_organizationId: { vendorId: application.vendorId, organizationId: guard.identity.tenant.id } },
      data: {
        verificationStatus: parsed.data.status,
        verifiedAt,
        verifiedByUserId: verifiedAt ? guard.identity.user.id : null,
      },
    });
    await writeVendorAudit(tx, {
      organizationId: guard.identity.tenant.id,
      vendorId: application.vendorId,
      actorUserId: guard.identity.user.id,
      action: `bank_profile.${parsed.data.status.toLowerCase()}`,
      targetId: application.id,
      requestId: request.headers.get("x-request-id"),
      metadata: { verificationStatus: parsed.data.status, lastFour: profile.lastFour, reason: parsed.data.reason },
    });
    await tx.outboxEvent.create({
      data: {
        organizationId: guard.identity.tenant.id,
        dedupeKey: `vendor.bank-profile.decision:${application.vendorId}:${randomUUID()}`,
        eventType: "vendor.bank-profile.updated",
        payload: { vendorId: application.vendorId, verificationStatus: parsed.data.status },
      },
    });
  });

  return NextResponse.json({
    applicationId,
    ...maskBankProfile(profile.lastFour, parsed.data.status),
  }, { headers: { "Cache-Control": "no-store" } });
}
