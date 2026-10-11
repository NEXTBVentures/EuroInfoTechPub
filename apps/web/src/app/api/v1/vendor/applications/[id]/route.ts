import { NextResponse } from "next/server";
import { vendorApplicationUpdateSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { requireIdentity } from "../../../../../../lib/identity-api";
import { hasVendorPermission } from "../../../../../../lib/identity-context";
import {
  profilePatchToVendorData,
  vendorApplicationInclude,
  vendorApplicationResponse,
  writeVendorAudit,
} from "../../../../../../lib/vendor-service";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ id: string }> };

export async function PATCH(request: Request, context: RouteContext): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const { id } = await context.params;
  const parsed = vendorApplicationUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const application = await prisma.vendorApplication.findFirst({
    where: {
      id,
      organizationId: guard.identity.tenant.id,
      applicantMembershipId: guard.identity.membership.id,
    },
    include: { vendor: true },
  });
  if (!application) return NextResponse.json({ error: "application_not_editable" }, { status: 404 });
  const approved = application.status === "APPROVED";
  if (approved && !hasVendorPermission(guard.identity, application.vendorId, "vendor.profile.manage")) {
    return NextResponse.json({ error: "access_denied" }, { status: 403 });
  }
  if (!approved && !["DRAFT", "CHANGES_REQUIRED"].includes(application.status)) {
    return NextResponse.json({ error: "application_not_editable" }, { status: 409 });
  }
  const profile = parsed.data.profile as Record<string, unknown>;
  const storeFields = ["storeName", "description", "supportEmail", "supportPhone", "operationalAddress", "shippingOrigins"];
  const nextProfile = approved
    ? Object.fromEntries(storeFields.filter((key) => Object.hasOwn(profile, key)).map((key) => [key, profile[key]]))
    : { ...profile };
  if (!approved && typeof nextProfile.contactEmail === "string") {
    nextProfile.contactEmail = nextProfile.contactEmail.toLowerCase();
  }
  try {
  const updated = await prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "VendorApplication" WHERE "id" = ${id}::uuid AND "organizationId" = ${guard.identity.tenant.id}::uuid FOR UPDATE`;
    const current = await tx.vendorApplication.findUniqueOrThrow({ where: { id } });
    if (current.status !== application.status) throw new Error("application_state_changed");
    await tx.vendor.update({
      where: { id_organizationId: { id: application.vendorId, organizationId: guard.identity.tenant.id } },
      data: profilePatchToVendorData(nextProfile),
    });
    await writeVendorAudit(tx as typeof prisma, {
      organizationId: guard.identity.tenant.id,
      vendorId: application.vendorId,
      actorUserId: guard.identity.user.id,
      action: approved ? "store.profile_updated" : "application.profile_updated",
      targetId: application.id,
      metadata: { fields: Object.keys(nextProfile).sort() },
    });
    return tx.vendorApplication.findUniqueOrThrow({
      where: { id },
      include: vendorApplicationInclude,
    });
  });
  return NextResponse.json({ application: vendorApplicationResponse(updated) });
  } catch {
    return NextResponse.json({ error: "application_not_editable" }, { status: 409 });
  }
}
