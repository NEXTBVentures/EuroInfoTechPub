import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, unlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { chromium, expect as baseExpect, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@workspace/database";
import { generateTotpSecret, encryptTotpSecret, totpCodeAt } from "../src/lib/totp";

const expect = baseExpect.configure({ timeout: 30_000 });

if (process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Browser fixtures refuse published deployments");
const base = process.env.E2E_BASE_URL || `https://${process.env.REPLIT_DEV_DOMAIN}`;
const password = `Synthetic-browser-${randomBytes(24).toString("hex")}`;
const suffix = randomUUID();
const secret = generateTotpSecret();
const ids: string[] = [];
const vendorIds: string[] = [];
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath) {
  try { executablePath = execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(); } catch { /* managed browser */ }
}
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const errors: string[] = [];
async function signIn(page: Page, email: string, expected = /\/account$/) {
  await page.goto(`${base}/login`);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(expected, { timeout: 30_000 });
}
try {
  const org = await prisma.organization.findUniqueOrThrow({ where: { key: "euro-infotech" } });
  async function actor(roleKey: string) {
    const id = `m03-browser-${suffix}-${randomUUID()}`;
    ids.push(id);
    const email = `${id}@example.invalid`;
    await prisma.user.create({ data: { id, email, name: "Synthetic M03 browser fixture", emailVerified: true } });
    await prisma.account.create({ data: { id: randomUUID(), userId: id, accountId: id, providerId: "credential", password: await hashPassword(password) } });
    const membership = await prisma.organizationMembership.create({ data: { organizationId: org.id, userId: id } });
    await prisma.roleAssignment.create({ data: { organizationId: org.id, membershipId: membership.id, roleKey } });
    return { id, email };
  }
  const applicant = await actor("CUSTOMER");
  const admin = await actor("ORGANISATION_OWNER");
  const customerContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const adminContext = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await customerContext.newPage();
  const adminPage = await adminContext.newPage();
  for (const p of [page, adminPage]) p.on("pageerror", (error) => errors.push(error.message));
  await signIn(page, applicant.email);
  await page.goto(`${base}/vendor`);
  await page.getByLabel("Legal company name *", { exact: true }).fill(`Synthetic Browser ${suffix}`);
  await page.getByLabel("Business contact email *", { exact: true }).fill(applicant.email);
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.getByRole("button", { name: "Submit for review" })).toBeEnabled();
  const draft = await (await customerContext.request.get(`${base}/api/v1/vendor/applications`)).json();
  vendorIds.push(draft.application.vendorId);
  await page.reload();
  await expect(page.getByLabel("Legal company name *", { exact: true })).toHaveValue(`Synthetic Browser ${suffix}`);
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator(".v-note.error")).toContainText("application_incomplete");
  await page.getByLabel("Store / trading name *", { exact: true }).fill(`Synthetic Store ${suffix}`);
  await page.getByLabel("Business contact email *", { exact: true }).fill(applicant.email);
  await page.getByLabel("Address line 1 *", { exact: true }).fill("Synthetic fixture address");
  await page.getByLabel("City *", { exact: true }).fill("Test City");
  await page.getByLabel("Postal code *", { exact: true }).fill("000000");
  await page.getByLabel(/^Country code \*/).fill("IN");
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  await expect(page.locator(".v-note.success")).toBeVisible();
  await page.getByLabel("Document category *", { exact: true }).fill("identity");
  await page.getByLabel(/^Select file \*/).setInputFiles({ name: "synthetic.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.7\nsynthetic browser evidence") });
  await page.getByRole("button", { name: "Upload private document" }).click();
  await expect(page.getByRole("button", { name: "Authenticated download" })).toBeVisible();
  const response = page.waitForResponse((r) => r.url().includes("/api/v1/vendor/documents/") && r.request().method() === "GET");
  await page.getByRole("button", { name: "Authenticated download" }).click();
  assert.equal((await response).status(), 200);
  await mkdir("../../generated-artifacts", { recursive: true });
  for (const width of [1280, 402]) {
    await page.setViewportSize({ width, height: 874 });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ path: `../../generated-artifacts/m03-vendor-${width}.jpg`, type: "jpeg" });
  }
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator(".v-head .v-status")).toHaveText("Submitted");
  await signIn(adminPage, admin.email, /\/security\/totp/);
  await prisma.adminTotpCredential.create({ data: { userId: admin.id, secretCiphertext: encryptTotpSecret(secret), verifiedAt: new Date(), setupExpiresAt: new Date() } });
  await prisma.user.update({ where: { id: admin.id }, data: { twoFactorEnabled: true } });
  await prisma.session.updateMany({ where: { userId: admin.id }, data: { mfaVerifiedAt: new Date(), mfaMethod: "totp" } });
  await adminPage.goto(`${base}/admin`);
  await adminPage.getByLabel("Filter applications", { exact: true }).selectOption("ALL");
  await adminPage.locator(".v-app-item").filter({ hasText: `Synthetic Store ${suffix}` }).click();
  const form = adminPage.locator("form").filter({ has: adminPage.getByRole("heading", { name: "Record a review action" }) });
  async function decision(action: string) {
    await prisma.rateLimit.deleteMany({ where: { key: { contains: admin.id } } });
    await prisma.adminTotpCredential.update({ where: { userId: admin.id }, data: { lastAcceptedStep: null } });
    await form.locator("select").selectOption(action);
    await form.getByLabel("Internal reason (required) *", { exact: true }).fill("Synthetic browser review");
    await form.getByLabel(/^Vendor-facing message/).fill("Synthetic review update");
    await form.getByLabel("Administrator password *", { exact: true }).fill(password);
    await form.getByLabel("Authenticator code (if prompted)", { exact: true }).fill(totpCodeAt(secret, Date.now()).code);
    const response = adminPage.waitForResponse((r) => r.url().endsWith("/decision") && r.request().method() === "POST");
    await form.getByRole("button", { name: /Record/ }).click();
    assert.equal((await response).status(), 200);
    await expect(adminPage.locator(".v-note.success")).toContainText("Decision recorded");
    await expect(form.getByRole("button", { name: /Record/ })).not.toHaveText("Recording…");
    await expect(form.getByLabel("Administrator password *", { exact: true })).toHaveValue("");
  }
  await decision("start-review");
  await decision("request-changes");
  await page.reload();
  await expect(page.locator(".v-head .v-status")).toHaveText("Changes Required");
  await page.getByRole("button", { name: "Submit for review" }).click();
  await expect(page.locator(".v-head .v-status")).toHaveText("Submitted");
  await adminPage.reload();
  await adminPage.getByLabel("Filter applications", { exact: true }).selectOption("ALL");
  await adminPage.locator(".v-app-item").filter({ hasText: `Synthetic Store ${suffix}` }).click();
  await decision("start-review");
  for (const width of [1280, 402]) {
    await adminPage.setViewportSize({ width, height: 874 });
    await expect.poll(() => adminPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await adminPage.screenshot({ path: `../../generated-artifacts/m03-admin-${width}.jpg`, type: "jpeg" });
  }
  await decision("approve");
  await signIn(page, applicant.email);
  await page.goto(`${base}/vendor`);
  await expect(page.getByRole("heading", { name: "Vendor profile", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Save store profile" }).click();
  await expect(page.locator(".v-note.success")).toBeVisible();
  await page.goto(`${base}/account`);
  await page.getByRole("button", { name: "Sign out", exact: true }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.goBack();
  await expect(page).toHaveURL(/\/login/);
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Vendor profile", exact: true })).toHaveCount(0);
  assert.deepEqual(errors, []);
  console.log("PASS: 8 M03 browser scenario groups: draft/persistence, incomplete submission, KYC upload/download, submission, admin changes/resubmission/approval, approved profile, desktop/mobile, logout history protection");
} finally {
  await browser.close();
  const applications = await prisma.vendorApplication.findMany({ where: { applicantMembership: { userId: { in: ids } } }, select: { id: true, vendorId: true } });
  const vendors = [...new Set([...vendorIds, ...applications.map((a) => a.vendorId)])];
  if (vendors.length) {
    const where = { vendorId: { in: vendors } };
    const documents = await prisma.vendorDocument.findMany({ where, select: { storageKey: true } });
    for (const doc of documents) {
      if (/^[0-9a-f-]{36}\.(pdf|png|jpg)$/.test(doc.storageKey)) await unlink(path.join(process.env.VENDOR_DOCUMENT_STORAGE_DIR ?? path.join(os.tmpdir(), "euroinfo-private-vendor-documents"), doc.storageKey)).catch(() => undefined);
    }
    await prisma.vendorStaffPermission.deleteMany({ where });
    await prisma.vendorStaffInvitation.deleteMany({ where });
    await prisma.vendorBankProfile.deleteMany({ where });
    await prisma.vendorAuditEvent.deleteMany({ where });
    await prisma.vendorDecision.deleteMany({ where });
    await prisma.vendorSubmission.deleteMany({ where: { applicationId: { in: applications.map((a) => a.id) } } });
    await prisma.vendorDocument.updateMany({ where, data: { supersedesId: null } });
    await prisma.vendorDocument.deleteMany({ where });
    await prisma.vendorApplication.deleteMany({ where });
    await prisma.outboxEvent.deleteMany({ where: { OR: vendors.map((id) => ({ payload: { path: ["vendorId"], equals: id } })) } });
    await prisma.vendor.deleteMany({ where: { id: { in: vendors } } });
  }
  await prisma.authAuditEvent.deleteMany({ where: { actorUserId: { in: ids } } });
  await prisma.rateLimit.deleteMany({ where: { OR: ids.map((id) => ({ key: { contains: id } })) } });
  await prisma.user.deleteMany({ where: { id: { in: ids } } });
  await prisma.$disconnect();
}
