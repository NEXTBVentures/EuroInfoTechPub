import { NextResponse } from "next/server";
import { prisma } from "@workspace/database";
import { requireVendorAdminPermission } from "../../../../../../lib/vendor-auth";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const guard = await requireVendorAdminPermission(request, "admin.vendors.view");
  if (guard.response || !guard.identity) return guard.response!;
  const { id } = await context.params;
  const application = await prisma.vendorApplication.findFirst({
    where: { id, organizationId: guard.identity.tenant.id },
    include: {
      vendor: true,
      applicantMembership: { select: { userId: true, user: { select: { id: true, name: true, email: true } } } },
      documents: { orderBy: { uploadedAt: "desc" } },
      submissions: { orderBy: { revision: "desc" } },
      decisions: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!application) return NextResponse.json({ error: "application_not_found" }, { status: 404 });
  const bankProfile = guard.identity.hasPermission("admin.vendor_bank.verify")
    ? await prisma.vendorBankProfile.findUnique({
      where: { vendorId_organizationId: { vendorId: application.vendorId, organizationId: guard.identity.tenant.id } },
      select: { lastFour: true, verificationStatus: true, updatedAt: true },
    })
    : null;
  const { applicantMembership, submissions, decisions, documents, vendor, ...applicationFields } = application;
  return NextResponse.json({
    application: {
      ...applicationFields,
      applicant: applicantMembership.user,
      vendor: {
        id: vendor.id,
        status: vendor.status,
        profile: {
          legalName: vendor.legalName,
          storeName: vendor.storeName,
          entityType: vendor.entityType,
          registeredAddress: vendor.registeredAddress,
          operationalAddress: vendor.operationalAddress,
          contactEmail: vendor.contactEmail,
          contactPhone: vendor.contactPhone,
          taxIdentifiers: vendor.taxIdentifiers,
          businessIdentifiers: vendor.businessIdentifiers,
          contactPersonName: vendor.contactPersonName,
          description: vendor.description,
          supportEmail: vendor.supportEmail,
          supportPhone: vendor.supportPhone,
          shippingOrigins: vendor.shippingOrigins,
        },
      },
      documents: documents.map((document) => Object.fromEntries(
        Object.entries(document).filter(([key]) => key !== "storageKey" && key !== "sha256"),
      )),
      submissions,
      decisions,
      bankProfile: bankProfile ? {
        accountNumber: `•••• ${bankProfile.lastFour}`,
        verificationStatus: bankProfile.verificationStatus,
        updatedAt: bankProfile.updatedAt,
      } : null,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
