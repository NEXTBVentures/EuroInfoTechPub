import { NextResponse } from "next/server";
import { toNextJsHandler } from "better-auth/next-js";
import { auth } from "../../../../lib/auth";
import { recordAuthAudit, type AuthAuditType } from "../../../../lib/auth-audit";
import { createCustomerMembership, resolveTenant } from "../../../../lib/tenant";
import { prisma } from "@workspace/database";
import { emailLoginSchema, registrationSchema, phoneOtpVerificationSchema } from "@workspace/contracts";
import { stateChangingOriginIsValid } from "../../../../lib/identity-api";
import { assertAuthDeliveryAvailable } from "../../../../lib/auth-delivery";
import { allowSecurityAttempt } from "../../../../lib/security-rate-limit";
import { getAuthSecret } from "../../../../lib/totp";
import { createHmac } from "node:crypto";

const handlers = toNextJsHandler(auth);

function classifyAuthEvent(path: string, status: number): AuthAuditType | null {
  const success = status < 400;
  if (path.endsWith("/sign-in/email") || path.endsWith("/phone-number/verify")) {
    return success ? "AUTH_LOGIN_SUCCESS" : "AUTH_LOGIN_FAILURE";
  }
  if (path.endsWith("/sign-up/email")) {
    return success ? "AUTH_SIGN_UP_SUCCESS" : "AUTH_SIGN_UP_FAILURE";
  }
  if (path.endsWith("/verify-email")) return success ? "AUTH_VERIFICATION_SUCCESS" : null;
  if (path.endsWith("/request-password-reset")) return "AUTH_PASSWORD_RESET_REQUEST";
  if (path.endsWith("/reset-password")) return success ? "AUTH_PASSWORD_CHANGE" : null;
  if (path.endsWith("/sign-out")) return success ? "SESSION_REVOKED" : null;
  return null;
}

async function responseUserId(response: Response): Promise<string | null> {
  try {
    const body = await response.clone().json() as { user?: { id?: unknown } };
    return typeof body.user?.id === "string" ? body.user.id : null;
  } catch {
    return null;
  }
}

async function handle(request: Request, handler: (request: Request) => Promise<Response>): Promise<Response> {
  const tenant = await resolveTenant(request.headers.get("host"));
  if (!tenant) {
    return NextResponse.json({ error: "unknown_application_domain" }, { status: 404 });
  }
  if (!tenant.identityEnabled) {
    return NextResponse.json({ error: "identity_module_unavailable" }, { status: 403 });
  }

  const path = new URL(request.url).pathname;
  const endpoint = path.replace(/^\/api\/auth/, "");
  const organizationId = tenant.id;
  async function reject(status: number, error: string) {
    const eventType = classifyAuthEvent(path, status);
    if (eventType) await recordAuthAudit({
      eventType, organizationId, requestId: request.headers.get("x-request-id"),
    });
    return NextResponse.json({ error }, { status });
  }
  const allowedPostEndpoints = [
    "/sign-up/email", "/sign-in/email", "/sign-out", "/phone-number/verify",
    "/send-verification-email", "/request-password-reset", "/reset-password",
  ];
  if (request.method === "POST") {
    if (!stateChangingOriginIsValid(request)) {
      return reject(403, "invalid_request_origin");
    }
    if (!allowedPostEndpoints.includes(endpoint)) {
      return reject(404, "endpoint_not_available");
    }
    const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const requestKey = createHmac("sha256", getAuthSecret()).update(`${tenant.id}:${endpoint}:${ip}`).digest("hex");
    if (endpoint !== "/sign-out" && !await allowSecurityAttempt(`m02:auth:${requestKey}`, 5, 60)) {
      return reject(429, "too_many_authentication_attempts");
    }
    const schema = endpoint === "/sign-up/email" ? registrationSchema :
      endpoint === "/sign-in/email" ? emailLoginSchema :
      endpoint === "/phone-number/verify" ? phoneOtpVerificationSchema : null;
    if (schema && !schema.safeParse(await request.clone().json().catch(() => null)).success) {
      return reject(400, "invalid_request");
    }
    if (["/sign-up/email", "/request-password-reset", "/send-verification-email"].includes(endpoint)) {
      try { assertAuthDeliveryAvailable(); } catch {
        return reject(503, "authentication_delivery_provider_disabled");
      }
    }
  }
  const currentUserId = endpoint === "/sign-out"
    ? (await auth.api.getSession({ headers: request.headers }))?.user.id ?? null : null;
  let response: Response;
  try {
    response = await handler(request);
  } catch {
    const isLogin = path.endsWith("/sign-in/email") || path.endsWith("/phone-number/verify");
    const isSignup = path.endsWith("/sign-up/email");
    if (isLogin || isSignup) {
      await recordAuthAudit({
        eventType: isLogin ? "AUTH_LOGIN_FAILURE" : "AUTH_SIGN_UP_FAILURE",
        organizationId: tenant.id,
        requestId: request.headers.get("x-request-id"),
      });
    }
    return NextResponse.json({ error: "authentication_request_failed" }, { status: 500 });
  }

  const userId = await responseUserId(response);
  if (path.endsWith("/sign-up/email") && response.status < 400 && userId) {
    try {
      // Better Auth deliberately returns synthetic users on duplicate registration.
      // Never create memberships for those responses or reactivate suspended memberships.
      const persisted = await prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
      if (persisted) await createCustomerMembership(tenant.id, userId);
    } catch {
      return NextResponse.json({ error: "registration_unavailable" }, { status: 503 });
    }
  }

  const eventType = classifyAuthEvent(path, response.status);
  if (eventType) {
    await recordAuthAudit({
      eventType,
      organizationId: tenant.id,
      actorUserId: userId ?? currentUserId,
      requestId: request.headers.get("x-request-id"),
    });
  }
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export async function GET(request: Request): Promise<Response> {
  return handle(request, handlers.GET);
}

export async function POST(request: Request): Promise<Response> {
  return handle(request, handlers.POST);
}
