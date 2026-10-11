import { z } from "zod";

export const registrationSchema = z.object({
  name: z.string().trim().min(1).max(120),
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(12).max(128),
});

export const emailLoginSchema = z.object({
  email: z.string().trim().email().max(254).transform((value) => value.toLowerCase()),
  password: z.string().min(1).max(128),
  returnTo: z.string().optional(),
});

export const e164PhoneSchema = z.string().regex(/^\+[1-9]\d{7,14}$/, "Enter a valid international phone number");

export const roleAssignmentSchema = z.object({
  userId: z.string().min(1).max(128),
  roleKey: z.enum([
    "CUSTOMER",
    "VENDOR_OWNER",
    "VENDOR_STAFF",
    "ADMIN_STAFF",
    "ORGANISATION_OWNER",
  ]),
  vendorId: z.string().uuid().optional(),
});

export const passwordReauthenticationSchema = z.object({
  password: z.string().min(1).max(128),
});

export const totpVerificationSchema = z.object({
  code: z.string().regex(/^\d{6}$/),
});

export const sessionRevocationSchema = z.object({
  sessionId: z.string().min(1).max(128),
});

const reauthenticationFields = {
  password: z.string().min(1).max(128),
  code: z.string().regex(/^\d{6}$/).optional(),
};

export const identitySecurityActionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("enrol"), ...reauthenticationFields }),
  z.object({ action: z.literal("verify"), code: z.string().regex(/^\d{6}$/) }),
  z.object({ action: z.literal("recover"), recoveryCode: z.string().min(10).max(50) }),
  z.object({ action: z.literal("remove"), ...reauthenticationFields }),
  z.object({ action: z.literal("revokeOne"), ...reauthenticationFields, sessionId: z.string().min(1).max(128) }),
  z.object({ action: z.literal("revokeAll"), ...reauthenticationFields }),
]);

export const phoneOtpRequestSchema = z.object({
  phoneNumber: e164PhoneSchema,
  purpose: z.enum(["LOGIN", "LINK"]),
  password: z.string().min(1).max(128).optional(),
  code: z.string().regex(/^\d{6}$/).optional(),
});

export const phoneOtpVerificationSchema = z.object({
  phoneNumber: e164PhoneSchema,
  code: z.string().regex(/^\d{6}$/),
  updatePhoneNumber: z.boolean().optional(),
  disableSession: z.boolean().optional(),
});

export const roleManagementSchema = roleAssignmentSchema.extend(reauthenticationFields);
