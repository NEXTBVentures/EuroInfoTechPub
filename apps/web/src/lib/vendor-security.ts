import "server-only";
import { createCipheriv, createDecipheriv, randomBytes, randomUUID } from "node:crypto";
import { mkdir, open, realpath, stat, unlink } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { vendorBankProfileSchema } from "@workspace/contracts";
import type { z } from "zod";

type BankProfile = z.infer<typeof vendorBankProfileSchema>;

function encryptionKey(version = activeBankKeyVersion()): Buffer {
  const keyName = `VENDOR_BANK_ENCRYPTION_KEY_${version.toUpperCase()}`;
  const configured = process.env[keyName] ??
    (version === "v1" ? process.env.VENDOR_BANK_ENCRYPTION_KEY : undefined);
  if (!configured) throw new Error("vendor_bank_encryption_unavailable");
  const key = Buffer.from(configured, "base64");
  if (key.length !== 32 || key.toString("base64") !== configured) {
    throw new Error("vendor_bank_encryption_key_invalid");
  }
  return key;
}

export function activeBankKeyVersion(): string {
  const version = process.env.VENDOR_BANK_ENCRYPTION_KEY_VERSION ?? "v1";
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(version)) throw new Error("vendor_bank_key_version_invalid");
  return version;
}

export function encryptBankProfile(profile: BankProfile): { ciphertext: string; keyVersion: string } {
  const iv = randomBytes(12);
  const version = activeBankKeyVersion();
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(version), iv);
  const encrypted = Buffer.concat([cipher.update(JSON.stringify(profile), "utf8"), cipher.final()]);
  return {
    keyVersion: version,
    ciphertext: [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64")).join("."),
  };
}

export function decryptBankProfile(ciphertext: string, keyVersion: string): BankProfile {
  if (!/^[a-zA-Z0-9_-]{1,32}$/.test(keyVersion)) throw new Error("vendor_bank_key_version_invalid");
  const [iv, tag, body, extra] = ciphertext.split(".");
  if (!iv || !tag || !body || extra) throw new Error("vendor_bank_ciphertext_invalid");
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(keyVersion), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(body, "base64")),
    decipher.final(),
  ]).toString("utf8");
  return JSON.parse(plaintext) as BankProfile;
}

export function maskBankProfile(lastFour: string, verificationStatus: string) {
  return { accountNumber: `•••• ${lastFour}`, verificationStatus };
}

function storageRoot(): string {
  if (process.env.NODE_ENV === "production" || process.env.REPLIT_DEPLOYMENT === "1") {
    throw new Error("local_vendor_document_storage_disabled_in_production");
  }
  const root = path.resolve(/* turbopackIgnore: true */
    process.env.VENDOR_DOCUMENT_STORAGE_DIR ??
      path.join(os.tmpdir(), "euroinfo-private-vendor-documents"),
  );
  if (root.split(path.sep).includes("public")) {
    throw new Error("vendor_document_storage_must_be_private");
  }
  return root;
}

async function privateStorageRoot(): Promise<string> {
  const root = storageRoot();
  await mkdir(root, { recursive: true, mode: 0o700 });
  const resolved = await realpath(root);
  if (resolved.split(path.sep).includes("public") || ((await stat(resolved)).mode & 0o077)) {
    throw new Error("vendor_document_storage_must_be_private");
  }
  return resolved;
}

export function newVendorDocumentStorageKey(extension: string): string {
  if (!["pdf", "png", "jpg"].includes(extension)) throw new Error("unsupported_vendor_document_type");
  return `${randomUUID()}.${extension}`;
}

export async function storeVendorDocument(storageKey: string, bytes: Uint8Array): Promise<void> {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(storageKey)) {
    throw new Error("invalid_vendor_document_storage_key");
  }
  const root = await privateStorageRoot();
  const file = await open(path.join(root, storageKey),
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    await file.writeFile(bytes);
  } finally {
    await file.close();
  }
}

export async function readVendorDocument(storageKey: string): Promise<Buffer> {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(storageKey)) {
    throw new Error("invalid_vendor_document_storage_key");
  }
  const file = await open(path.join(await privateStorageRoot(), storageKey),
    constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    return await file.readFile();
  } finally {
    await file.close();
  }
}

export async function removeVendorDocument(storageKey: string): Promise<void> {
  if (!/^[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(storageKey)) return;
  try {
    await unlink(path.join(await privateStorageRoot(), storageKey));
  } catch { /* Best-effort cleanup; never weaken private-storage guards. */ }
}

export function safeVendorFilename(input: string): string {
  return path.basename(input.replaceAll("\\", "/"))
    .replace(/[\u0000-\u001f\u007f"]/g, "_")
    .slice(0, 160) || "document";
}
