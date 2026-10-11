import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, expect as baseExpect } from "@playwright/test";

const expect = baseExpect.configure({ timeout: 30_000 });
import { hashPassword } from "better-auth/crypto";
import { prisma } from "@workspace/database";
import { totpCodeAt } from "../src/lib/totp";

if (process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Browser fixture creation is forbidden on production");
}
const base = process.env.E2E_BASE_URL || (process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:3000");
const id = `browser-m02-${randomUUID()}`;
const password = `Browser-${randomBytes(20).toString("hex")}`;
const email = `${id}@example.invalid`;
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath) {
  try { executablePath = execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(); }
  catch { /* Playwright-managed Chromium is used in CI. */ }
}
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
const errors: string[] = [];
try {
  const organization = await prisma.organization.findUniqueOrThrow({ where: { key: "euro-infotech" } });
  await prisma.user.create({ data: { id, name: "M02 browser fixture", email, emailVerified: true } });
  await prisma.account.create({ data: {
    id: randomUUID(), userId: id, providerId: "credential", accountId: id,
    password: await hashPassword(password),
  } });
  const member = await prisma.organizationMembership.create({ data: { userId: id, organizationId: organization.id } });
  await prisma.roleAssignment.create({ data: { organizationId: organization.id, membershipId: member.id, roleKey: "CUSTOMER" } });

  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  page.on("pageerror", (error) => errors.push(error.message));
  for (const path of ["/account", "/vendor", "/admin"]) {
    await page.goto(`${base}${path}`);
    await expect(page).toHaveURL(/\/login\?returnTo=/);
  }
  await page.goto(`${base}/login`);
  await page.getByLabel("Email", { exact: true }).fill("not-an-email");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page.locator(".id-alert.error")).toContainText("valid email");
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Your account" })).toBeVisible();
  await page.goto(`${base}/admin`);
  await expect(page).toHaveURL(/\/access-denied/);
  await page.goto(`${base}/vendor`);
  await expect(page).toHaveURL(/\/vendor$/);
  await expect(page.getByRole("heading", { name: "Vendor onboarding" })).toBeVisible();
  await page.getByLabel("Legal company name *").fill(`Browser Vendor ${id}`);
  await page.getByLabel("Store / trading name *").fill(`Browser Store ${id}`);
  await page.getByLabel("Business contact email *").fill(`vendor-${id}@example.invalid`);
  const draftResponse = page.waitForResponse((response) =>
    response.url().endsWith("/api/v1/vendor/applications") && response.request().method() === "POST",
  );
  await page.getByRole("button", { name: "Save draft", exact: true }).click();
  assert.equal((await draftResponse).ok(), true, "Customer can save a vendor application draft");
  await expect(page.getByLabel("Legal company name *")).toHaveValue(`Browser Vendor ${id}`);
  await page.reload();
  await expect(page.getByLabel("Legal company name *")).toHaveValue(`Browser Vendor ${id}`);
  await expect(page.getByRole("button", { name: "Upload private document" })).toBeEnabled();

  // A real second session is created through the HTTP authentication endpoint.
  const extra = await fetch(`${base}/api/auth/sign-in/email`, {
    method: "POST", headers: { origin: new URL(base).origin, "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  assert.equal(extra.status, 200);
  await page.goto(`${base}/account/security`);
  await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();
  await page.getByRole("button", { name: "Revoke", exact: true }).first().click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Revoke session", exact: true }).click();
  await expect(page.locator(".id-alert.success")).toContainText("Session revoked.");
  await expect(page.getByRole("button", { name: "Revoke", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Sign out everywhere" }).click();
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign out all", exact: true }).click();
  // The destination URL can change before its client submit handler hydrates.
  await page.waitForURL(/\/login/, { waitUntil: "load" });
  await expect(page).toHaveURL(/\/login/);
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/account$/);

  await page.goto(`${base}/security/totp?mode=setup&returnTo=/account/security`);
  await page.getByLabel("Confirm your password", { exact: true }).fill(password);
  const enrolResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/identity/security") && response.request().method() === "POST");
  await page.getByRole("button", { name: /Continue|Set up|Create setup|Generate|Start setup/i }).click();
  const setup = await (await enrolResponse).json() as { secret: string };
  assert.equal(typeof setup.secret, "string");
  await page.getByLabel("6-digit code", { exact: true }).fill(totpCodeAt(setup.secret, Date.now()).code);
  const verifyResponse = page.waitForResponse((response) => response.url().endsWith("/api/v1/identity/security") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Verify and turn on" }).click();
  const verified = await (await verifyResponse).json() as { recoveryCodes: string[] };
  assert.equal(verified.recoveryCodes.length, 10);
  await expect(page.getByRole("list", { name: "Recovery codes" })).toBeVisible();
  await expect(page.getByLabel("Manual setup key")).toHaveCount(0);
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: /Continue/ }).click();
  await expect(page).toHaveURL(/\/account\/security/);
  await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();

  // Authorized fixture provisioning; no vendor-approval workflow or production data.
  await prisma.roleAssignment.create({ data: { organizationId: organization.id, membershipId: member.id, roleKey: "ORGANISATION_OWNER" } });
  await prisma.session.updateMany({ where: { userId: id }, data: { mfaVerifiedAt: null, mfaMethod: null } });
  await page.goto(`${base}/admin`);
  await expect(page).toHaveURL(/\/security\/totp\?mode=challenge/);
  await page.getByRole("button", { name: /Use a recovery code/ }).click();
  await page.getByLabel("Recovery code", { exact: true }).fill(verified.recoveryCodes[0]!);
  await page.getByRole("button", { name: "Use recovery code", exact: true }).click();
  await expect(page).toHaveURL(/\/admin$/);
  await expect(page.getByRole("heading", { name: "Organisation access" })).toBeVisible();

  await page.goto(`${base}/account`);
  await page.goto(`${base}/account/security`);
  await expect(page.getByRole("heading", { name: "Active sessions" })).toBeVisible();
  await page.getByRole("button", { name: "Sign out", exact: true }).first().click();
  await expect(page).toHaveURL(/\/login/);
  await page.goBack();
  await expect(page).toHaveURL(/\/login/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { name: "Your account" })).toHaveCount(0);
  await page.goForward();
  await expect(page.getByRole("heading", { name: "Organisation access" })).toHaveCount(0);

  for (const width of [1280, 402]) {
    await page.setViewportSize({ width, height: 874 });
    for (const path of ["/login", "/register", "/phone-login", "/verify-email", "/forgot-password", "/reset-password", "/security/totp?mode=setup", "/access-denied"]) {
      await page.goto(`${base}${path}`);
      await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await expect(page.locator("h1,h2").first()).toBeVisible();
    }
    await page.goto(`${base}/login`);
    await mkdir("../../generated-artifacts", { recursive: true });
    await page.screenshot({ path: `../../generated-artifacts/m02-${width === 402 ? "mobile" : "desktop"}.jpg`, type: "jpeg", quality: 80 });
  }
  assert.deepEqual(errors, []);
  console.log("PASS: M02 authentication/session/TOTP browser coverage and M03 customer vendor-draft save/reload flow; admin access denied to customer; no page errors");
} finally {
  await browser.close();
  const membership = await prisma.organizationMembership.findFirst({
    where: { userId: id }, select: { id: true },
  });
  if (membership) {
    const applications = await prisma.vendorApplication.findMany({
      where: { applicantMembershipId: membership.id },
      select: { id: true, vendorId: true },
    });
    const applicationIds = applications.map((application) => application.id);
    const vendorIds = [...new Set(applications.map((application) => application.vendorId))];
    if (applicationIds.length) {
      await prisma.vendorDecision.deleteMany({ where: { applicationId: { in: applicationIds } } });
      await prisma.vendorSubmission.deleteMany({ where: { applicationId: { in: applicationIds } } });
      await prisma.vendorDocument.deleteMany({ where: { applicationId: { in: applicationIds } } });
    }
    if (vendorIds.length) {
      await prisma.vendorStaffInvitation.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.vendorStaffPermission.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.vendorBankProfile.deleteMany({ where: { vendorId: { in: vendorIds } } });
      await prisma.vendorAuditEvent.deleteMany({ where: { vendorId: { in: vendorIds } } });
    }
    if (applicationIds.length) await prisma.vendorApplication.deleteMany({ where: { id: { in: applicationIds } } });
    if (vendorIds.length) await prisma.vendor.deleteMany({ where: { id: { in: vendorIds } } });
  }
  await prisma.authAuditEvent.deleteMany({ where: { actorUserId: id } });
  await prisma.user.deleteMany({ where: { id } });
  await prisma.rateLimit.deleteMany({ where: { key: { contains: id } } });
  await prisma.$disconnect();
}
