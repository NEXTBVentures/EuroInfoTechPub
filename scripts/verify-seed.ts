import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { prisma } from "../packages/database/src/client";

if (process.env.REPLIT_DEPLOYMENT === "1") throw new Error("Repeat-seed verification refuses published deployments");

async function snapshot() {
  return {
    orgs: await prisma.organization.findMany({ orderBy: { key: "asc" }, select: { id: true, key: true } }),
    domains: await prisma.domain.count(),
    settings: await prisma.organizationSetting.count(),
    modules: await prisma.moduleDefinition.count(),
    orgModules: await prisma.organizationModule.count(),
    outbox: await prisma.outboxEvent.count(),
    users: await prisma.user.count(),
    roles: await prisma.role.count(),
    permissions: await prisma.permission.count(),
    rolePermissions: await prisma.rolePermission.count(),
    memberships: await prisma.organizationMembership.count(),
    roleAssignments: await prisma.roleAssignment.count(),
  };
}
try {
  const before = await snapshot();
  for (let i = 0; i < 2; i++) {
    await promisify(execFile)("pnpm", ["db:seed:dev"]);
    assert.deepEqual(await snapshot(), before);
  }
  console.log("PASS: two repeat seeds preserve organisation IDs and all fixture row counts");
} finally {
  await prisma.$disconnect();
}
