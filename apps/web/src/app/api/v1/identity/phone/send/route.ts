import { NextResponse } from "next/server";
import { phoneOtpRequestSchema } from "@workspace/contracts";
import { resolveTenant } from "../../../../../../lib/tenant";
import { sendProtectedPhoneOtp } from "../../../../../../lib/phone-otp";
import { requireIdentity, enforceRecentAuthentication, stateChangingOriginIsValid } from "../../../../../../lib/identity-api";

export async function POST(request: Request): Promise<Response> {
  if (!stateChangingOriginIsValid(request)) {
    return NextResponse.json({ error: "invalid_request_origin" }, { status: 403 });
  }
  const tenant = await resolveTenant(request.headers.get("host"));
  if (!tenant) return NextResponse.json({ error: "unknown_application_domain" }, { status: 404 });
  if (!tenant.identityEnabled) return NextResponse.json({ error: "identity_module_unavailable" }, { status: 403 });
  const input = phoneOtpRequestSchema.safeParse(await request.json().catch(() => null));
  if (!input.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  let userId: string | undefined;
  if (input.data.purpose === "LINK") {
    const guard = await requireIdentity(request);
    if (guard.response) return guard.response;
    if (!input.data.password) return NextResponse.json({ error: "password_required" }, { status: 400 });
    const denied = await enforceRecentAuthentication(request, guard.identity, input.data.password, input.data.code);
    if (denied) return denied;
    userId = guard.identity.user.id;
  }
  try {
    const result = await sendProtectedPhoneOtp(tenant.id, input.data.phoneNumber, input.data.purpose, userId);
    if (result === "limited") return NextResponse.json({ error: "too_many_attempts" }, { status: 429 });
    return NextResponse.json({ success: true, message: "If this number is eligible, use the code to continue." });
  } catch {
    return NextResponse.json({ error: "authentication_delivery_provider_disabled" }, { status: 503 });
  }
}
