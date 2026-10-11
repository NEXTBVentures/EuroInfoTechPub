import { NextResponse } from "next/server";
import { getIdentityContext } from "../../../../../lib/identity-context";

export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  const identity = await getIdentityContext(request.headers);
  if (!identity) {
    return NextResponse.json({ error: "authentication_required" }, { status: 401 });
  }
  return NextResponse.json({
    user: {
      id: identity.user.id,
      name: identity.user.name,
      email: identity.user.email,
      emailVerified: identity.user.emailVerified,
      phoneNumber: identity.user.phoneNumber,
      phoneNumberVerified: identity.user.phoneNumberVerified,
      twoFactorEnabled: identity.user.twoFactorEnabled,
    },
    organization: {
      key: identity.tenant.key,
      displayName: identity.tenant.displayName,
    },
    roles: identity.roleKeys,
    permissions: identity.permissions,
    security: {
      needsAdminTwoFactor: identity.needsAdminTwoFactor,
      hasVerifiedTotp: identity.hasVerifiedTotp,
      mfaFresh: identity.mfaFresh,
    },
  }, { headers: { "Cache-Control": "no-store" } });
}
