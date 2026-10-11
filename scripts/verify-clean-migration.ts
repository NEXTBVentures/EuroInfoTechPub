import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import pg from "pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL required");
if (process.env.REPLIT_DEPLOYMENT === "1") {
  throw new Error("Clean-schema migration verification refuses published deployments");
}
const pool = new pg.Pool({ connectionString });
const schema = `m01_verify_${randomUUID().replaceAll("-", "")}`;
const url = new URL(connectionString);
url.searchParams.set("schema", schema);
try {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const result = await promisify(execFile)("pnpm", [
    "--filter", "@workspace/database", "db:migrate",
  ], { env: { ...process.env, DATABASE_URL: url.toString() } });
  if (!result.stdout.includes("successfully applied")) throw new Error("Clean migration did not apply");
  const tables = await pool.query(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = $1",
    [schema],
  );
  const names = new Set(tables.rows.map((row) => row.table_name));
  for (const required of [
    "Organization", "OutboxEvent", "User", "Session", "RoleAssignment",
    "AdminTotpCredential", "PhoneOtpChallenge", "Vendor", "VendorApplication",
    "VendorDocument", "VendorDecision", "VendorStaffInvitation", "VendorBankProfile",
    "VendorAuditEvent",
  ]) {
    if (!names.has(required)) throw new Error(`Required table missing: ${required}`);
  }
  console.log("PASS: M01, M02 and M03 additive migrations apply to an empty disposable PostgreSQL schema");
} catch {
  throw new Error("Clean-schema migration verification failed (connection details redacted)");
} finally {
  await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
  await pool.end();
}
