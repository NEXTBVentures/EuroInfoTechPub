import { NextResponse } from "next/server";
import { readinessSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";

export const dynamic = "force-dynamic";

export async function GET() {
  let databaseReady = false;
  let migrationsReady = false;
  let workerReady = false;

  try {
    await prisma.$queryRaw`SELECT 1`;
    databaseReady = true;
    const applied = await prisma.$queryRaw<Array<{ migration_name: string; finished_at: Date | null }>>`
      SELECT migration_name, finished_at
      FROM "_prisma_migrations"
      WHERE rolled_back_at IS NULL
    `;
    const requiredMigrations = ["20261010171415_m01_foundation", "20261010194554_m02_identity_access"];
    migrationsReady = applied.every((migration) => migration.finished_at !== null) &&
      requiredMigrations.every((required) => applied.some((migration) => migration.migration_name === required));
    const heartbeat = await prisma.workerHeartbeat.findUnique({
      where: { id: "foundation-worker" },
      select: { lastSeenAt: true },
    });
    workerReady = Boolean(
      heartbeat && Date.now() - heartbeat.lastSeenAt.getTime() < 30_000,
    );
  } catch {
    // Readiness is intentionally non-diagnostic; details belong in redacted server logs.
  }

  const result = readinessSchema.parse({
    ready: databaseReady && migrationsReady && workerReady,
    checks: {
      database: databaseReady ? "ready" : "not_ready",
      migrations: migrationsReady ? "ready" : "not_ready",
      worker: workerReady ? "ready" : "not_ready",
    },
  });
  return NextResponse.json(result, { status: result.ready ? 200 : 503 });
}
