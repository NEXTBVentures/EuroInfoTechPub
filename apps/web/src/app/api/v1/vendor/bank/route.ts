import { randomUUID } from "node:crypto";
import { NextResponse } from "next/server";
import { vendorBankUpdateSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { hasVendorPermission } from "../../../../../lib/identity-context";
import { requireIdentity, enforceRecentAuthentication } from "../../../../../lib/identity-api";
import { writeVendorAudit } from "../../../../../lib/vendor-service";
import { encryptBankProfile, maskBankProfile } from "../../../../../lib/vendor-security";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const ids = guard.identity.assignments
    .filter((assignment) => assignment.vendorId && hasVendorPermission(
      guard.identity,
      assignment.vendorId,
      "vendor.bank.manage",
    ))
    .map((assignment) => assignment.vendorId!)
    .filter((id, index, all) => all.indexOf(id) === index);
  const profiles = ids.length
    ? await prisma.vendorBankProfile.findMany({
      where: { organizationId: guard.identity.tenant.id, vendorId: { in: ids } },
      select: { vendorId: true, lastFour: true, verificationStatus: true, updatedAt: true },
    })
    : [];
  return NextResponse.json({
    profiles: profiles.map((profile) => ({
      vendorId: profile.vendorId,
      ...maskBankProfile(profile.lastFour, profile.verificationStatus),
      updatedAt: profile.updatedAt,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const parsed = vendorBankUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { vendorId, profile, password, code } = parsed.data;
  const hasAccess = hasVendorPermission(guard.identity, vendorId, "vendor.bank.manage");
  if (!hasAccess) return NextResponse.json({ error: "access_denied" }, { status: 403 });
  const denied = await enforceRecentAuthentication(request, guard.identity, password, code);
  if (denied) return denied;
  if (profile.supportingDocumentId) {
    const document = await prisma.vendorDocument.findFirst({
      where: {
        id: profile.supportingDocumentId,
        vendorId,
        organizationId: guard.identity.tenant.id,
        active: true,
      },
      select: { id: true },
    });
    if (!document) return NextResponse.json({ error: "supporting_document_not_found" }, { status: 400 });
  }
  try {
    const encrypted = encryptBankProfile(profile);
    const lastFour = profile.accountNumber.slice(-4);
    await prisma.$transaction(async (tx) => {
      await tx.vendorBankProfile.upsert({
        where: { vendorId_organizationId: { vendorId, organizationId: guard.identity.tenant.id } },
        create: {
          organizationId: guard.identity.tenant.id,
          vendorId,
          ciphertext: encrypted.ciphertext,
          keyVersion: encrypted.keyVersion,
          lastFour,
          supportingDocumentId: profile.supportingDocumentId,
          verificationStatus: "PENDING",
        },
        update: {
          ciphertext: encrypted.ciphertext,
          keyVersion: encrypted.keyVersion,
          lastFour,
          supportingDocumentId: profile.supportingDocumentId,
          verificationStatus: "PENDING",
          verifiedAt: null,
          verifiedByUserId: null,
        },
      });
      await writeVendorAudit(tx, {
        organizationId: guard.identity.tenant.id,
        vendorId,
        actorUserId: guard.identity.user.id,
        action: "bank_profile.updated",
        requestId: request.headers.get("x-request-id"),
        metadata: { lastFour, verificationStatus: "PENDING" },
      });
      await tx.outboxEvent.create({
        data: {
          organizationId: guard.identity.tenant.id,
          dedupeKey: `vendor.bank-profile.updated:${vendorId}:${randomUUID()}`,
          eventType: "vendor.bank-profile.updated",
          payload: { vendorId, verificationStatus: "PENDING" },
        },
      });
    });
    return NextResponse.json({ vendorId, ...maskBankProfile(lastFour, "PENDING") });
  } catch (error) {
    const code = error instanceof Error ? error.message : "";
    return NextResponse.json({
      error: code.includes("vendor_bank_encryption")
        ? "bank_encryption_unavailable"
        : "bank_profile_update_unavailable",
    }, { status: 503 });
  }
}
