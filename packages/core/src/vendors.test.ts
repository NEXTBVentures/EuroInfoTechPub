import { describe, expect, it } from "vitest";
import {
  canTransitionVendorApplication,
  detectVendorDocumentType,
  missingVendorApplicationRequirements,
} from "./vendors";

describe("vendor application policy", () => {
  it("allows applicant draft submission and requested-change resubmission only", () => {
    expect(canTransitionVendorApplication("DRAFT", "SUBMITTED", "applicant")).toBe(true);
    expect(canTransitionVendorApplication("CHANGES_REQUIRED", "SUBMITTED", "applicant")).toBe(true);
    expect(canTransitionVendorApplication("DRAFT", "APPROVED", "applicant")).toBe(false);
    expect(canTransitionVendorApplication("REJECTED", "SUBMITTED", "applicant")).toBe(false);
  });

  it("requires review before an administrator can decide and prevents post-rejection transitions", () => {
    expect(canTransitionVendorApplication("SUBMITTED", "APPROVED", "admin")).toBe(false);
    expect(canTransitionVendorApplication("UNDER_REVIEW", "APPROVED", "admin")).toBe(true);
    expect(canTransitionVendorApplication("REJECTED", "UNDER_REVIEW", "admin")).toBe(false);
    expect(canTransitionVendorApplication("APPROVED", "SUSPENDED", "admin")).toBe(true);
  });

  it("reports missing configured fields and document categories", () => {
    expect(missingVendorApplicationRequirements(
      { legalName: " Acme " },
      ["legalName", "taxIdentifiers"],
      ["business-registration"],
      [],
    )).toEqual(["taxIdentifiers", "document:business-registration"]);
  });

  it("detects actual PDF, PNG and JPEG signatures and rejects a renamed text file", () => {
    expect(detectVendorDocumentType(new TextEncoder().encode("%PDF-1.7"))?.mediaType)
      .toBe("application/pdf");
    expect(detectVendorDocumentType(Uint8Array.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]))?.extension).toBe("png");
    expect(detectVendorDocumentType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00]))?.extension)
      .toBe("jpg");
    expect(detectVendorDocumentType(new TextEncoder().encode("not a pdf"))).toBeNull();
  });
});
