import { prisma } from "./client";
import type { RequestContext } from "@workspace/core";
import { Prisma } from "./generated/client";

export async function executeIdempotent<T extends Prisma.InputJsonValue>(
  context: RequestContext,
  input: { actorKey: string; operation: string; key: string; requestHash: string },
  execute: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  if (!context.organizationId || !input.actorKey || !input.operation || !input.key || !input.requestHash) {
    throw new Error("invalid_idempotency_scope");
  }
  return prisma.$transaction(async (tx) => {
    // Serialize the same org/actor/operation/key; different keys can run concurrently.
    const scope = JSON.stringify([context.organizationId, input.actorKey, input.operation, input.key]);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${scope}, 0))`;
    const where = {
      organizationId_actorKey_operation_idempotencyKey: {
        organizationId: context.organizationId, actorKey: input.actorKey,
        operation: input.operation, idempotencyKey: input.key,
      },
    };
    const existing = await tx.idempotencyRecord.findUnique({ where });
    if (existing) {
      if (existing.requestHash !== input.requestHash) throw new Error("idempotency_content_conflict");
      if (existing.status !== "COMPLETED") throw new Error("idempotency_in_progress");
      return existing.response as T;
    }
    const result = await execute(tx);
    await tx.idempotencyRecord.create({
      data: {
        organizationId: context.organizationId, actorKey: input.actorKey,
        operation: input.operation, idempotencyKey: input.key,
        requestHash: input.requestHash, status: "COMPLETED", response: result,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    return result;
  });
}
