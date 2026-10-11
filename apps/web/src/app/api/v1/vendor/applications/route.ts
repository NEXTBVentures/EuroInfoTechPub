import { NextResponse } from "next/server";
import { vendorApplicationCreateSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { requireIdentity } from "../../../../../lib/identity-api";
import {
  profilePatchToVendorData,
  vendorApplicationInclude,
  vendorApplicationResponse,
  writeVendorAudit,
} from "../../../../../lib/vendor-service";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const application = await prisma.vendorApplication.findFirst({
    where: {
      organizationId: guard.identity.tenant.id,
      applicantMembershipId: guard.identity.membership.id,
    },
    include: vendorApplicationInclude,
    orderBy: { updatedAt: "desc" },
  });
  return NextResponse.json({
    application: application ? vendorApplicationResponse(application) : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  if (!guard.identity.hasPermission("vendor.application.create")) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }
  const body = await request.json().catch(() => ({}));
  const parsed = vendorApplicationCreateSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "OrganizationMembership" WHERE "id" = ${guard.identity.membership.id}::uuid FOR UPDATE`;
      const existing = await tx.vendorApplication.findFirst({
    where: {
      organizationId: guard.identity.tenant.id,
      applicantMembershipId: guard.identity.membership.id,
      status: { in: ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "CHANGES_REQUIRED", "APPROVED", "SUSPENDED"] },
    },
    include: vendorApplicationInclude,
    orderBy: { updatedAt: "desc" },
  });
      if (existing) return { application: existing, created: false };
      const vendor = await tx.vendor.create({
        data: {
          organizationId: guard.identity.tenant.id,
          ...profilePatchToVendorData(parsed.data.profile),
        },
      });
      const created = await tx.vendorApplication.create({
        data: {
          organizationId: guard.identity.tenant.id,
          vendorId: vendor.id,
          applicantMembershipId: guard.identity.membership.id,
        },
        include: vendorApplicationInclude,
      });
      await writeVendorAudit(tx as typeof prisma, {
        organizationId: guard.identity.tenant.id,
        vendorId: vendor.id,
        actorUserId: guard.identity.user.id,
        action: "application.draft_created",
        targetId: created.id,
      });
      return { application: created, created: true };
    });
    return NextResponse.json({ application: vendorApplicationResponse(result.application) }, { status: result.created ? 201 : 200 });
  } catch {
    return NextResponse.json({ error: "vendor_application_unavailable" }, { status: 503 });
  }
}
