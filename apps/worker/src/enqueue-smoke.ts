import { PgBoss } from "pg-boss";
import { prisma } from "@workspace/database";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is required");

const organization = await prisma.organization.findUnique({
  where: { key: "euro-infotech" },
  select: { id: true },
});
if (!organization) throw new Error("Run the development seed first");

const jobKey = `restart-smoke-${new Date().toISOString()}`;
const boss = new PgBoss({
  connectionString,
  schema: "pgboss",
  application_name: "nextb-commerce-smoke-enqueue",
});

try {
  await boss.start();
  await boss.createQueue("foundation.smoke");
  await boss.send(
    "foundation.smoke",
    { organizationId: organization.id, jobKey },
    { singletonKey: jobKey },
  );
  console.log(JSON.stringify({ event: "smoke_job_enqueued", jobKey }));
} finally {
  await boss.stop({ graceful: true });
  await prisma.$disconnect();
}
