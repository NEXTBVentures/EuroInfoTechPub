import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { randomBytes, randomUUID } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@workspace/database";
import { generateTotpSecret, encryptTotpSecret, totpCodeAt } from "./totp";

const suffix = randomUUID();
const password = `Synthetic-${randomBytes(24).toString("hex")}`;
const secret = generateTotpSecret();
const ids: string[] = [];
const vendorIds: string[] = [];
let root: string;
let org: string;
let otherOrg: string;
type Actor = { id: string; email: string; membershipId: string; cookie: string };
let applicant: Actor;
let stranger: Actor;
let admin: Actor;
let reviewer: Actor;
let staff: Actor;
let appId: string;
let vendorId: string;
let documentId: string;
let inviteToken: string;
let auth: typeof import("../app/api/auth/[...all]/route");
let applications: typeof import("../app/api/v1/vendor/applications/route");
let edit: typeof import("../app/api/v1/vendor/applications/[id]/route");
let submit: typeof import("../app/api/v1/vendor/applications/[id]/submit/route");
let documents: typeof import("../app/api/v1/vendor/documents/route");
let download: typeof import("../app/api/v1/vendor/documents/[id]/route");
let decisions: typeof import("../app/api/v1/admin/vendors/[id]/decision/route");
let adminList: typeof import("../app/api/v1/admin/vendors/route");
let bank: typeof import("../app/api/v1/vendor/bank/route");
let invitations: typeof import("../app/api/v1/vendor/staff/route");
let permissions: typeof import("../app/api/v1/vendor/staff/[membershipId]/permissions/route");
let revoke: typeof import("../app/api/v1/vendor/staff/[membershipId]/route");

function request(actor: Actor | null, route: string, method = "GET", body?: object | FormData, host = "localhost:3000") {
  return new Request(`http://${host}${route}`, {
    method, headers: { host, origin: `http://${host}`, "x-forwarded-for": `192.0.2.${1 + Math.floor(Math.random() * 240)}`, ...(actor ? { cookie: actor.cookie } : {}),
      ...(body && !(body instanceof FormData) ? { "content-type": "application/json" } : {}) },
    ...(body ? { body: body instanceof FormData ? body : JSON.stringify(body) } : {}),
  });
}
function context(id = appId) { return { params: Promise.resolve({ id }) }; }
async function login(actor: Actor) {
  const response = await auth.POST(request(null, "/api/auth/sign-in/email", "POST", { email: actor.email, password }));
  expect(response.status).toBe(200);
  actor.cookie = response.headers.getSetCookie().map((value) => value.split(";")[0]).join("; ");
}
async function actor(roleKey = "CUSTOMER"): Promise<Actor> {
  const id = `m03-${suffix}-${randomUUID()}`;
  ids.push(id);
  const email = `${id}@example.invalid`;
  await prisma.user.create({ data: { id, name: "Synthetic M03 verification", email, emailVerified: true } });
  await prisma.account.create({ data: { id: randomUUID(), accountId: id, userId: id, providerId: "credential", password: await hashPassword(password) } });
  const member = await prisma.organizationMembership.create({ data: { organizationId: org, userId: id } });
  await prisma.roleAssignment.create({ data: { organizationId: org, membershipId: member.id, roleKey } });
  const result = { id, email, membershipId: member.id, cookie: "" };
  await login(result);
  return result;
}
function profile(email: string) {
  return { legalName: "Synthetic Verification Company", storeName: "Synthetic Store", entityType: "COMPANY",
    contactEmail: email, registeredAddress: { addressLine1: "Synthetic test address", city: "Test City", postalCode: "000000", countryCode: "IN" } };
}
function fileForm(id = appId, type = "application/pdf", content = "%PDF-1.7\nsynthetic-only", name = "../../kyc.pdf") {
  const form = new FormData();
  form.set("applicationId", id); form.set("category", "identity");
  form.set("file", new File([content], name, { type }));
  return form;
}
async function decide(action: string, id = appId, who = admin) {
  await prisma.rateLimit.deleteMany({ where: { key: { contains: who.id } } });
  await prisma.adminTotpCredential.update({ where: { userId: who.id }, data: { lastAcceptedStep: null } });
  return decisions.POST(request(who, "/decision", "POST", {
    action, password, code: totpCodeAt(secret, Date.now()).code,
    internalReason: "Synthetic test review decision", vendorMessage: "Synthetic vendor message",
  }), context(id));
}

beforeAll(async () => {
  if (process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Synthetic verification refuses published deployments");
  vi.stubEnv("BETTER_AUTH_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("AUTH_MFA_SECRET", randomBytes(32).toString("hex"));
  vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
  vi.stubEnv("AUTH_TRUSTED_ORIGINS", "http://isolation-fixture.test");
  vi.stubEnv("AUTH_TEST_ADAPTERS", "true");
  vi.stubEnv("ALLOW_UNMAPPED_DOMAIN_IN_DEV", "false");
  root = await mkdtemp(path.join(os.tmpdir(), "m03-routes-"));
  vi.stubEnv("VENDOR_DOCUMENT_STORAGE_DIR", root);
  auth = await import("../app/api/auth/[...all]/route");
  applications = await import("../app/api/v1/vendor/applications/route");
  edit = await import("../app/api/v1/vendor/applications/[id]/route");
  submit = await import("../app/api/v1/vendor/applications/[id]/submit/route");
  documents = await import("../app/api/v1/vendor/documents/route");
  download = await import("../app/api/v1/vendor/documents/[id]/route");
  decisions = await import("../app/api/v1/admin/vendors/[id]/decision/route");
  adminList = await import("../app/api/v1/admin/vendors/route");
  bank = await import("../app/api/v1/vendor/bank/route");
  invitations = await import("../app/api/v1/vendor/staff/route");
  permissions = await import("../app/api/v1/vendor/staff/[membershipId]/permissions/route");
  revoke = await import("../app/api/v1/vendor/staff/[membershipId]/route");
  org = (await prisma.organization.findUniqueOrThrow({ where: { key: "euro-infotech" } })).id;
  otherOrg = (await prisma.organization.findUniqueOrThrow({ where: { key: "synthetic-isolation-fixture" } })).id;
  applicant = await actor(); stranger = await actor(); admin = await actor("ORGANISATION_OWNER");
  reviewer = await actor("ADMIN_STAFF"); staff = await actor();
});

afterAll(async () => {
  if (vendorIds.length) {
    const where = { vendorId: { in: vendorIds } };
    await prisma.vendorStaffPermission.deleteMany({ where });
    await prisma.vendorStaffInvitation.deleteMany({ where });
    await prisma.vendorBankProfile.deleteMany({ where });
    await prisma.vendorAuditEvent.deleteMany({ where });
    await prisma.vendorDecision.deleteMany({ where });
    await prisma.vendorSubmission.deleteMany({ where: { application: { vendorId: { in: vendorIds } } } });
    await prisma.vendorDocument.updateMany({ where, data: { supersedesId: null } });
    await prisma.vendorDocument.deleteMany({ where });
    await prisma.vendorApplication.deleteMany({ where });
    await prisma.outboxEvent.deleteMany({ where: { dedupeKey: { contains: suffix } } });
    await prisma.outboxEvent.deleteMany({ where: { OR: vendorIds.map((value) => ({ payload: { path: ["vendorId"], equals: value } })) } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  }
  await prisma.authAuditEvent.deleteMany({ where: { OR: [{ actorUserId: { in: ids } }, { targetUserId: { in: ids } }] } });
  await prisma.rateLimit.deleteMany({ where: { OR: ids.map((id) => ({ key: { contains: id } })) } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  if (root) await rm(root, { recursive: true, force: true });
  vi.unstubAllEnvs();
  await prisma.$disconnect();
});

describe("M03 real authenticated route security and lifecycle", () => {
  it("creates one draft for concurrent requests and persists profile edits", async () => {
    const responses = await Promise.all([1, 2].map(() => applications.POST(request(applicant, "/applications", "POST", { profile: {} }))));
    expect(responses.map((r) => r.status).sort()).toEqual([200, 201]);
    const app = (await responses[0].json()).application;
    appId = app.id; vendorId = app.vendorId; vendorIds.push(vendorId);
    expect((await edit.PATCH(request(applicant, "/application", "PATCH", { profile: profile(applicant.email) }), context())).status).toBe(200);
    const read = await applications.GET(request(applicant, "/applications"));
    expect((await read.json()).application.profile.legalName).toBe("Synthetic Verification Company");
  });
  it("denies cross-vendor and cross-organisation edits", async () => {
    expect((await edit.PATCH(request(stranger, "/application", "PATCH", { profile: { storeName: "Denied" } }), context())).status).toBe(404);
    expect((await edit.PATCH(request(applicant, "/application", "PATCH", { profile: { storeName: "Denied" } }, "isolation-fixture.test"), context())).status).toBe(401);
  });
  it("rejects missing requirements without creating submission/outbox records", async () => {
    await edit.PATCH(request(applicant, "/application", "PATCH", { profile: { legalName: "" } }), context());
    expect((await submit.POST(request(applicant, "/submit", "POST"), context())).status).toBe(422);
    expect(await prisma.vendorSubmission.count({ where: { applicationId: appId } })).toBe(0);
    await edit.PATCH(request(applicant, "/application", "PATCH", { profile: { legalName: "Synthetic Verification Company" } }), context());
  });
  it("validates MIME, signatures and size before private upload", async () => {
    expect((await documents.POST(request(applicant, "/documents", "POST", fileForm(appId, "text/plain")))).status).toBe(415);
    expect((await documents.POST(request(applicant, "/documents", "POST", fileForm(appId, "application/pdf", "fake")))).status).toBe(415);
    expect((await documents.POST(request(applicant, "/documents", "POST", fileForm(appId, "application/pdf", "x".repeat(10 * 1024 * 1024 + 1))))).status).toBe(413);
    expect((await documents.POST(request(stranger, "/documents", "POST", fileForm()))).status).toBe(403);
  });
  it("retains replacement history and never derives storage paths from user names", async () => {
    const first = await documents.POST(request(applicant, "/documents", "POST", fileForm()));
    expect(first.status).toBe(201);
    const oldId = (await first.json()).document.id;
    const second = await documents.POST(request(applicant, "/documents", "POST", fileForm()));
    documentId = (await second.json()).document.id;
    const rows = await prisma.vendorDocument.findMany({ where: { applicationId: appId } });
    expect(rows).toHaveLength(2);
    expect(rows.filter((r) => r.active)).toHaveLength(1);
    expect(rows.find((r) => r.id === documentId)?.supersedesId).toBe(oldId);
    expect(rows.every((r) => r.originalFilename === "kyc.pdf" && !r.storageKey.includes("kyc"))).toBe(true);
    const simultaneous = await Promise.all([1, 2].map(() => documents.POST(request(applicant, "/documents", "POST", fileForm()))));
    expect(simultaneous.map((r) => r.status)).toEqual([201, 201]);
    const replacements = await prisma.vendorDocument.findMany({ where: { applicationId: appId } });
    expect(replacements).toHaveLength(4);
    expect(replacements.filter((r) => r.active)).toHaveLength(1);
    documentId = replacements.find((r) => r.active)!.id;
  });
  it("requires scoped authentication for KYC and returns no-cache attachment responses", async () => {
    expect((await download.GET(request(null, "/documents"), context(documentId))).status).toBe(401);
    expect((await download.GET(request(stranger, "/documents"), context(documentId))).status).toBe(403);
    expect((await download.GET(request(applicant, "/documents", "GET", undefined, "isolation-fixture.test"), context(documentId))).status).toBe(401);
    const response = await download.GET(request(applicant, "/documents"), context(documentId));
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await response.text()).toContain("%PDF-");
  });
  it("rolls back submission and audit state when the durable outbox write fails", async () => {
    const event = await prisma.outboxEvent.create({ data: {
      organizationId: org, dedupeKey: `vendor.application.submitted:${appId}:1`,
      eventType: "vendor.application.submitted", payload: { vendorId },
    } });
    try {
      expect((await submit.POST(request(applicant, "/submit", "POST"), context())).status).toBe(503);
      expect((await prisma.vendorApplication.findUniqueOrThrow({ where: { id: appId } })).status).toBe("DRAFT");
      expect(await prisma.vendorSubmission.count({ where: { applicationId: appId } })).toBe(0);
      expect(await prisma.vendorAuditEvent.count({ where: { vendorId, action: "application.submitted" } })).toBe(0);
    } finally {
      await prisma.outboxEvent.delete({ where: { id: event.id } });
    }
  });
  it("serializes duplicate submission into one revision and one durable outbox event", async () => {
    const responses = await Promise.all([1, 2, 3].map(() => submit.POST(request(applicant, "/submit", "POST"), context())));
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(await prisma.vendorSubmission.count({ where: { applicationId: appId } })).toBe(1);
    expect(await prisma.outboxEvent.count({ where: { dedupeKey: `vendor.application.submitted:${appId}:1` } })).toBe(1);
    expect((await edit.PATCH(request(applicant, "/edit", "PATCH", { profile: { storeName: "Too late" } }), context())).status).toBe(409);
    expect((await documents.POST(request(applicant, "/documents", "POST", fileForm()))).status).toBe(403);
  });
  it("requires admin permission, organisation scope, enrollment and completed second factor", async () => {
    expect((await adminList.GET(request(applicant, "/admin/vendors"))).status).toBe(403);
    expect((await adminList.GET(request(admin, "/admin/vendors"))).status).toBe(403);
    for (const who of [admin, reviewer]) {
      await prisma.adminTotpCredential.create({ data: { userId: who.id, secretCiphertext: encryptTotpSecret(secret), verifiedAt: new Date(), setupExpiresAt: new Date() } });
      await prisma.user.update({ where: { id: who.id }, data: { twoFactorEnabled: true } });
      expect((await adminList.GET(request(who, "/admin/vendors"))).status).toBe(428);
      await prisma.session.updateMany({ where: { userId: who.id }, data: { mfaVerifiedAt: new Date(), mfaMethod: "totp" } });
    }
    expect((await adminList.GET(request(admin, "/admin/vendors"))).status).toBe(200);
    expect((await adminList.GET(request(admin, "/admin/vendors", "GET", undefined, "isolation-fixture.test"))).status).toBe(401);
    expect((await decide("approve", appId, reviewer)).status).toBe(403);
  });
  it("supports review, changes-requested and a new resubmission revision", async () => {
    expect((await decide("start-review")).status).toBe(200);
    expect((await decide("request-changes")).status).toBe(200);
    expect((await edit.PATCH(request(applicant, "/edit", "PATCH", { profile: { description: "Synthetic revision" } }), context())).status).toBe(200);
    expect((await submit.POST(request(applicant, "/submit", "POST"), context())).status).toBe(200);
    expect(await prisma.vendorSubmission.count({ where: { applicationId: appId } })).toBe(2);
    expect((await decide("start-review")).status).toBe(200);
  });
  it("approves idempotently, grants one owner assignment and revokes stale sessions", async () => {
    expect((await decide("approve")).status).toBe(200);
    expect((await decide("approve")).status).toBe(200);
    expect(await prisma.roleAssignment.count({ where: { vendorId, membershipId: applicant.membershipId, roleKey: "VENDOR_OWNER" } })).toBe(1);
    expect(await prisma.vendorDecision.count({ where: { applicationId: appId, toStatus: "APPROVED" } })).toBe(1);
    expect(await prisma.session.count({ where: { userId: applicant.id } })).toBe(0);
    await login(applicant);
  });
  it("fails closed without a bank key, encrypts stored profiles and masks every read", async () => {
    await prisma.rateLimit.deleteMany({ where: { key: { contains: applicant.id } } });
    const profile = { accountHolderName: "Synthetic Owner", bankName: "Synthetic Bank",
      accountNumber: randomBytes(12).toString("hex").replace(/[a-f]/g, "1"),
      routingIdentifier: "SYNTHETIC", accountType: "CURRENT", supportingDocumentId: documentId };
    vi.stubEnv("VENDOR_BANK_ENCRYPTION_KEY_VERSION", "audit");
    vi.stubEnv("VENDOR_BANK_ENCRYPTION_KEY_AUDIT", "");
    expect((await bank.POST(request(applicant, "/bank", "POST", { vendorId, profile, password }))).status).toBe(503);
    vi.stubEnv("VENDOR_BANK_ENCRYPTION_KEY_AUDIT", randomBytes(32).toString("base64"));
    const saved = await bank.POST(request(applicant, "/bank", "POST", { vendorId, profile, password }));
    expect(saved.status).toBe(200);
    expect(await saved.text()).not.toContain(profile.accountNumber);
    const stored = await prisma.vendorBankProfile.findUniqueOrThrow({ where: { vendorId_organizationId: { vendorId, organizationId: org } } });
    expect(stored.ciphertext).not.toContain(profile.accountNumber);
    expect(stored.lastFour).toBe(profile.accountNumber.slice(-4));
    expect(await (await bank.GET(request(applicant, "/bank"))).text()).toContain(`•••• ${stored.lastFour}`);
    expect(await (await bank.GET(request(stranger, "/bank"))).json()).toEqual({ profiles: [] });
    expect((await bank.POST(request(stranger, "/bank", "POST", { vendorId, profile, password }))).status).toBe(403);
  });
  it("creates invitations transactionally with hash-only tokens and redacted outbox payloads", async () => {
    await prisma.rateLimit.deleteMany({ where: { key: { contains: applicant.id } } });
    const response = await invitations.POST(request(applicant, "/staff", "POST", { vendorId, email: staff.email, permissionKeys: ["vendor.profile.manage"], password }));
    expect(response.status).toBe(201);
    const invite = (await response.json()).invitation;
    inviteToken = new URL(invite.link).pathname.split("/").at(-1)!;
    const stored = await prisma.vendorStaffInvitation.findUniqueOrThrow({ where: { id: invite.id } });
    expect(stored.tokenHash).not.toContain(inviteToken);
    expect(await prisma.outboxEvent.count({ where: { dedupeKey: `vendor.staff.invited:${invite.id}` } })).toBe(1);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBeLessThanOrEqual(72 * 60 * 60 * 1000);
  });
  it("denies invitation contact mismatch and cross-organisation acceptance, then permits one use", async () => {
    expect((await invitations.PUT(request(stranger, "/staff", "PUT", { token: inviteToken }))).status).toBe(403);
    expect((await invitations.PUT(request(staff, "/staff", "PUT", { token: inviteToken }, "isolation-fixture.test"))).status).toBe(409);
    expect((await invitations.PUT(request(staff, "/staff", "PUT", { token: inviteToken }))).status).toBe(200);
    expect((await invitations.PUT(request(staff, "/staff", "PUT", { token: inviteToken }))).status).toBe(409);
    expect(await prisma.roleAssignment.count({ where: { vendorId, membershipId: staff.membershipId, roleKey: "VENDOR_STAFF" } })).toBe(1);
  });
  it("rejects expired invitations without granting staff access", async () => {
    await prisma.rateLimit.deleteMany({ where: { key: { contains: applicant.id } } });
    const response = await invitations.POST(request(applicant, "/staff", "POST", { vendorId, email: stranger.email, password }));
    const invite = (await response.json()).invitation;
    await prisma.vendorStaffInvitation.update({ where: { id: invite.id }, data: { expiresAt: new Date(0) } });
    expect((await invitations.PUT(request(stranger, "/staff", "PUT", { token: new URL(invite.link).pathname.split("/").at(-1) }))).status).toBe(409);
  });
  it("revokes staff sessions on permission reduction and on removal", async () => {
    await prisma.vendorStaffPermission.create({ data: { organizationId: org, vendorId, membershipId: staff.membershipId, permissionKey: "vendor.bank.manage", grantedByMembershipId: applicant.membershipId } });
    await prisma.rateLimit.deleteMany({ where: { key: { contains: applicant.id } } });
    expect((await permissions.PATCH(request(applicant, "/permissions", "PATCH", { vendorId, permissionKeys: [], password }), { params: Promise.resolve({ membershipId: staff.membershipId }) })).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: staff.id } })).toBe(0);
    expect(await prisma.vendorStaffPermission.count({ where: { vendorId, membershipId: staff.membershipId, permissionKey: "vendor.profile.manage" } })).toBe(1);
    await login(staff);
    expect((await revoke.DELETE(request(applicant, "/staff", "DELETE", { vendorId, password }), { params: Promise.resolve({ membershipId: staff.membershipId }) })).status).toBe(200);
    expect(await prisma.session.count({ where: { userId: staff.id } })).toBe(0);
    expect(await prisma.roleAssignment.count({ where: { vendorId, membershipId: staff.membershipId } })).toBe(0);
  });
  it("denies suspended and pending vendor capabilities and permits reactivation", async () => {
    expect((await invitations.POST(request(stranger, "/staff", "POST", { vendorId, email: staff.email, password }))).status).toBe(403);
    expect((await decide("suspend")).status).toBe(200);
    await login(applicant);
    expect((await invitations.POST(request(applicant, "/staff", "POST", { vendorId, email: staff.email, password }))).status).toBe(403);
    expect((await edit.PATCH(request(applicant, "/edit", "PATCH", { profile: { storeName: "Denied" } }), context())).status).toBe(409);
    expect((await decide("reactivate")).status).toBe(200);
    await login(applicant);
  });
  it("rejects applications and denies rejected vendor capabilities", async () => {
    const response = await applications.POST(request(stranger, "/applications", "POST", { profile: profile(stranger.email) }));
    const application = (await response.json()).application;
    vendorIds.push(application.vendorId);
    expect((await submit.POST(request(stranger, "/submit", "POST"), context(application.id))).status).toBe(200);
    expect((await decide("start-review", application.id)).status).toBe(200);
    expect((await decide("reject", application.id)).status).toBe(200);
    await login(stranger);
    expect((await invitations.POST(request(stranger, "/staff", "POST", { vendorId: application.vendorId, email: staff.email, password }))).status).toBe(403);
  });
  it("keeps audit/outbox metadata free of KYC profiles, bank ciphertext and bearer tokens", async () => {
    const audit = await prisma.vendorAuditEvent.findMany({ where: { vendorId: { in: vendorIds } }, select: { metadata: true } });
    const events = await prisma.outboxEvent.findMany({ where: { organizationId: org, OR: vendorIds.map((value) => ({ payload: { path: ["vendorId"], equals: value } })) }, select: { payload: true } });
    const serialized = JSON.stringify([...audit, ...events]);
    for (const disallowed of ["accountNumber", "ciphertext", "profileSnapshot", "Synthetic test address", "Synthetic Verification Company", staff.email, inviteToken, password]) {
      expect(serialized).not.toContain(disallowed);
    }
    expect(otherOrg).not.toBe(org);
  });
});
