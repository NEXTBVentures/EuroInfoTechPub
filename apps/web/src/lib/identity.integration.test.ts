import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "@workspace/database";

const suffix = randomUUID();
const email = `m02-${suffix}@example.invalid`;
const password = `Initial-${randomBytes(18).toString("hex")}`;
const newPassword = `Changed-${randomBytes(18).toString("hex")}`;
const phone = `+919${String(Math.floor(Math.random() * 1e9)).padStart(9, "0")}`;
const userIds: string[] = [];
const phones: string[] = [phone];
const testVendorIds: string[] = [];
let userId: string;
let cookie: string;
let secondCookie: string;
let organizationId: string;
let secondOrganizationId: string;
let totpSecret: string;
let recoveryCodes: string[];
let authRoutes: typeof import("../app/api/auth/[...all]/route");
let securityRoutes: typeof import("../app/api/v1/identity/security/route");
let rolesRoutes: typeof import("../app/api/v1/identity/roles/route");
let sessionRoute: typeof import("../app/api/v1/identity/session/route");
let phoneRoute: typeof import("../app/api/v1/identity/phone/send/route");
let vendorRoute: typeof import("../app/api/v1/identity/vendor/[vendorId]/route");
let deliveries: typeof import("./auth-delivery");
let otp: typeof import("./phone-otp");
let totp: typeof import("./totp");

function request(path: string, body?: object, sessionCookie = "", host = "localhost:3000"): Request {
  return new Request(`http://${host}${path}`, {
    method: body ? "POST" : "GET",
    headers: {
      host, origin: `http://${host}`, "content-type": "application/json",
      "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 240)}`,
      ...(sessionCookie ? { cookie: sessionCookie } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}
function responseCookies(response: Response): string {
  return response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
async function login(emailAddress = email, secret = newPassword): Promise<Response> {
  return authRoutes.POST(request("/api/auth/sign-in/email", { email: emailAddress, password: secret }));
}
async function security(body: object, sessionCookie = cookie): Promise<Response> {
  return securityRoutes.POST(request("/api/v1/identity/security", body, sessionCookie));
}
function latestCode(recipient: string): string {
  return deliveries.readCapturedAuthMessages(recipient).filter((message) => message.kind === "phone-otp").at(-1)!.content;
}
async function resetTotpReplayCounter(): Promise<void> {
  await prisma.adminTotpCredential.update({ where: { userId }, data: { lastAcceptedStep: null } });
}

beforeAll(async () => {
  vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("AUTH_TRUSTED_ORIGINS", "http://isolation-fixture.test");
  vi.stubEnv("AUTH_TEST_ADAPTERS", "true");
  vi.stubEnv("ALLOW_UNMAPPED_DOMAIN_IN_DEV", "false");
  authRoutes = await import("../app/api/auth/[...all]/route");
  securityRoutes = await import("../app/api/v1/identity/security/route");
  rolesRoutes = await import("../app/api/v1/identity/roles/route");
  sessionRoute = await import("../app/api/v1/identity/session/route");
  phoneRoute = await import("../app/api/v1/identity/phone/send/route");
  vendorRoute = await import("../app/api/v1/identity/vendor/[vendorId]/route");
  deliveries = await import("./auth-delivery");
  otp = await import("./phone-otp");
  totp = await import("./totp");
  organizationId = (await prisma.organization.findUniqueOrThrow({ where: { key: "euro-infotech" } })).id;
  secondOrganizationId = (await prisma.organization.findUniqueOrThrow({ where: { key: "synthetic-isolation-fixture" } })).id;
});

afterAll(async () => {
  if (otp) {
    await prisma.phoneOtpChallenge.deleteMany({
      where: { phoneKey: { in: phones.map((value) => otp.phoneChallengeKey(organizationId, value)) } },
    });
  }
  await prisma.authAuditEvent.deleteMany({
    where: { OR: [{ actorUserId: { in: userIds } }, { targetUserId: { in: userIds } }] },
  });
  if (testVendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: testVendorIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.rateLimit.deleteMany({ where: { key: { contains: suffix } } });
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("M02 identity security integration", () => {
  it("registers with a hashed password, inactive email and tenant-specific customer membership", async () => {
    const response = await authRoutes.POST(request("/api/auth/sign-up/email", {
      email, password, name: "M02 test customer", callbackURL: "/verify-email",
    }));
    expect(response.status).toBe(200);
    userId = (await response.json()).user.id;
    userIds.push(userId);
    const user = await prisma.user.findUniqueOrThrow({ where: { id: userId }, include: { accounts: true, memberships: { include: { assignments: true } } } });
    expect(user.emailVerified).toBe(false);
    expect(user.accounts[0]!.password).not.toBe(password);
    expect(user.memberships[0]!.organizationId).toBe(organizationId);
    expect(user.memberships[0]!.assignments[0]!.roleKey).toBe("CUSTOMER");
    const duplicate = await authRoutes.POST(request("/api/auth/sign-up/email", { email, password, name: "Duplicate" }));
    expect(duplicate.status).toBe(200);
    expect(await prisma.organizationMembership.count({ where: { userId } })).toBe(1);
  });

  it("requires email verification and issues secure, revocable HttpOnly sessions", async () => {
    expect((await login(email, password)).status).toBe(403);
    const message = deliveries.readCapturedAuthMessages(email).find((entry) => entry.kind === "email-verification")!;
    expect(message).toBeDefined();
    const verified = await authRoutes.GET(request(new URL(message.content).pathname + new URL(message.content).search));
    expect(verified.status).toBeLessThan(400);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).emailVerified).toBe(true);
    const signedIn = await login(email, password);
    expect(signedIn.status).toBe(200);
    expect(signedIn.headers.getSetCookie().join(";")).toMatch(/HttpOnly/i);
    expect(signedIn.headers.getSetCookie().join(";")).toMatch(/SameSite=Lax/i);
    cookie = responseCookies(signedIn);
    expect((await sessionRoute.GET(request("/api/v1/identity/session", undefined, cookie))).status).toBe(200);
  });

  it("denies cross-organization access and rejects cross-tenant grants in the database", async () => {
    expect((await sessionRoute.GET(request("/api/v1/identity/session", undefined, cookie, "isolation-fixture.test"))).status).toBe(401);
    const membership = await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId } } });
    await expect(prisma.roleAssignment.create({
      data: { organizationId: secondOrganizationId, membershipId: membership.id, roleKey: "ORGANISATION_OWNER" },
    })).rejects.toThrow();
    await prisma.organizationMembership.create({ data: { organizationId: secondOrganizationId, userId } });
    const scoped = await sessionRoute.GET(request("/api/v1/identity/session", undefined, cookie, "isolation-fixture.test"));
    expect(scoped.status).toBe(200);
    expect((await scoped.json()).permissions).toEqual([]);
  });

  it("revokes another session, then all sessions, without exposing tokens", async () => {
    const extra = await login(email, password);
    expect(extra.status).toBe(200);
    const extraCookie = responseCookies(extra);
    const listing = await securityRoutes.GET(request("/api/v1/identity/security", undefined, cookie));
    const listed = await listing.json();
    expect(listed.sessions.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(listed)).not.toContain('"token"');
    const other = listed.sessions.find((session: { current: boolean }) => !session.current);
    expect((await security({ action: "revokeOne", sessionId: other.id, password })).status).toBe(200);
    expect((await sessionRoute.GET(request("/api/v1/identity/session", undefined, extraCookie))).status).toBe(401);
    expect((await security({ action: "revokeAll", password })).status).toBe(200);
    expect((await sessionRoute.GET(request("/api/v1/identity/session", undefined, cookie))).status).toBe(401);
    cookie = responseCookies(await login(email, password));
  });

  it("resets passwords through the local adapter and invalidates old sessions", async () => {
    const resetRequest = await authRoutes.POST(request("/api/auth/request-password-reset", { email, redirectTo: "/reset-password" }));
    expect(resetRequest.status).toBe(200);
    const message = deliveries.readCapturedAuthMessages(email).filter((entry) => entry.kind === "password-reset").at(-1)!;
    const token = new URL(message.content).pathname.split("/").at(-1)!;
    const reset = await authRoutes.POST(request("/api/auth/reset-password", { token, newPassword }));
    expect(reset.status).toBe(200);
    expect((await sessionRoute.GET(request("/api/v1/identity/session", undefined, cookie))).status).toBe(401);
    expect((await login(email, password)).status).toBe(401);
    const signedIn = await login();
    expect(signedIn.status).toBe(200);
    cookie = responseCookies(signedIn);
  });

  it("links a verified mobile number with reauthentication, then signs in using OTP only", async () => {
    const sent = await phoneRoute.POST(request("/api/v1/identity/phone/send", { phoneNumber: phone, purpose: "LINK", password: newPassword }, cookie));
    expect(sent.status).toBe(200);
    const code = latestCode(phone);
    const challenge = await prisma.phoneOtpChallenge.findFirstOrThrow({ where: { userId, purpose: "LINK" } });
    expect(challenge.codeHash).not.toContain(code);
    const linked = await authRoutes.POST(request("/api/auth/phone-number/verify", { phoneNumber: phone, code, updatePhoneNumber: true }, cookie));
    expect(linked.status).toBe(200);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).phoneNumberVerified).toBe(true);
    expect((await phoneRoute.POST(request("/api/v1/identity/phone/send", { phoneNumber: phone, purpose: "LOGIN" }))).status).toBe(200);
    const signedIn = await authRoutes.POST(request("/api/auth/phone-number/verify", { phoneNumber: phone, code: latestCode(phone) }));
    expect(signedIn.status).toBe(200);
    expect((await sessionRoute.GET(request("/api/v1/identity/session", undefined, responseCookies(signedIn)))).status).toBe(200);
    expect((await authRoutes.POST(request("/api/auth/phone-number/send-otp", { phoneNumber: phone }))).status).toBe(404);
  });

  it("enforces OTP resend, three attempts, expiry and atomic consumption under concurrency", async () => {
    const uniquePhone = `${phone.slice(0, -2)}41`;
    phones.push(uniquePhone);
    expect(await otp.sendProtectedPhoneOtp(organizationId, uniquePhone, "LOGIN")).toBe("sent");
    expect(await otp.sendProtectedPhoneOtp(organizationId, uniquePhone, "LOGIN")).toBe("limited");
    const code = latestCode(uniquePhone);
    const consumed = await Promise.all([
      otp.consumeProtectedPhoneOtp(organizationId, uniquePhone, code, "LOGIN"),
      otp.consumeProtectedPhoneOtp(organizationId, uniquePhone, code, "LOGIN"),
    ]);
    expect(consumed.filter(Boolean)).toHaveLength(1);
    const attemptPhone = `${phone.slice(0, -2)}42`;
    phones.push(attemptPhone);
    await otp.sendProtectedPhoneOtp(organizationId, attemptPhone, "LOGIN");
    const actual = latestCode(attemptPhone);
    const wrong = actual === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect(await otp.consumeProtectedPhoneOtp(organizationId, attemptPhone, wrong, "LOGIN")).toBe(false);
    expect(await otp.consumeProtectedPhoneOtp(organizationId, attemptPhone, actual, "LOGIN")).toBe(false);
    const expiryPhone = `${phone.slice(0, -2)}43`;
    phones.push(expiryPhone);
    await otp.sendProtectedPhoneOtp(organizationId, expiryPhone, "LOGIN");
    await prisma.phoneOtpChallenge.updateMany({ where: { phoneKey: otp.phoneChallengeKey(organizationId, expiryPhone) }, data: { expiresAt: new Date(Date.now() - 1) } });
    expect(await otp.consumeProtectedPhoneOtp(organizationId, expiryPhone, latestCode(expiryPhone), "LOGIN")).toBe(false);
  });

  it("requires approved vendor scope and denies other vendors and administrator permission", async () => {
    const membership = await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId } } });
    const vendorId = randomUUID();
    await prisma.vendor.create({ data: { id: vendorId, organizationId, status: "ACTIVE" } });
    testVendorIds.push(vendorId);
    const assignment = await prisma.roleAssignment.create({ data: { organizationId, membershipId: membership.id, roleKey: "VENDOR_STAFF", vendorId } });
    const ownRequest = () => vendorRoute.GET(request(`/api/v1/identity/vendor/${vendorId}`, undefined, cookie), { params: Promise.resolve({ vendorId }) });
    expect((await ownRequest()).status).toBe(403);
    await prisma.roleAssignment.update({ where: { id: assignment.id }, data: { vendorApprovedAt: new Date() } });
    expect((await ownRequest()).status).toBe(200);
    expect((await vendorRoute.GET(request("/api/v1/identity/vendor/other", undefined, cookie), { params: Promise.resolve({ vendorId: randomUUID() }) })).status).toBe(403);
    expect((await rolesRoutes.GET(request("/api/v1/identity/roles", undefined, cookie))).status).toBe(403);
  });

  it("enrolls administrator TOTP with hashed recovery codes and cannot expose the secret again", async () => {
    const membership = await prisma.organizationMembership.findUniqueOrThrow({ where: { organizationId_userId: { organizationId, userId } } });
    await prisma.roleAssignment.create({ data: { organizationId, membershipId: membership.id, roleKey: "ORGANISATION_OWNER" } });
    const before = await rolesRoutes.GET(request("/api/v1/identity/roles", undefined, cookie));
    expect(before.status).toBe(403);
    expect((await before.json()).error).toBe("enrollment_required");
    const enrolled = await security({ action: "enrol", password: newPassword });
    expect(enrolled.status).toBe(200);
    totpSecret = (await enrolled.json()).secret;
    const verified = await security({ action: "verify", code: totp.totpCodeAt(totpSecret, Date.now()).code });
    expect(verified.status).toBe(200);
    recoveryCodes = (await verified.json()).recoveryCodes;
    expect(recoveryCodes).toHaveLength(10);
    const stored = await prisma.authRecoveryCode.findMany({ where: { userId } });
    expect(stored).toHaveLength(10);
    expect(stored[0]!.codeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(JSON.stringify(stored)).not.toContain(recoveryCodes[0]!);
    const credential = await prisma.adminTotpCredential.findUniqueOrThrow({ where: { userId } });
    expect(credential.secretCiphertext).not.toContain(totpSecret);
    expect((await security({ action: "enrol", password: newPassword })).status).toBe(409);
    expect((await rolesRoutes.GET(request("/api/v1/identity/roles", undefined, cookie))).status).toBe(200);
  });

  it("requires session-specific MFA after both email and phone login", async () => {
    const signedIn = await login();
    expect(signedIn.status).toBe(200);
    secondCookie = responseCookies(signedIn);
    expect((await rolesRoutes.GET(request("/api/v1/identity/roles", undefined, secondCookie))).status).toBe(428);
    await prisma.phoneOtpChallenge.updateMany({ where: { phoneKey: otp.phoneChallengeKey(organizationId, phone), purpose: "LOGIN" }, data: { resendAfter: new Date(0) } });
    expect((await phoneRoute.POST(request("/api/v1/identity/phone/send", { phoneNumber: phone, purpose: "LOGIN" }))).status).toBe(200);
    const phoneLogin = await authRoutes.POST(request("/api/auth/phone-number/verify", { phoneNumber: phone, code: latestCode(phone) }));
    expect(phoneLogin.status).toBe(200);
    expect((await rolesRoutes.GET(request("/api/v1/identity/roles", undefined, responseCookies(phoneLogin)))).status).toBe(428);
  });

  it("atomically consumes recovery codes once, including concurrent attempts", async () => {
    expect((await security({ action: "recover", recoveryCode: recoveryCodes[0] }, secondCookie)).status).toBe(200);
    expect((await security({ action: "recover", recoveryCode: recoveryCodes[0] }, secondCookie)).status).toBe(401);
    const attempts = await Promise.all([
      security({ action: "recover", recoveryCode: recoveryCodes[1] }, secondCookie),
      security({ action: "recover", recoveryCode: recoveryCodes[1] }, secondCookie),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 401]);
    expect(await prisma.authRecoveryCode.count({ where: { userId } })).toBe(8);
    expect((await rolesRoutes.GET(request("/api/v1/identity/roles", undefined, secondCookie))).status).toBe(200);
  });

  it("rejects concurrent TOTP replay and prevents removing mandatory admin MFA", async () => {
    await resetTotpReplayCounter();
    const code = totp.totpCodeAt(totpSecret, Date.now()).code;
    const attempts = await Promise.all([
      security({ action: "verify", code }, secondCookie),
      security({ action: "verify", code }, secondCookie),
    ]);
    expect(attempts.map((response) => response.status).sort()).toEqual([200, 401]);
    await resetTotpReplayCounter();
    const removed = await security({ action: "remove", password: newPassword, code: totp.totpCodeAt(totpSecret, Date.now()).code }, secondCookie);
    expect(removed.status).toBe(409);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorEnabled).toBe(true);
  });

  it("protects role mutations with tenant membership, permission, recent password and TOTP", async () => {
    // Prior tests intentionally perform many sensitive actions in a short period.
    // Advance this fixture's rate-limit window rather than weakening the live limit.
    await prisma.rateLimit.updateMany({
      where: { key: `m02:reauth:${organizationId}:${userId}` }, data: { count: 0, lastRequest: 0n },
    });
    const target = await prisma.user.create({ data: { id: `test-${suffix}`, name: "Role target", email: `target-${suffix}@example.invalid` } });
    userIds.push(target.id);
    await prisma.organizationMembership.create({ data: { organizationId, userId: target.id } });
    await resetTotpReplayCounter();
    const adminDenied = await rolesRoutes.POST(request("/api/v1/identity/roles", {
      userId: target.id, roleKey: "ADMIN_STAFF", password: newPassword, code: totp.totpCodeAt(totpSecret, Date.now()).code,
    }, secondCookie));
    expect(adminDenied.status).toBe(409);
    await resetTotpReplayCounter();
    const assigned = await rolesRoutes.POST(request("/api/v1/identity/roles", {
      userId: target.id, roleKey: "CUSTOMER", password: newPassword, code: totp.totpCodeAt(totpSecret, Date.now()).code,
    }, secondCookie));
    expect(assigned.status).toBe(200);
    expect(await prisma.roleAssignment.count({ where: { membership: { userId: target.id }, roleKey: "CUSTOMER" } })).toBe(1);
  });

  it("fails unknown domains, missing providers and invalid origins without leaking secrets to audit", async () => {
    const unknown = await authRoutes.POST(request("/api/auth/sign-in/email", { email, password: newPassword }, "", "unknown-m02.invalid"));
    expect(unknown.status).toBe(404);
    const badOrigin = request("/api/v1/identity/security", { action: "revokeAll", password: newPassword }, secondCookie);
    badOrigin.headers.set("origin", "https://attacker.example");
    expect((await securityRoutes.POST(badOrigin)).status).toBe(403);
    vi.stubEnv("AUTH_TEST_ADAPTERS", "false");
    expect((await phoneRoute.POST(request("/api/v1/identity/phone/send", { phoneNumber: phone, purpose: "LOGIN" }))).status).toBe(503);
    vi.stubEnv("AUTH_TEST_ADAPTERS", "true");
    vi.stubEnv("NODE_ENV", "production");
    expect(() => deliveries.readCapturedAuthMessages()).toThrow("test_adapter_disabled");
    vi.stubEnv("NODE_ENV", "test");
    const audit = await prisma.authAuditEvent.findMany({ where: { actorUserId: userId } });
    const eventTypes = audit.map((event) => event.eventType);
    for (const eventType of ["AUTH_LOGIN_SUCCESS", "TOTP_ENROLMENT_COMPLETED", "TOTP_RECOVERY_CODE_USED", "ROLE_CHANGED", "PERMISSION_CHANGED", "SESSION_REVOKED"]) {
      expect(eventTypes).toContain(eventType);
    }
    const serialized = JSON.stringify(audit);
    for (const forbidden of [password, newPassword, totpSecret, ...recoveryCodes]) expect(serialized).not.toContain(forbidden);
    expect(audit.every((event) => event.metadata === null)).toBe(true);
  });

  it("uses shared database state to cap concurrent security attempts", async () => {
    const { allowSecurityAttempt } = await import("./security-rate-limit");
    const responses = await Promise.all(Array.from({ length: 12 }, () => allowSecurityAttempt(`test-${suffix}`, 3, 300)));
    expect(responses.filter(Boolean)).toHaveLength(3);
  });

  it("rate-limits incorrect email logins across database-backed requests", async () => {
    const statuses: number[] = [];
    const ip = "198.51.100.247";
    for (let index = 0; index < 6; index++) {
      const attempt = request("/api/auth/sign-in/email", { email: `${suffix}@example.invalid`, password });
      attempt.headers.set("x-forwarded-for", ip);
      statuses.push((await authRoutes.POST(attempt)).status);
    }
    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses[5]).toBe(429);
    await prisma.rateLimit.deleteMany({ where: { key: { contains: ip } } });
  });

  it("prevents parallel login attempts from bypassing the shared limit", async () => {
    const attempts = await Promise.all(Array.from({ length: 12 }, async () => {
      const attempt = request("/api/auth/sign-in/email", { email: `${suffix}@example.invalid`, password });
      attempt.headers.set("x-forwarded-for", "198.51.100.246");
      return (await authRoutes.POST(attempt)).status;
    }));
    expect(attempts.filter((status) => status === 401)).toHaveLength(5);
    expect(attempts.filter((status) => status === 429)).toHaveLength(7);
  });

  it("removes TOTP only after recent authentication when no privileged memberships remain", async () => {
    await prisma.roleAssignment.deleteMany({ where: { membership: { userId }, roleKey: "ORGANISATION_OWNER" } });
    await prisma.rateLimit.updateMany({
      where: { key: `m02:reauth:${organizationId}:${userId}` }, data: { count: 0, lastRequest: 0n },
    });
    await resetTotpReplayCounter();
    const response = await security({ action: "remove", password: newPassword, code: totp.totpCodeAt(totpSecret, Date.now()).code }, secondCookie);
    expect(response.status).toBe(200);
    expect(await prisma.authRecoveryCode.count({ where: { userId } })).toBe(0);
    expect(await prisma.adminTotpCredential.count({ where: { userId } })).toBe(0);
    expect((await prisma.user.findUniqueOrThrow({ where: { id: userId } })).twoFactorEnabled).toBe(false);
  });
});
