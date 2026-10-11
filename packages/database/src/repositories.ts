import type { RequestContext } from "@workspace/core";
import { prisma } from "./client";

export async function findScopedOrganizationSetting(
  context: RequestContext,
  key: string,
): Promise<unknown | null> {
  if (!context.organizationId) throw new Error("organization_scope_required");
  const setting = await prisma.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId: context.organizationId, key } },
    select: { value: true },
  });
  return setting?.value ?? null;
}
