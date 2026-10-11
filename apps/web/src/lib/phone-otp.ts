import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { prisma } from "@workspace/database";
import { deliverAuthMessage, assertAuthDeliveryAvailable } from "./auth-delivery";
import { getAuthSecret } from "./totp";
import { allowSecurityAttempt } from "./security-rate-limit";
import { otpVerificationAllowed } from "@workspace/core";

function protectedHash(value: string): string {
  return createHmac("sha256", getAuthSecret()).update(`phone-otp-v1:${value}`).digest("hex");
}

export function phoneChallengeKey(organizationId: string, phone: string): string {
  return protectedHash(`${organizationId}:${phone}`);
}

export async function sendProtectedPhoneOtp(
  organizationId: string,
  phone: string,
  purpose: "LOGIN" | "LINK",
  userId?: string,
): Promise<"sent" | "limited"> {
  assertAuthDeliveryAvailable();
  const phoneKey = phoneChallengeKey(organizationId, phone);
  if (!await allowSecurityAttempt(`otp-send:${phoneKey}:${purpose}`, 3, 900)) return "limited";
  const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
  const codeHash = protectedHash(`${phoneKey}:${purpose}:${code}`);
  const rows = await prisma.$queryRaw<Array<{ id: string }>>`
    INSERT INTO "PhoneOtpChallenge"
      ("id", "organizationId", "phoneKey", "purpose", "userId", "codeHash", "attempts", "expiresAt", "resendAfter")
    VALUES (${randomUUID()}::uuid, ${organizationId}::uuid, ${phoneKey}, ${purpose}, ${userId ?? null},
      ${codeHash}, 0, ${new Date(Date.now() + 300_000)}, ${new Date(Date.now() + 60_000)})
    ON CONFLICT ("organizationId", "phoneKey", "purpose") DO UPDATE
    SET "codeHash" = EXCLUDED."codeHash", "attempts" = 0,
      "expiresAt" = EXCLUDED."expiresAt", "resendAfter" = EXCLUDED."resendAfter", "userId" = EXCLUDED."userId"
    WHERE "PhoneOtpChallenge"."resendAfter" <= NOW()
    RETURNING "id"
  `;
  if (!rows.length) return "limited";
  await deliverAuthMessage("phone-otp", phone, code);
  return "sent";
}

export async function consumeProtectedPhoneOtp(
  organizationId: string,
  phone: string,
  code: string,
  purpose: "LOGIN" | "LINK",
  userId?: string,
): Promise<boolean> {
  if (!/^\d{6}$/.test(code)) return false;
  const phoneKey = phoneChallengeKey(organizationId, phone);
  return prisma.$transaction(async (tx) => {
    const rows = await tx.$queryRaw<Array<{ id: string }>>`
      SELECT "id" FROM "PhoneOtpChallenge"
      WHERE "organizationId" = ${organizationId}::uuid AND "phoneKey" = ${phoneKey} AND "purpose" = ${purpose}
      FOR UPDATE
    `;
    if (!rows[0]) return false;
    const challenge = await tx.phoneOtpChallenge.findUnique({ where: { id: rows[0].id } });
    if (!challenge || !otpVerificationAllowed(challenge.expiresAt.getTime(), challenge.attempts, Date.now()) ||
      (purpose === "LINK" && (!userId || challenge.userId !== userId))) return false;
    await tx.phoneOtpChallenge.update({ where: { id: challenge.id }, data: { attempts: { increment: 1 } } });
    const expected = protectedHash(`${phoneKey}:${purpose}:${code}`);
    if (!timingSafeEqual(Buffer.from(expected), Buffer.from(challenge.codeHash))) return false;
    await tx.phoneOtpChallenge.delete({ where: { id: challenge.id } });
    return true;
  });
}
