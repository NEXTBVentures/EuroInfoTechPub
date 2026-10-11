import {
  createCipheriv,
  createDecipheriv,
  createHmac,
  randomBytes,
  timingSafeEqual,
  hkdfSync,
} from "node:crypto";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const PERIOD_SECONDS = 30;
const DIGITS = 6;

export function getAuthSecret(): string {
  const value = process.env.AUTH_MFA_SECRET ?? process.env.BETTER_AUTH_SECRET ?? process.env.SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("A 32-character Better Auth secret is required for identity security");
  }
  return value;
}

function derivedKey(purpose: string): Buffer {
  return Buffer.from(hkdfSync(
    "sha256",
    Buffer.from(getAuthSecret(), "utf8"),
    Buffer.from("nextb-commerce-m02", "utf8"),
    Buffer.from(purpose, "utf8"),
    32,
  ));
}

function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function base32Decode(value: string): Buffer {
  const normalized = value.toUpperCase().replace(/=+$/, "");
  let bits = 0;
  let accumulator = 0;
  const bytes: number[] = [];
  for (const character of normalized) {
    const digit = BASE32.indexOf(character);
    if (digit < 0) throw new Error("invalid_totp_secret");
    accumulator = (accumulator << 5) | digit;
    bits += 5;
    if (bits >= 8) {
      bytes.push((accumulator >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function makeTotpUri(accountName: string, secret: string, issuer = "Euro Infotech"): string {
  const label = `${issuer}:${accountName}`;
  const query = new URLSearchParams({
    secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(PERIOD_SECONDS),
  });
  return `otpauth://totp/${encodeURIComponent(label)}?${query.toString()}`;
}

export function encryptTotpSecret(secret: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", derivedKey("totp-secret-encryption-v1"), iv);
  const ciphertext = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64url");
}

export function decryptTotpSecret(value: string): string {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < 29) throw new Error("invalid_totp_ciphertext");
  const iv = bytes.subarray(0, 12);
  const tag = bytes.subarray(12, 28);
  const ciphertext = bytes.subarray(28);
  const decipher = createDecipheriv("aes-256-gcm", derivedKey("totp-secret-encryption-v1"), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

export function totpCodeAt(secret: string, epochMilliseconds: number): { code: string; step: bigint } {
  const step = BigInt(Math.floor(epochMilliseconds / (PERIOD_SECONDS * 1000)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(step);
  const digest = createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = digest[digest.length - 1]! & 15;
  const value = (
    ((digest[offset]! & 127) << 24) |
    ((digest[offset + 1]! & 255) << 16) |
    ((digest[offset + 2]! & 255) << 8) |
    (digest[offset + 3]! & 255)
  ) % 10 ** DIGITS;
  return { code: String(value).padStart(DIGITS, "0"), step };
}

export function verifyTotp(
  secret: string,
  submitted: string,
  epochMilliseconds = Date.now(),
  lastAcceptedStep?: bigint | null,
): bigint | null {
  if (!/^\d{6}$/.test(submitted)) return null;
  const currentStep = BigInt(Math.floor(epochMilliseconds / (PERIOD_SECONDS * 1000)));
  for (const step of [currentStep - 1n, currentStep, currentStep + 1n]) {
    if (step < 0n || (lastAcceptedStep != null && step <= lastAcceptedStep)) continue;
    const expected = totpCodeAt(secret, Number(step) * PERIOD_SECONDS * 1000).code;
    if (timingSafeEqual(Buffer.from(expected), Buffer.from(submitted))) return step;
  }
  return null;
}

export function generateRecoveryCodes(amount = 10): string[] {
  return Array.from({ length: amount }, () => {
    const value = randomBytes(10).toString("hex").toUpperCase();
    return `${value.slice(0, 5)}-${value.slice(5, 10)}-${value.slice(10, 15)}-${value.slice(15)}`;
  });
}

export function hashRecoveryCode(userId: string, code: string): string {
  const normalized = code.replace(/[-\s]/g, "").toUpperCase();
  return createHmac("sha256", derivedKey("totp-recovery-code-hash-v1"))
    .update(`${userId}:${normalized}`, "utf8")
    .digest("hex");
}
