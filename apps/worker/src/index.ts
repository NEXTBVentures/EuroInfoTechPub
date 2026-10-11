import { PostgresQueue } from "@workspace/adapters";
import { prisma } from "@workspace/database";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");
const queue = new PostgresQueue(connectionString);
const heartbeatId = "foundation-worker";
const startedAt = new Date();
let stopping = false;
let polling = false;

function log(event: string) {
  console.log(JSON.stringify({ event, service: "worker", at: new Date().toISOString() }));
}
async function heartbeat() {
  await prisma.workerHeartbeat.upsert({
    where: { id: heartbeatId },
    create: { id: heartbeatId, startedAt, lastSeenAt: new Date(), version: "0.1.0" },
    update: { startedAt, lastSeenAt: new Date(), version: "0.1.0" },
  });
}
async function dispatchOutbox() {
  if (polling || stopping) return;
  polling = true;
  try {
    const events = await prisma.outboxEvent.findMany({
      where: { publishedAt: null, eventType: "foundation.smoke" },
      orderBy: { createdAt: "asc" }, take: 20,
    });
    for (const event of events) {
      const payload = event.payload as { jobKey?: unknown };
      if (typeof payload.jobKey !== "string" || !payload.jobKey) {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: { attempts: { increment: 1 }, lastError: "invalid_smoke_payload" },
        });
        continue;
      }
      try {
        await queue.enqueue("foundation.smoke", {
          organizationId: event.organizationId, jobKey: payload.jobKey,
        }, `${event.organizationId}:${event.dedupeKey}`);
        await prisma.outboxEvent.updateMany({
          where: { id: event.id, publishedAt: null },
          data: { publishedAt: new Date(), attempts: { increment: 1 }, lastError: null },
        });
      } catch {
        await prisma.outboxEvent.update({
          where: { id: event.id },
          data: { attempts: { increment: 1 }, lastError: "queue_publish_failed" },
        });
        log("outbox_dispatch_failed");
      }
    }
    const vendorEvents = await prisma.outboxEvent.findMany({
      where: { publishedAt: null, lastError: null, eventType: { startsWith: "vendor." } },
      orderBy: { createdAt: "asc" }, take: 100,
      select: { id: true },
    });
    for (const event of vendorEvents) {
      await prisma.outboxEvent.updateMany({
        where: { id: event.id, publishedAt: null, lastError: null },
        data: { lastError: "vendor_notification_provider_not_configured" },
      });
    }
    if (vendorEvents.length) log("vendor_notification_provider_not_configured");
  } finally { polling = false; }
}
async function start() {
  await queue.start();
  await queue.consume("foundation.smoke", async ({ organizationId, jobKey }) => {
    await prisma.smokeJobEffect.upsert({
      where: { organizationId_jobKey: { organizationId, jobKey } },
      create: { organizationId, jobKey }, update: {},
    });
    log("smoke_job_completed");
  });
  await heartbeat();
  const heartbeatTimer = setInterval(() => {
    void heartbeat().catch(() => log("heartbeat_failed"));
  }, 5_000);
  const outboxTimer = setInterval(() => {
    void dispatchOutbox().catch(() => log("outbox_poll_failed"));
  }, 2_000);
  await dispatchOutbox();
  log("worker_started");
  const shutdown = async () => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeatTimer);
    clearInterval(outboxTimer);
    await queue.stop();
    await prisma.workerHeartbeat.deleteMany({ where: { id: heartbeatId } });
    await prisma.$disconnect();
    process.exit(0);
  };
  process.once("SIGINT", () => void shutdown());
  process.once("SIGTERM", () => void shutdown());
}
start().catch(async () => {
  log("worker_start_failed");
  await prisma.$disconnect();
  process.exit(1);
});
