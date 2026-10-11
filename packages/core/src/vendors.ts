export const VENDOR_APPLICATION_STATUSES = [
  "DRAFT",
  "SUBMITTED",
  "UNDER_REVIEW",
  "CHANGES_REQUIRED",
  "APPROVED",
  "REJECTED",
  "SUSPENDED",
] as const;

export type VendorApplicationStatus = (typeof VENDOR_APPLICATION_STATUSES)[number];
export type VendorDecisionActor = "applicant" | "admin";

const TRANSITIONS: Record<VendorApplicationStatus, readonly VendorApplicationStatus[]> = {
  DRAFT: ["SUBMITTED"],
  SUBMITTED: ["UNDER_REVIEW"],
  UNDER_REVIEW: ["CHANGES_REQUIRED", "APPROVED", "REJECTED"],
  CHANGES_REQUIRED: ["SUBMITTED"],
  APPROVED: ["SUSPENDED"],
  REJECTED: [],
  SUSPENDED: ["APPROVED"],
};

const ADMIN_TRANSITIONS = new Set([
  "SUBMITTED:UNDER_REVIEW",
  "UNDER_REVIEW:CHANGES_REQUIRED",
  "UNDER_REVIEW:APPROVED",
  "UNDER_REVIEW:REJECTED",
  "APPROVED:SUSPENDED",
  "SUSPENDED:APPROVED",
]);

export function canTransitionVendorApplication(
  from: VendorApplicationStatus,
  to: VendorApplicationStatus,
  actor: VendorDecisionActor,
): boolean {
  return TRANSITIONS[from].includes(to) &&
    (actor === "admin" || !ADMIN_TRANSITIONS.has(`${from}:${to}`));
}

export function requireVendorApplicationTransition(
  from: VendorApplicationStatus,
  to: VendorApplicationStatus,
  actor: VendorDecisionActor,
): void {
  if (!canTransitionVendorApplication(from, to, actor)) {
    throw new Error("vendor_application_transition_not_allowed");
  }
}

export function missingVendorApplicationRequirements(
  profile: Record<string, unknown>,
  requiredFields: readonly string[],
  requiredDocumentCategories: readonly string[],
  uploadedDocumentCategories: readonly string[],
): string[] {
  const missing = requiredFields.filter((field) => {
    const value = profile[field];
    if (typeof value === "string") return !value.trim();
    if (Array.isArray(value)) return value.length === 0;
    return value === null || value === undefined;
  });
  const uploaded = new Set(uploadedDocumentCategories);
  return [
    ...missing,
    ...requiredDocumentCategories
      .filter((category) => !uploaded.has(category))
      .map((category) => `document:${category}`),
  ];
}

export type DetectedDocumentType = {
  mediaType: "application/pdf" | "image/png" | "image/jpeg";
  extension: "pdf" | "png" | "jpg";
};

export function detectVendorDocumentType(bytes: Uint8Array): DetectedDocumentType | null {
  if (bytes.length >= 5 &&
    bytes[0] === 0x25 && bytes[1] === 0x50 && bytes[2] === 0x44 &&
    bytes[3] === 0x46 && bytes[4] === 0x2d) {
    return { mediaType: "application/pdf", extension: "pdf" };
  }
  if (bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e &&
    bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a &&
    bytes[6] === 0x1a && bytes[7] === 0x0a) {
    return { mediaType: "image/png", extension: "png" };
  }
  if (bytes.length >= 3 &&
    bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return { mediaType: "image/jpeg", extension: "jpg" };
  }
  return null;
}
