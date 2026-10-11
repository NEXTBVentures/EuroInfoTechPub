import { z } from "zod";

export const vendorEntityTypes = [
  "INDIVIDUAL",
  "SOLE_PROPRIETORSHIP",
  "PARTNERSHIP",
  "COMPANY",
  "OTHER",
] as const;

export const vendorApplicationStatuses = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "CHANGES_REQUIRED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
] as const;

export const vendorApplicationFieldKeys = [
  "legalName",
  "storeName",
  "entityType",
  "registeredAddress",
  "operationalAddress",
  "contactEmail",
  "contactPhone",
  "taxIdentifiers",
  "businessIdentifiers",
  "contactPersonName",
  "description",
  "supportEmail",
  "supportPhone",
  "shippingOrigins",
] as const;

export const vendorAddressSchema = z.object({
  addressLine1: z.string().trim().min(1).max(160),
  addressLine2: z.string().trim().max(160).optional().default(""),
  city: z.string().trim().min(1).max(100),
  region: z.string().trim().max(100).optional().default(""),
  postalCode: z.string().trim().min(1).max(24),
  countryCode: z.string().trim().regex(/^[A-Z]{2}$/),
});

const identifierSchema = z.object({
  kind: z.string().trim().min(1).max(80),
  value: z.string().trim().min(1).max(160),
});

export const vendorProfileSchema = z.object({
  legalName: z.string().trim().min(1).max(180),
  storeName: z.string().trim().min(1).max(120),
  entityType: z.enum(vendorEntityTypes),
  registeredAddress: vendorAddressSchema,
  operationalAddress: vendorAddressSchema.optional().nullable(),
  contactEmail: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  contactPhone: z.string().trim().max(32).optional().default(""),
  taxIdentifiers: z.array(identifierSchema).max(10).default([]),
  businessIdentifiers: z.array(identifierSchema).max(10).default([]),
  contactPersonName: z.string().trim().max(160).optional().default(""),
  description: z.string().trim().max(2000).optional().default(""),
  supportEmail: z.string().trim().email().max(254).optional().or(z.literal("")).default(""),
  supportPhone: z.string().trim().max(32).optional().default(""),
  shippingOrigins: z.array(z.object({
    label: z.string().trim().min(1).max(80),
    address: vendorAddressSchema,
  })).max(20).default([]),
  logoReference: z.string().uuid().optional().nullable(),
  bannerReference: z.string().uuid().optional().nullable(),
});

const draftText = (maxLength: number) => z.string().trim().max(maxLength);
const draftAddressSchema = z.object({
  addressLine1: draftText(160).optional(),
  addressLine2: draftText(160).optional(),
  city: draftText(100).optional(),
  region: draftText(100).optional(),
  postalCode: draftText(24).optional(),
  countryCode: draftText(2).optional(),
});
const draftIdentifierSchema = z.object({
  kind: draftText(80),
  value: draftText(160),
});
const vendorProfileDraftSchema = vendorProfileSchema.partial().extend({
  legalName: draftText(180).optional(),
  storeName: draftText(120).optional(),
  entityType: z.enum(vendorEntityTypes).or(z.literal("")).optional(),
  registeredAddress: draftAddressSchema.optional(),
  operationalAddress: draftAddressSchema.optional().nullable(),
  contactEmail: z.string().trim().email().max(254).or(z.literal("")).optional(),
  contactPhone: draftText(32).optional(),
  taxIdentifiers: z.array(draftIdentifierSchema).max(10).optional(),
  businessIdentifiers: z.array(draftIdentifierSchema).max(10).optional(),
  contactPersonName: draftText(160).optional(),
  description: draftText(2000).optional(),
  supportEmail: z.string().trim().email().max(254).or(z.literal("")).optional(),
  supportPhone: draftText(32).optional(),
  shippingOrigins: z.array(z.object({
    label: draftText(80),
    address: draftAddressSchema,
  })).max(20).optional(),
});

export const vendorOnboardingRulesSchema = z.object({
  requiredFields: z.array(z.enum(vendorApplicationFieldKeys)).max(vendorApplicationFieldKeys.length).default([
    "legalName", "storeName", "entityType", "registeredAddress", "contactEmail",
  ]),
  requiredDocumentCategories: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  maxDocumentBytes: z.number().int().min(1024).max(10 * 1024 * 1024).default(5 * 1024 * 1024),
  allowedMediaTypes: z.array(z.enum(["application/pdf", "image/png", "image/jpeg"])).min(1)
    .default(["application/pdf", "image/png", "image/jpeg"]),
  preventSelfReview: z.boolean().default(true),
});

export const vendorOnboardingRulesUpdateSchema = z.object({
  rules: vendorOnboardingRulesSchema,
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/).optional(),
});

export const vendorApplicationCreateSchema = z.object({
  profile: vendorProfileDraftSchema.default({}),
});

export const vendorApplicationUpdateSchema = z.object({
  profile: vendorProfileDraftSchema,
});

export const vendorDocumentCategorySchema = z.string().trim().min(1).max(80)
  .regex(/^[a-z0-9][a-z0-9-]*$/);

export const vendorAdminDecisionSchema = z.object({
  action: z.enum(["start-review", "request-changes", "approve", "reject", "suspend", "reactivate"]),
  internalReason: z.string().trim().min(5).max(2000),
  vendorMessage: z.string().trim().max(1000).optional().default(""),
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/).optional(),
});

export const vendorStaffInviteSchema = z.object({
  vendorId: z.string().uuid(),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()).optional(),
  phone: z.string().trim().regex(/^\+[1-9]\d{7,14}$/).optional(),
  permissionKeys: z.array(z.enum([
    "vendor.profile.manage",
    "vendor.catalogue.manage",
    "vendor.orders.manage",
    "vendor.application.view",
    "vendor.kyc.upload",
  ])).max(5).default([]),
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/).optional(),
}).refine((value) => Boolean(value.email || value.phone), {
  message: "A verified email or phone number is required",
});

export const vendorStaffPermissionSchema = z.object({
  vendorId: z.string().uuid(),
  permissionKeys: z.array(z.enum(["vendor.bank.manage"])).max(1),
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/).optional(),
});

export const vendorStaffRevokeSchema = z.object({
  vendorId: z.string().uuid(),
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/).optional(),
});

export const vendorStaffAcceptSchema = z.object({
  token: z.string().min(32).max(256),
});

export const vendorBankProfileSchema = z.object({
  accountHolderName: z.string().trim().min(1).max(160),
  bankName: z.string().trim().min(1).max(120),
  accountNumber: z.string().trim().regex(/^[0-9]{4,64}$/),
  routingIdentifier: z.string().trim().min(2).max(40),
  accountType: z.enum(["SAVINGS", "CURRENT", "OTHER"]),
  supportingDocumentId: z.string().uuid().optional(),
});

export const vendorBankUpdateSchema = z.object({
  vendorId: z.string().uuid(),
  profile: vendorBankProfileSchema,
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/).optional(),
});

export const vendorBankVerificationSchema = z.object({
  status: z.enum(["VERIFIED", "REJECTED"]),
  reason: z.string().trim().min(5).max(1000),
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/).optional(),
});
