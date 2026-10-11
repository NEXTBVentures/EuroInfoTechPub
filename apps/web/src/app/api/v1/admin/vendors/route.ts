import { NextResponse } from "next/server";
import { vendorApplicationStatuses } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { requireVendorAdminPermission } from "../../../../../lib/vendor-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireVendorAdminPermission(request, "admin.vendors.view");
  if (guard.response || !guard.identity) return guard.response!;
  const status = new URL(request.url).searchParams.get("status");
  if (status && status !== "ALL" && !vendorApplicationStatuses.includes(status as (typeof vendorApplicationStatuses)[number])) {
    return NextResponse.json({ error: "invalid_status_filter" }, { status: 400 });
  }
  const applications = await prisma.vendorApplication.findMany({
    where: {
      organizationId: guard.identity.tenant.id,
      ...(status && status !== "ALL" ? { status: status as (typeof vendorApplicationStatuses)[number] } : {}),
    },
    include: {
      vendor: { select: { id: true, legalName: true, storeName: true, entityType: true, contactEmail: true, contactPhone: true } },
      applicantMembership: { select: { user: { select: { id: true, name: true, email: true } } } },
      documents: { where: { active: true }, select: { id: true } },
      submissions: { orderBy: { revision: "desc" }, take: 1, select: { revision: true, submittedAt: true } },
    },
    orderBy: { updatedAt: "desc" },
    take: 100,
  });
  return NextResponse.json({
    applications: applications.map((application) => ({
      id: application.id,
      status: application.status,
      createdAt: application.createdAt,
      submittedAt: application.submittedAt,
      vendor: application.vendor,
      applicant: application.applicantMembership.user,
      activeDocumentCount: application.documents.length,
      latestRevision: application.submissions[0]?.revision ?? 0,
    })),
  }, { headers: { "Cache-Control": "no-store" } });
}
