import { beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";
import {
  totpCodeAt, verifyTotp, generateTotpSecret, encryptTotpSecret, decryptTotpSecret,
  hashRecoveryCode, generateRecoveryCodes,
} from "./totp";

beforeAll(() => { vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex")); });

describe("TOTP and recovery material", () => {
  it("matches RFC 6238 SHA-1 test vector truncated to six digits", () => {
    const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
    expect(totpCodeAt(secret, 59_000).code).toBe("287082");
    expect(verifyTotp(secret, "287082", 59_000)).toBe(1n);
    expect(verifyTotp(secret, "287082", 59_000, 1n)).toBeNull();
    expect(verifyTotp(secret, "287082", 120_000)).toBeNull();
  });
  it("protects TOTP secrets with authenticated encryption", () => {
    const secret = generateTotpSecret();
    const ciphertext = encryptTotpSecret(secret);
    expect(ciphertext).not.toContain(secret);
    expect(decryptTotpSecret(ciphertext)).toBe(secret);
    const corrupted = Buffer.from(ciphertext, "base64url");
    corrupted[30] = corrupted[30]! ^ 1;
    expect(() => decryptTotpSecret(corrupted.toString("base64url"))).toThrow();
  });
  it("hashes unpredictable recovery codes with user-specific binding", () => {
    const codes = generateRecoveryCodes();
    expect(new Set(codes).size).toBe(10);
    const hash = hashRecoveryCode("user-a", codes[0]!);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hash).not.toContain(codes[0]!);
    expect(hashRecoveryCode("user-b", codes[0]!)).not.toBe(hash);
    expect(hashRecoveryCode("user-a", codes[0]!.replaceAll("-", "").toLowerCase())).toBe(hash);
  });
});
