import { randomUUID } from "node:crypto";
import { afterAll, describe, expect, it } from "vitest";
import { PostgresQueue } from "./index";
import { prisma } from "../../database/src/client";
import { PgBoss } from "pg-boss";

const name = `m01-verification-${randomUUID()}`;
const connection = process.env.DATABASE_URL;
if (!connection) throw new Error("DATABASE_URL required for real queue integration tests");
const queue = new PostgresQueue(connection);
const fixture = new PgBoss({ connectionString: connection, schema: "pgboss" });
afterAll(async () => {
  await queue.removeQueue(`${name}.dead-letter`);
  await queue.removeQueue(name);
  await queue.stop();
  await fixture.stop();
  await prisma.$disconnect();
});
describe("provider-neutral durable queue port", () => {
  it("enqueues, claims, completes, dead-letters and retries durable jobs", async () => {
    await queue.start();
    const org = await prisma.organization.findUniqueOrThrow({ where: { key: "euro-infotech" } });
    const id = await queue.enqueue(name, { organizationId: org.id, jobKey: "complete" }, "complete");
    expect(id).toBeTruthy();
    const jobs = await queue.claim(name);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.payload.organizationId).toBe(org.id);
    await queue.complete(name, jobs[0]!.id);
    const second = await queue.enqueue(name, { organizationId: org.id, jobKey: "dead-letter" }, "dead-letter");
    expect(second).toBeTruthy();
    await queue.deadLetter(name, second!, "synthetic-terminal-error");
    const dead = await queue.claim(`${name}.dead-letter`);
    expect(dead).toHaveLength(1);
    expect(dead[0]?.payload.jobKey).toBe("dead-letter");
    await queue.complete(`${name}.dead-letter`, dead[0]!.id);
    await expect(queue.retry(name, second!)).rejects.toThrow("only_failed_jobs_can_retry");
    // Use provider SDK only to construct a terminally failed synthetic fixture.
    await fixture.start();
    const failed = await fixture.send(name, { organizationId: org.id, jobKey: "retry-failed" }, { retryLimit: 0 });
    expect(failed).toBeTruthy();
    await fixture.fail(name, failed!, { reason: "synthetic" });
    await queue.retry(name, failed!);
    const replay = await queue.claim(name);
    expect(replay).toHaveLength(1);
    await queue.complete(name, replay[0]!.id);
  });
});
