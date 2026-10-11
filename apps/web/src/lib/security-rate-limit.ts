import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "@workspace/database";

export async function allowSecurityAttempt(
  key: string,
  maxAttempts: number,
  windowSeconds: number,
): Promise<boolean> {
  const now = BigInt(Date.now());
  const cutoff = now - BigInt(windowSeconds * 1000);
  const rows = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimit" ("id", "key", "count", "lastRequest")
    VALUES (${randomUUID()}, ${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE
    SET "count" = CASE
      WHEN "RateLimit"."lastRequest" < ${cutoff} THEN 1
      ELSE "RateLimit"."count" + 1
    END,
    "lastRequest" = CASE
      WHEN "RateLimit"."lastRequest" < ${cutoff} THEN ${now}
      ELSE "RateLimit"."lastRequest"
    END
    RETURNING "count"
  `;
  return (rows[0]?.count ?? maxAttempts + 1) <= maxAttempts;
}
