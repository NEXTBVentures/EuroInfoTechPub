import { execFileSync } from "node:child_process";
import { mkdir } from "node:fs/promises";
import { chromium, expect } from "@playwright/test";

const base = process.env.E2E_BASE_URL || (process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:3000");
let executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;
if (!executablePath) {
  try { executablePath = execFileSync("which", ["chromium"], { encoding: "utf8" }).trim(); }
  catch { /* Use Playwright-managed Chromium in CI. */ }
}
const browser = await chromium.launch({ executablePath, headless: true, args: ["--no-sandbox"] });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(base);
  const config = page.getByRole("region", { name: "Client configuration" });
  const readiness = page.getByRole("region", { name: "Service readiness" });
  await expect(config).toContainText("261002", { timeout: 30_000 });
  await expect(config).toContainText("INR");
  await expect(readiness.locator(".pill.ok")).toHaveCount(4);
  await expect(page.locator("li.mod")).toHaveCount(21);
  await page.getByRole("button", { name: /^Implemented/ }).click();
  await expect(page.locator("li.mod")).toHaveCount(3);
  await expect(page.locator("li.mod")).toContainText(["Enabled for this client", "Enabled for this client", "Enabled for this client"]);
  await page.getByRole("button", { name: /^Planned/ }).click();
  await expect(page.locator("li.mod")).toHaveCount(18);
  await expect(page.locator("li.mod small").first()).toHaveText("Planned, not available yet");
  await page.getByRole("button", { name: /^All/ }).click();
  await expect(page.locator("li.mod")).toHaveCount(21);
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(page.getByRole("button", { name: "Refresh status" })).toBeEnabled();

  await page.route("**/api/v1/public-config", (route) => route.abort("failed"));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(config.getByRole("alert")).toBeVisible();
  await page.unroute("**/api/v1/public-config");
  await config.getByRole("button", { name: "Retry" }).click();
  await expect(config).toContainText("261002");
  await expect(page.locator("li.mod")).toHaveCount(21);

  await page.route("**/api/readyz", (route) => route.fulfill({
    status: 503, contentType: "application/json",
    body: JSON.stringify({ ready: false, checks: { database: "ready", migrations: "ready", worker: "not_ready" } }),
  }));
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(readiness.locator(".overall .pill")).toHaveText("Not ready");
  await page.unroute("**/api/readyz");
  await page.getByRole("button", { name: "Refresh status" }).click();
  await expect(readiness.locator(".overall .pill")).toHaveText("Ready");
  await mkdir("generated-artifacts", { recursive: true });
  await page.screenshot({ path: "generated-artifacts/m01-desktop.jpg", type: "jpeg", quality: 80 });

  await page.setViewportSize({ width: 402, height: 874 });
  await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))
    .toBe(true);
  await page.getByRole("button", { name: /^Implemented/ }).click();
  await expect(page.locator("li.mod")).toHaveCount(3);
  await page.screenshot({ path: "generated-artifacts/m01-mobile.jpg", type: "jpeg", quality: 80 });
  expect(errors).toEqual([]);
  console.log("PASS: browser live data/readiness, filters, refresh, network failure/retry, 503 state, mobile layout; no page errors");
} finally {
  await browser.close();
}
