import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { prisma } from "./client";
import { findScopedOrganizationSetting } from "./repositories";
import { executeIdempotent } from "./idempotency";
import { assertModuleAvailable } from "@workspace/core";

const testKey = `integration-${randomUUID()}`;
afterAll(async () => {
  await prisma.idempotencyRecord.deleteMany({ where: { operation: testKey } });
  await prisma.smokeJobEffect.deleteMany({ where: { jobKey: testKey } });
  await prisma.$disconnect();
});
describe("real PostgreSQL foundation", () => {
  it("isolates org-scoped repositories", async () => {
    const a = await prisma.organization.findUniqueOrThrow({ where: { key: "euro-infotech" } });
    const b = await prisma.organization.findUniqueOrThrow({ where: { key: "synthetic-isolation-fixture" } });
    const context = { organizationId: a.id, actor: { kind: "anonymous" as const }, requestId: testKey };
    expect(await findScopedOrganizationSetting(context, "isolation-marker")).toBeNull();
    expect(await findScopedOrganizationSetting({ ...context, organizationId: b.id }, "isolation-marker"))
      .toEqual({ synthetic: "org-b-only" });
  });
  it("enforces disabled modules using persisted module state", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { key: "euro-infotech" } });
    const state = await prisma.organizationModule.findUniqueOrThrow({
      where: { organizationId_moduleKey: { organizationId: org.id, moduleKey: "payments" } },
    });
    expect(() => assertModuleAvailable("payments", state)).toThrow("module_unavailable:payments");
  });
  it("atomically persists a result and applies duplicate requests once", async () => {
    const org = await prisma.organization.findUniqueOrThrow({ where: { key: "euro-infotech" } });
    const context = { organizationId: org.id, actor: { kind: "anonymous" as const }, requestId: testKey };
    const input = { actorKey: "synthetic", operation: testKey, key: testKey, requestHash: "hash-a" };
    let calls = 0;
    const execute = async (tx: Parameters<Parameters<typeof executeIdempotent>[2]>[0]) => {
      calls++;
      await tx.smokeJobEffect.create({ data: { organizationId: org.id, jobKey: testKey } });
      return { applied: true };
    };
    const results = await Promise.all([
      executeIdempotent(context, input, execute),
      executeIdempotent(context, input, execute),
    ]);
    expect(results).toEqual([{ applied: true }, { applied: true }]);
    expect(calls).toBe(1);
    expect(await prisma.smokeJobEffect.count({ where: { jobKey: testKey } })).toBe(1);
    await expect(executeIdempotent(context, { ...input, requestHash: "hash-b" }, execute))
      .rejects.toThrow("idempotency_content_conflict");
  });
});
