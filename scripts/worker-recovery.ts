import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { PostgresQueue } from "../packages/adapters/src/index";
import { prisma } from "../packages/database/src/client";

const url = process.env.E2E_BASE_URL ??
  (process.env.REPLIT_DEV_DOMAIN ? `https://${process.env.REPLIT_DEV_DOMAIN}` : "http://127.0.0.1:3000");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL required");
if (process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Worker recovery verification refuses published deployments");
}
const queue = new PostgresQueue(connectionString);
const jobKey = `recovery-${randomUUID()}`;
const vendorEventId = randomUUID();
let child: ChildProcess | undefined;
const org = await prisma.organization.findUniqueOrThrow({ where: { key: "euro-infotech" } });
async function waitUntil(check: () => Promise<boolean>, label: string) {
  const end = Date.now() + 60_000;
  while (Date.now() < end) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`Timeout: ${label}`);
}
function startWorker() {
  child = spawn(process.execPath, ["--import", "tsx", "apps/worker/src/index.ts"], {
    stdio: ["ignore", "inherit", "inherit"], detached: true,
  });
}
async function stopWorker() {
  if (!child?.pid || child.exitCode !== null) return;
  const current = child;
  await new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      if (current.pid) process.kill(-current.pid, "SIGKILL");
      reject(new Error("Worker did not shut down gracefully"));
    }, 15_000);
    current.once("exit", () => { clearTimeout(timer); resolve(); });
    if (current.pid) process.kill(-current.pid, "SIGTERM");
  });
  child = undefined;
}
async function ready() {
  return await fetch(`${url}/api/readyz`);
}
try {
  assert.equal(await prisma.workerHeartbeat.count({
    where: { lastSeenAt: { gt: new Date(Date.now() - 30_000) } },
  }), 0, "Stop the managed worker workflow before running recovery verification");
  await prisma.outboxEvent.create({
    data: {
      id: vendorEventId,
      organizationId: org.id,
      dedupeKey: `${jobKey}-vendor-notification`,
      eventType: "vendor.application.submitted",
      payload: { applicationId: randomUUID(), status: "SUBMITTED" },
    },
  });
  startWorker();
  await waitUntil(async () => (await ready()).status === 200, "initial worker readiness");
  await waitUntil(async () => {
    const event = await prisma.outboxEvent.findUnique({ where: { id: vendorEventId }, select: { lastError: true } });
    return event?.lastError === "vendor_notification_provider_not_configured";
  }, "vendor notification remains explicitly pending without a provider");
  const vendorEvent = await prisma.outboxEvent.findUniqueOrThrow({
    where: { id: vendorEventId }, select: { publishedAt: true },
  });
  assert.equal(vendorEvent.publishedAt, null, "Unconfigured vendor notifications must not be marked delivered");
  await stopWorker();
  assert.equal((await ready()).status, 503, "Readiness must detect stopped worker");
  await queue.start();
  await queue.enqueue("foundation.smoke", { organizationId: org.id, jobKey }, jobKey);
  assert.equal(await prisma.smokeJobEffect.count({ where: { jobKey } }), 0);
  startWorker();
  await waitUntil(async () => (await prisma.smokeJobEffect.count({ where: { jobKey } })) === 1, "persisted job recovery");
  await queue.enqueue("foundation.smoke", { organizationId: org.id, jobKey }, `${jobKey}-duplicate`);
  await waitUntil(async () => {
    const rows = await prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*) FROM pgboss.job
      WHERE name = 'foundation.smoke' AND data->>'jobKey' = ${jobKey} AND state = 'completed'
    `;
    return Number(rows[0]?.count) >= 2;
  }, "duplicate delivery completion");
  assert.equal(await prisma.smokeJobEffect.count({ where: { jobKey } }), 1);
  await stopWorker();
  startWorker();
  await waitUntil(async () => (await ready()).status === 200, "worker restart");
  assert.equal(await prisma.smokeJobEffect.count({ where: { jobKey } }), 1);
  console.log("PASS: stopped-worker readiness, durable queued job recovery, duplicate delivery single effect, restart, vendor delivery fail-closed");
} finally {
  await stopWorker();
  await queue.stop();
  await prisma.smokeJobEffect.deleteMany({ where: { jobKey } });
  await prisma.outboxEvent.deleteMany({ where: { id: vendorEventId } });
  await prisma.$disconnect();
}
