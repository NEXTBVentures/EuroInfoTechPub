import { NextResponse } from "next/server";
import { vendorOnboardingRulesSchema, vendorOnboardingRulesUpdateSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { enforceRecentAuthentication } from "../../../../../../lib/identity-api";
import { requireVendorAdminPermission } from "../../../../../../lib/vendor-auth";
import { getVendorOnboardingRules } from "../../../../../../lib/vendor-service";

export const dynamic = "force-dynamic";
const SETTINGS_KEY = "vendors.onboarding.rules";

export async function GET(request: Request): Promise<Response> {
  const guard = await requireVendorAdminPermission(request, "organisation.settings.manage");
  if (guard.response || !guard.identity) return guard.response!;
  return NextResponse.json({ rules: await getVendorOnboardingRules(guard.identity.tenant.id) });
}

export async function PUT(request: Request): Promise<Response> {
  const parsed = vendorOnboardingRulesUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const guard = await requireVendorAdminPermission(request, "organisation.settings.manage");
  if (guard.response || !guard.identity) return guard.response!;
  const denied = await enforceRecentAuthentication(
    request,
    guard.identity,
    parsed.data.password,
    parsed.data.code,
  );
  if (denied) return denied;
  const rules = vendorOnboardingRulesSchema.parse(parsed.data.rules);
  await prisma.organizationSetting.upsert({
    where: {
      organizationId_key: {
        organizationId: guard.identity.tenant.id,
        key: SETTINGS_KEY,
      },
    },
    create: {
      organizationId: guard.identity.tenant.id,
      key: SETTINGS_KEY,
      value: rules as never,
    },
    update: { value: rules as never },
  });
  await prisma.authAuditEvent.create({
    data: {
      eventType: "PERMISSION_CHANGED",
      organizationId: guard.identity.tenant.id,
      actorUserId: guard.identity.user.id,
      targetUserId: guard.identity.user.id,
      metadata: {
        action: "vendor_onboarding_rules_updated",
        requiredFields: rules.requiredFields,
        requiredDocumentCategories: rules.requiredDocumentCategories,
      },
    },
  });
  return NextResponse.json({ rules });
}
