import { NextResponse } from "next/server";
import { prisma } from "@workspace/database";
import { vendorProfileSchema } from "@workspace/contracts";
import { missingVendorApplicationRequirements } from "@workspace/core";
import { requireIdentity } from "../../../../../../../lib/identity-api";
import { getVendorOnboardingRules, profileFromVendor, writeVendorAudit } from "../../../../../../../lib/vendor-service";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const { id } = await context.params;
  try {
  const result = await prisma.$transaction(async (tx) => {
  await tx.$queryRaw`SELECT "id" FROM "VendorApplication" WHERE "id" = ${id}::uuid AND "organizationId" = ${guard.identity.tenant.id}::uuid FOR UPDATE`;
  const application = await tx.vendorApplication.findFirst({
    where: {
      id,
      organizationId: guard.identity.tenant.id,
      applicantMembershipId: guard.identity.membership.id,
    },
    include: {
      vendor: true,
      documents: { where: { active: true }, select: { id: true, category: true } },
    },
  });
  if (!application) return NextResponse.json({ error: "application_not_submittable" }, { status: 404 });
  if (application.status === "SUBMITTED") {
    const previous = await tx.vendorSubmission.findFirst({
      where: { applicationId: id }, orderBy: { revision: "desc" },
    });
    if (previous) return NextResponse.json({
      status: "SUBMITTED", revision: previous.revision, submittedAt: previous.submittedAt,
    });
  }
  if (!["DRAFT", "CHANGES_REQUIRED"].includes(application.status)) {
    return NextResponse.json({ error: "application_not_submittable" }, { status: 409 });
  }
  if (!guard.identity.user.emailVerified || application.vendor.contactEmail !== guard.identity.user.email.toLowerCase()) {
    return NextResponse.json({ error: "verified_account_email_must_match_contact_email" }, { status: 400 });
  }
  if (application.vendor.contactPhone &&
    (!guard.identity.user.phoneNumberVerified || application.vendor.contactPhone !== guard.identity.user.phoneNumber)) {
    return NextResponse.json({ error: "verified_account_phone_must_match_contact_phone" }, { status: 400 });
  }
  const rules = await getVendorOnboardingRules(guard.identity.tenant.id);
  const profile = profileFromVendor(application.vendor) as Record<string, unknown>;
  const missing = missingVendorApplicationRequirements(
    profile,
    rules.requiredFields,
    rules.requiredDocumentCategories,
    application.documents.map(({ category }) => category),
  );
  const validProfile = vendorProfileSchema.safeParse(profile);
  if (validProfile.success === false) {
    missing.push(...validProfile.error.issues.map((issue) => issue.path.join(".")));
  }
  if (missing.length) return NextResponse.json({ error: "application_incomplete", missing }, { status: 422 });
    const revision = await tx.vendorSubmission.count({ where: { applicationId: application.id } }) + 1;
    const documentIds = application.documents.map(({ id: documentId }) => documentId);
    await tx.vendorSubmission.create({
      data: {
        organizationId: guard.identity.tenant.id,
        applicationId: application.id,
        revision,
        profileSnapshot: profile as never,
        documentIds,
        submittedByUserId: guard.identity.user.id,
      },
    });
    const submittedAt = new Date();
    await tx.vendorApplication.update({
      where: { id: application.id },
      data: { status: "SUBMITTED", submittedAt },
    });
    await writeVendorAudit(tx as typeof prisma, {
      organizationId: guard.identity.tenant.id,
      vendorId: application.vendorId,
      actorUserId: guard.identity.user.id,
      action: "application.submitted",
      targetId: application.id,
      metadata: { revision },
    });
    await tx.outboxEvent.create({
      data: {
        organizationId: guard.identity.tenant.id,
        dedupeKey: `vendor.application.submitted:${application.id}:${revision}`,
        eventType: "vendor.application.submitted",
        payload: { applicationId: application.id, vendorId: application.vendorId, status: "SUBMITTED", revision },
      },
    });
    return NextResponse.json({ status: "SUBMITTED", revision, submittedAt });
  });
  return result;
  } catch {
    return NextResponse.json({ error: "vendor_submission_unavailable" }, { status: 503 });
  }
}
