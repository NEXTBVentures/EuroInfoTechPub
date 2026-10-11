import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { detectVendorDocumentType } from "@workspace/core";
import { vendorDocumentCategorySchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { hasVendorPermission } from "../../../../../lib/identity-context";
import { requireIdentity } from "../../../../../lib/identity-api";
import { getVendorOnboardingRules, writeVendorAudit } from "../../../../../lib/vendor-service";
import {
  newVendorDocumentStorageKey,
  removeVendorDocument,
  safeVendorFilename,
  storeVendorDocument,
} from "../../../../../lib/vendor-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

export async function POST(request: Request): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > MAX_UPLOAD_BYTES + 64 * 1024) {
    return NextResponse.json({ error: "document_too_large" }, { status: 413 });
  }
  const form = await request.formData().catch(() => null);
  if (!form) return NextResponse.json({ error: "invalid_multipart_request" }, { status: 400 });
  const applicationId = form.get("applicationId");
  const category = vendorDocumentCategorySchema.safeParse(form.get("category"));
  const file = form.get("file");
  if (typeof applicationId !== "string" || !category.success || !(file instanceof File)) {
    return NextResponse.json({ error: "invalid_document_request" }, { status: 400 });
  }
  if (file.size < 1 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "document_too_large" }, { status: 413 });
  }
  const application = await prisma.vendorApplication.findFirst({
    where: { id: applicationId, organizationId: guard.identity.tenant.id },
    include: { vendor: true },
  });
  if (!application) return NextResponse.json({ error: "application_not_found" }, { status: 404 });
  const isApplicant = application.applicantMembershipId === guard.identity.membership.id &&
    ["DRAFT", "CHANGES_REQUIRED"].includes(application.status);
  const isVendorOwner = hasVendorPermission(
    guard.identity,
    application.vendorId,
    "vendor.kyc.upload",
  );
  if (!isApplicant && !isVendorOwner) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }
  if (isApplicant && !guard.identity.hasPermission("vendor.kyc.upload")) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }
  const rules = await getVendorOnboardingRules(guard.identity.tenant.id);
  if (file.size > rules.maxDocumentBytes) {
    return NextResponse.json({ error: "document_too_large", maxBytes: rules.maxDocumentBytes }, { status: 413 });
  }
  if (!rules.allowedMediaTypes.includes(file.type as (typeof rules.allowedMediaTypes)[number])) {
    return NextResponse.json({ error: "document_type_not_allowed" }, { status: 415 });
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  const detected = detectVendorDocumentType(bytes);
  if (!detected || detected.mediaType !== file.type) {
    return NextResponse.json({ error: "document_content_type_mismatch" }, { status: 415 });
  }
  const storageKey = newVendorDocumentStorageKey(detected.extension);
  try {
    await storeVendorDocument(storageKey, bytes);
    const created = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VendorApplication" WHERE "id" = ${applicationId}::uuid AND "organizationId" = ${guard.identity.tenant.id}::uuid FOR UPDATE`;
      const current = await tx.vendorApplication.findUniqueOrThrow({
        where: { id: applicationId }, include: { vendor: { select: { status: true } } },
      });
      const stillApplicant = current.applicantMembershipId === guard.identity.membership.id &&
        ["DRAFT", "CHANGES_REQUIRED"].includes(current.status);
      if (!stillApplicant && !(isVendorOwner && current.vendor.status === "ACTIVE")) {
        throw new Error("application_state_changed");
      }
      const previous = await tx.vendorDocument.findFirst({
        where: {
          organizationId: guard.identity.tenant.id,
          applicationId,
          category: category.data,
          active: true,
        },
        orderBy: { uploadedAt: "desc" },
      });
      if (previous) {
        await tx.vendorDocument.update({
          where: { id: previous.id },
          data: { active: false, replacedAt: new Date() },
        });
      }
      const document = await tx.vendorDocument.create({
        data: {
          organizationId: guard.identity.tenant.id,
          vendorId: application.vendorId,
          applicationId,
          category: category.data,
          storageKey,
          originalFilename: safeVendorFilename(file.name),
          mediaType: detected.mediaType,
          sizeBytes: file.size,
          sha256: createHash("sha256").update(bytes).digest("hex"),
          uploadedByUserId: guard.identity.user.id,
          supersedesId: previous?.id,
        },
        select: { id: true, category: true, originalFilename: true, mediaType: true, sizeBytes: true },
      });
      await writeVendorAudit(tx, {
        organizationId: guard.identity.tenant.id,
        vendorId: application.vendorId,
        actorUserId: guard.identity.user.id,
        action: previous ? "document.replaced" : "document.uploaded",
        targetId: document.id,
        requestId: request.headers.get("x-request-id"),
        metadata: { category: document.category, mediaType: document.mediaType, sizeBytes: document.sizeBytes },
      });
      return document;
    });
    return NextResponse.json({ document: created }, { status: 201 });
  } catch {
    await removeVendorDocument(storageKey);
    return NextResponse.json({ error: "private_document_storage_unavailable" }, { status: 503 });
  }
}
