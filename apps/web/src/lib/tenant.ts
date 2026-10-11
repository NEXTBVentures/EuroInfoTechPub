import "server-only";
import { headers } from "next/headers";
import { prisma } from "@workspace/database";

export interface ResolvedTenant {
  id: string;
  key: string;
  displayName: string;
  host: string;
  identityEnabled: boolean;
}

export function normalizeHost(header: string | null | undefined): string | null {
  const value = header?.trim();
  if (!value || value.length > 300 || /[,/@\\\s]/.test(value)) return null;
  try {
    const parsed = new URL(`http://${value}`);
    if (parsed.username || parsed.password || parsed.pathname !== "/" || parsed.search || parsed.hash) {
      return null;
    }
    const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
    return host || null;
  } catch {
    return null;
  }
}

export async function resolveTenant(hostHeader: string | null | undefined): Promise<ResolvedTenant | null> {
  const host = normalizeHost(hostHeader);
  if (!host) return null;

  const organization = await prisma.organization.findFirst({
    where: { domains: { some: { host } } },
    select: { id: true, key: true, displayName: true, modules: { where: { moduleKey: "identity" } } },
  });
  if (organization) return {
    id: organization.id, key: organization.key, displayName: organization.displayName, host,
    identityEnabled: organization.modules.some((module) => module.enabled && module.implementationStatus === "IMPLEMENTED"),
  };

  if (
    process.env.NODE_ENV === "development" &&
    process.env.ALLOW_UNMAPPED_DOMAIN_IN_DEV === "true"
  ) {
    const fallback = await prisma.organization.findUnique({
      where: { key: process.env.CLIENT_CONFIG_KEY ?? "euro-infotech" },
      select: { id: true, key: true, displayName: true, modules: { where: { moduleKey: "identity" } } },
    });
    if (fallback) return {
      id: fallback.id, key: fallback.key, displayName: fallback.displayName, host,
      identityEnabled: fallback.modules.some((module) => module.enabled && module.implementationStatus === "IMPLEMENTED"),
    };
  }
  return null;
}

export async function resolveTenantFromRequest(requestHeaders?: Headers): Promise<ResolvedTenant | null> {
  const currentHeaders = requestHeaders ?? await headers();
  return resolveTenant(currentHeaders.get("host"));
}

export async function createCustomerMembership(tenantId: string, userId: string): Promise<void> {
  await prisma.$transaction(async (tx) => {
    const membership = await tx.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: tenantId, userId } },
      create: { organizationId: tenantId, userId },
      update: {},
    });
    const existing = await tx.roleAssignment.findFirst({
      where: { membershipId: membership.id, roleKey: "CUSTOMER", vendorId: null },
      select: { id: true },
    });
    if (!existing) {
      await tx.roleAssignment.create({
        data: { organizationId: tenantId, membershipId: membership.id, roleKey: "CUSTOMER" },
      });
    }
  });
}
