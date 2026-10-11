import { PgBoss } from "pg-boss";
import type { QueueMessage, QueuePort } from "@workspace/core";

export class PostgresQueue implements QueuePort {
  private readonly boss: PgBoss;
  constructor(connectionString: string) {
    this.boss = new PgBoss({
      connectionString, schema: "pgboss",
      application_name: "nextb-commerce-worker",
    });
    this.boss.on("error", () => console.error("queue_error"));
  }
  async start() { await this.boss.start(); }
  async enqueue(queue: string, payload: QueueMessage, dedupeKey: string) {
    await this.boss.createQueue(queue);
    return this.boss.send(queue, payload, {
      singletonKey: dedupeKey, retryLimit: 5, retryDelay: 2, retryBackoff: true,
    });
  }
  async consume(queue: string, handler: (payload: QueueMessage) => Promise<void>) {
    await this.boss.createQueue(queue);
    await this.boss.work<QueueMessage>(queue, async (jobs) => {
      for (const job of jobs) {
        if (typeof job.data.organizationId !== "string" || typeof job.data.jobKey !== "string") {
          throw new Error("invalid_queue_message");
        }
        await handler(job.data);
      }
    });
  }
  async stop() { await this.boss.stop({ graceful: true, timeout: 10_000 }); }
  async claim(queue: string) {
    return (await this.boss.fetch<QueueMessage>(queue)).map((job) => ({
      id: job.id, payload: job.data,
    }));
  }
  async complete(queue: string, id: string) { await this.boss.complete(queue, id); }
  async retry(queue: string, id: string) {
    const job = await this.boss.getJobById(queue, id);
    if (!job || job.state !== "failed") throw new Error("only_failed_jobs_can_retry");
    await this.boss.retry(queue, id);
  }
  async deadLetter(queue: string, id: string, reason: string) {
    const job = await this.boss.getJobById<QueueMessage>(queue, id);
    if (!job) throw new Error("queue_job_not_found");
    const destination = `${queue}.dead-letter`;
    await this.boss.createQueue(destination);
    await this.boss.send(destination, { ...job.data, reason, sourceJobId: id }, { singletonKey: id });
    await this.boss.cancel(queue, id);
  }
  async removeQueue(queue: string) { await this.boss.deleteQueue(queue); }
}
