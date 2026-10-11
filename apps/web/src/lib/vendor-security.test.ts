import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import { chmod, mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  decryptBankProfile,
  encryptBankProfile,
  maskBankProfile,
  newVendorDocumentStorageKey,
  safeVendorFilename,
  storeVendorDocument,
  readVendorDocument,
} from "./vendor-security";

const keyVariables = [
  "VENDOR_BANK_ENCRYPTION_KEY_VERSION",
  "VENDOR_BANK_ENCRYPTION_KEY",
  "VENDOR_BANK_ENCRYPTION_KEY_V1",
  "VENDOR_BANK_ENCRYPTION_KEY_V2",
] as const;
const originalEnvironment = Object.fromEntries(keyVariables.map((key) => [key, process.env[key]]));
const keyV1 = randomBytes(32).toString("base64");
const keyV2 = randomBytes(32).toString("base64");
const sample = {
  accountHolderName: "Test Vendor",
  bankName: "Example Bank",
  accountNumber: "123456789012",
  routingIdentifier: "EXAMPLE00001",
  accountType: "CURRENT" as const,
};

function clearKeys() {
  for (const key of keyVariables) delete process.env[key];
}

beforeEach(clearKeys);
afterEach(() => {
  vi.unstubAllEnvs();
  clearKeys();
  for (const key of keyVariables) {
    const value = originalEnvironment[key];
    if (value !== undefined) process.env[key] = value;
  }
});

describe("private document storage", () => {
  it("uses opaque paths and strips traversal and header-control characters from names", async () => {
    expect(safeVendorFilename("../../kyc.pdf")).toBe("kyc.pdf");
    expect(safeVendorFilename("..\\..\\kyc.pdf\r\n\"")).toBe("kyc.pdf___");
    expect(newVendorDocumentStorageKey("pdf")).toMatch(/^[0-9a-f-]{36}\.pdf$/);
    await expect(storeVendorDocument("../../escape.pdf", new Uint8Array([1]))).rejects.toThrow("storage_key");
    await expect(readVendorDocument("../escape.pdf")).rejects.toThrow("storage_key");
  });

  it("refuses local storage in production and published deployments", async () => {
    const key = newVendorDocumentStorageKey("pdf");
    vi.stubEnv("NODE_ENV", "production");
    await expect(storeVendorDocument(key, new Uint8Array([1]))).rejects.toThrow("disabled_in_production");
    vi.stubEnv("NODE_ENV", "test");
    vi.stubEnv("REPLIT_DEPLOYMENT", "1");
    await expect(readVendorDocument(key)).rejects.toThrow("disabled_in_production");
  });

  it("refuses package public roots, public symlinks and symlink documents", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "m03-private-"));
    try {
      const key = newVendorDocumentStorageKey("pdf");
      vi.stubEnv("VENDOR_DOCUMENT_STORAGE_DIR", path.join(process.cwd(), "public", "kyc"));
      await expect(storeVendorDocument(key, new Uint8Array([1]))).rejects.toThrow("must_be_private");
      vi.stubEnv("VENDOR_DOCUMENT_STORAGE_DIR", root);
      await storeVendorDocument(key, new Uint8Array([1, 2]));
      expect(await readVendorDocument(key)).toEqual(Buffer.from([1, 2]));
      const alias = newVendorDocumentStorageKey("pdf");
      await symlink(path.join(root, key), path.join(root, alias));
      await expect(readVendorDocument(alias)).rejects.toThrow();
      await chmod(root, 0o777);
      await expect(readVendorDocument(key)).rejects.toThrow("must_be_private");
      await chmod(root, 0o700);
      const publicTarget = path.join(root, "public");
      const rootAlias = path.join(root, "alias");
      await mkdir(publicTarget, { mode: 0o700 });
      await symlink(publicTarget, rootAlias);
      vi.stubEnv("VENDOR_DOCUMENT_STORAGE_DIR", rootAlias);
      await expect(storeVendorDocument(newVendorDocumentStorageKey("pdf"), new Uint8Array([1]))).rejects.toThrow("must_be_private");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

describe("vendor bank-profile security", () => {
  it("fails closed when no encryption key is configured", () => {
    expect(() => encryptBankProfile(sample)).toThrow("vendor_bank_encryption_unavailable");
  });

  it("encrypts account details and authenticates their ciphertext", () => {
    process.env.VENDOR_BANK_ENCRYPTION_KEY_V1 = keyV1;
    const encrypted = encryptBankProfile(sample);
    expect(encrypted.keyVersion).toBe("v1");
    expect(encrypted.ciphertext).not.toContain(sample.accountNumber);
    expect(decryptBankProfile(encrypted.ciphertext, encrypted.keyVersion)).toEqual(sample);

    const parts = encrypted.ciphertext.split(".");
    parts[2] = Buffer.from("tampered").toString("base64");
    expect(() => decryptBankProfile(parts.join("."), encrypted.keyVersion)).toThrow();
  });

  it("decrypts old records by key version while new records use the active version", () => {
    process.env.VENDOR_BANK_ENCRYPTION_KEY_V1 = keyV1;
    const oldRecord = encryptBankProfile(sample);
    process.env.VENDOR_BANK_ENCRYPTION_KEY_V2 = keyV2;
    process.env.VENDOR_BANK_ENCRYPTION_KEY_VERSION = "v2";
    const newRecord = encryptBankProfile(sample);

    expect(newRecord.keyVersion).toBe("v2");
    expect(decryptBankProfile(oldRecord.ciphertext, oldRecord.keyVersion)).toEqual(sample);
    expect(decryptBankProfile(newRecord.ciphertext, newRecord.keyVersion)).toEqual(sample);
  });

  it("exposes only a masked account identifier and verification state", () => {
    expect(maskBankProfile("9012", "PENDING")).toEqual({
      accountNumber: "•••• 9012",
      verificationStatus: "PENDING",
    });
  });
});
