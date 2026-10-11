import "server-only";
import { vendorOnboardingRulesSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";

type ProfilePatch = Record<string, unknown>;

export function profileFromVendor(vendor: {
  legalName: string | null;
  storeName: string | null;
  entityType: string | null;
  registeredAddress: unknown;
  operationalAddress: unknown;
  contactEmail: string | null;
  contactPhone: string | null;
  taxIdentifiers: unknown;
  businessIdentifiers: unknown;
  contactPersonName: string | null;
  description: string | null;
  supportEmail: string | null;
  supportPhone: string | null;
  shippingOrigins: unknown;
}) {
  return {
    legalName: vendor.legalName ?? "",
    storeName: vendor.storeName ?? "",
    entityType: vendor.entityType ?? "",
    registeredAddress: vendor.registeredAddress ?? undefined,
    operationalAddress: vendor.operationalAddress ?? undefined,
    contactEmail: vendor.contactEmail ?? "",
    contactPhone: vendor.contactPhone ?? "",
    taxIdentifiers: vendor.taxIdentifiers ?? [],
    businessIdentifiers: vendor.businessIdentifiers ?? [],
    contactPersonName: vendor.contactPersonName ?? "",
    description: vendor.description ?? "",
    supportEmail: vendor.supportEmail ?? "",
    supportPhone: vendor.supportPhone ?? "",
    shippingOrigins: vendor.shippingOrigins ?? [],
  };
}

export function profilePatchToVendorData(profile: ProfilePatch) {
  const data: Record<string, unknown> = {};
  const scalarKeys = [
    "legalName", "storeName", "entityType", "contactEmail", "contactPhone",
    "contactPersonName", "description", "supportEmail", "supportPhone",
  ] as const;
  for (const key of scalarKeys) if (key in profile) data[key] = profile[key];
  const jsonKeys = [
    "registeredAddress", "operationalAddress", "taxIdentifiers",
    "businessIdentifiers", "shippingOrigins",
  ] as const;
  for (const key of jsonKeys) if (key in profile) data[key] = profile[key] as never;
  return data;
}

export async function getVendorOnboardingRules(organizationId: string) {
  const setting = await prisma.organizationSetting.findUnique({
    where: { organizationId_key: { organizationId, key: "vendors.onboarding.rules" } },
    select: { value: true },
  });
  const parsed = vendorOnboardingRulesSchema.safeParse(setting?.value ?? {});
  return parsed.success ? parsed.data : vendorOnboardingRulesSchema.parse({});
}

export function vendorApplicationResponse(application: {
  id: string;
  status: string;
  submittedAt: Date | null;
  vendor: {
    id: string;
    legalName: string | null;
    storeName: string | null;
    entityType: string | null;
    registeredAddress: unknown;
    operationalAddress: unknown;
    contactEmail: string | null;
    contactPhone: string | null;
    taxIdentifiers: unknown;
    businessIdentifiers: unknown;
    contactPersonName: string | null;
    description: string | null;
    supportEmail: string | null;
    supportPhone: string | null;
    shippingOrigins: unknown;
  };
  documents: { id: string; category: string; originalFilename: string; mediaType: string; sizeBytes: number; active: boolean; uploadedAt: Date }[];
  decisions: { id: string; toStatus: string; vendorMessage: string | null; createdAt: Date }[];
}) {
  return {
    id: application.id,
    status: application.status,
    submittedAt: application.submittedAt,
    vendorId: application.vendor.id,
    profile: profileFromVendor(application.vendor),
    documents: application.documents.map(({ id, category, originalFilename, mediaType, sizeBytes, active, uploadedAt }) =>
      ({ id, category, originalFilename, mediaType, sizeBytes, active, uploadedAt })),
    messages: application.decisions
      .filter((decision) => decision.vendorMessage)
      .map(({ id, toStatus, vendorMessage, createdAt }) => ({ id, status: toStatus, message: vendorMessage, createdAt })),
  };
}

export const vendorApplicationInclude = {
  vendor: true,
  documents: { orderBy: { uploadedAt: "desc" as const } },
  decisions: { orderBy: { createdAt: "desc" as const }, select: { id: true, toStatus: true, vendorMessage: true, createdAt: true } },
};

export async function writeVendorAudit(
  tx: Pick<typeof prisma, "vendorAuditEvent">,
  input: {
    organizationId: string;
    vendorId: string;
    actorUserId?: string | null;
    action: string;
    targetId?: string;
    requestId?: string | null;
    metadata?: Record<string, unknown>;
  },
) {
  await tx.vendorAuditEvent.create({
    data: {
      ...input,
      metadata: input.metadata as never,
    },
  });
}
