import assert from "node:assert/strict";
import { get } from "node:http";

const base = process.env.E2E_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:3000");
async function request(path: string) {
  return fetch(`${base}${path}`);
}
const page = await request("/");
assert.equal(page.status, 200);
assert.match(await page.text(), /Euro Infotech|foundation/i);
const health = await request("/api/healthz");
assert.deepEqual(await health.json(), { status: "ok" });
const configResponse = await request("/api/v1/public-config");
assert.equal(configResponse.status, 200);
const config = await configResponse.json();
assert.equal(config.clientKey, "euro-infotech");
assert.equal(config.productionReady, false);
assert.equal(config.modules.filter((m: { enabled: boolean }) => m.enabled).length, 3);
assert.equal(Object.hasOwn(config, "providers"), false);
// Node's fetch may strip Host. Use HTTP directly, not the preview routing proxy.
const directBase = process.env.E2E_DIRECT_URL ??
  (base.startsWith("http://127.0.0.1") ? base : `http://127.0.0.1:${process.env.PORT ?? 3000}`);
const unknownStatus = await new Promise<number>((resolve, reject) => {
  get(`${directBase}/api/v1/public-config`, { headers: { Host: "unknown-m01.invalid" } }, (response) => {
    response.resume();
    resolve(response.statusCode ?? 0);
  }).on("error", reject);
});
assert.equal(unknownStatus, 404, "Unknown domain must fail closed without explicit development override");
for (const route of ["/admin", "/account", "/vendor"]) {
  const response = await fetch(`${base}${route}`, { redirect: "manual" });
  assert.equal(response.status, 307, `Anonymous ${route} must redirect to sign in`);
  assert.match(response.headers.get("location") ?? "", /^\/login\?returnTo=/);
}
const ready = await request("/api/readyz");
assert.equal(ready.status, 200, "Worker and database must be ready for E2E gate");
assert.equal((await ready.json()).ready, true);
console.log("PASS: shell HTML, public configuration allowlist, health/readiness, unknown domain, private routes");
