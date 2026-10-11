import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import pg from "pg";

if (process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Migration verification refuses published deployments");
const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("Development database required");
const pool = new pg.Pool({ connectionString });
const schema = `m03_upgrade_${randomUUID().replaceAll("-", "")}`;
const temporary = await mkdtemp(path.join(os.tmpdir(), "m03-migrate-"));
const databaseDir = path.resolve("packages/database");
const migrations = path.join(temporary, "migrations");
const config = path.join(temporary, "config.ts");
const url = new URL(connectionString);
url.searchParams.set("schema", schema);
const run = promisify(execFile);
async function prisma(args: string[], isolated = true) {
  try {
    return await run("pnpm", ["exec", "prisma", ...args, "--config", isolated ? config : "prisma.config.ts"], {
      cwd: databaseDir,
      env: { ...process.env, ...(isolated ? { DATABASE_URL: url.toString() } : {}) },
      maxBuffer: 1024 * 1024,
    });
  } catch {
    throw new Error("Migration/drift command failed; database connection details redacted");
  }
}
try {
  await mkdir(migrations);
  for (const name of ["20261010171415_m01_foundation", "20261010194554_m02_identity_access"]) {
    await cp(path.join(databaseDir, "prisma/migrations", name), path.join(migrations, name), { recursive: true });
  }
  await cp(path.join(databaseDir, "prisma/migrations/migration_lock.toml"), path.join(migrations, "migration_lock.toml"));
  await writeFile(config, `export default { schema: ${JSON.stringify(path.join(databaseDir, "prisma/schema.prisma"))}, migrations: { path: ${JSON.stringify(migrations)} }, datasource: { url: process.env.DATABASE_URL } };\n`);
  await pool.query(`CREATE SCHEMA "${schema}"`);
  await prisma(["migrate", "deploy"]);
  const orgId = randomUUID();
  const userId = `synthetic-upgrade-${randomUUID()}`;
  const membershipId = randomUUID();
  await pool.query(`INSERT INTO "${schema}"."Organization" ("id","key","displayName","locale","currency","timeZone","coreVersion","config","updatedAt") VALUES ($1,'synthetic-m02-upgrade','Synthetic upgrade','en-IN','INR','Asia/Kolkata','0.1.0','{}',now())`, [orgId]);
  await pool.query(`INSERT INTO "${schema}"."User" ("id","name","email","emailVerified","createdAt","updatedAt") VALUES ($1,'Synthetic upgrade identity',$2,false,now(),now())`, [userId, `${userId}@example.invalid`]);
  await pool.query(`INSERT INTO "${schema}"."OrganizationMembership" ("id","organizationId","userId","updatedAt") VALUES ($1,$2,$3,now())`, [membershipId, orgId, userId]);
  await cp(path.join(databaseDir, "prisma/migrations/20261011203000_m03_vendor_onboarding"), path.join(migrations, "20261011203000_m03_vendor_onboarding"), { recursive: true });
  await prisma(["migrate", "deploy"]);
  assert.equal((await pool.query(`SELECT "displayName" FROM "${schema}"."Organization" WHERE "id"=$1`, [orgId])).rows[0].displayName, "Synthetic upgrade");
  assert.equal((await pool.query(`SELECT "userId" FROM "${schema}"."OrganizationMembership" WHERE "id"=$1`, [membershipId])).rows[0].userId, userId);
  assert.equal((await pool.query(`SELECT "emailVerified" FROM "${schema}"."User" WHERE "id"=$1`, [userId])).rows[0].emailVerified, false);
  assert.equal((await pool.query(`SELECT count(*)::int AS count FROM "${schema}"."_prisma_migrations" WHERE "finished_at" IS NOT NULL`)).rows[0].count, 3);
  console.log("PASS: existing M02 schema upgrades to M03; synthetic organization, identity and membership preserved");
  await prisma(["migrate", "diff", "--from-config-datasource", "--to-schema", path.join(databaseDir, "prisma/schema.prisma"), "--exit-code"]);
  console.log("PASS: upgraded disposable schema has no Prisma schema drift");
  await prisma(["migrate", "diff", "--from-config-datasource", "--to-schema", "prisma/schema.prisma", "--exit-code"], false);
  console.log("PASS: current development schema has no Prisma schema drift");
} catch (error) {
  throw new Error(error instanceof assert.AssertionError
    ? "M03 migration/seed assertion failed; synthetic verification only"
    : "M03 upgrade/drift verification failed; connection details redacted");
} finally {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
  await rm(temporary, { recursive: true, force: true });
}
