import "server-only";
import { prisma } from "@workspace/database";

export type AuthAuditType =
  | "AUTH_LOGIN_SUCCESS"
  | "AUTH_LOGIN_FAILURE"
  | "AUTH_SIGN_UP_SUCCESS"
  | "AUTH_SIGN_UP_FAILURE"
  | "AUTH_VERIFICATION_SUCCESS"
  | "AUTH_PASSWORD_RESET_REQUEST"
  | "AUTH_PASSWORD_CHANGE"
  | "SESSION_REVOKED"
  | "ROLE_CHANGED"
  | "PERMISSION_CHANGED"
  | "TOTP_ENROLMENT_STARTED"
  | "TOTP_ENROLMENT_COMPLETED"
  | "TOTP_VERIFICATION_SUCCESS"
  | "TOTP_VERIFICATION_FAILURE"
  | "TOTP_RECOVERY_CODE_USED"
  | "TOTP_REMOVED";

export async function recordAuthAudit(input: {
  eventType: AuthAuditType;
  organizationId?: string | null;
  actorUserId?: string | null;
  targetUserId?: string | null;
  requestId?: string | null;
}): Promise<void> {
  await prisma.authAuditEvent.create({
    data: {
      eventType: input.eventType,
      organizationId: input.organizationId ?? null,
      actorUserId: input.actorUserId ?? null,
      targetUserId: input.targetUserId ?? null,
      requestId: input.requestId && /^[0-9a-f-]{36}$/i.test(input.requestId) ? input.requestId : null,
    },
  });
}
