import { z } from "zod";

export const moduleStatusSchema = z.object({
  key: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  status: z.enum(["implemented", "planned"]),
  enabled: z.boolean(),
});

export const publicClientConfigSchema = z.object({
  schemaVersion: z.literal(1),
  clientKey: z.string().min(1),
  projectCode: z.string().min(1),
  displayName: z.string().min(1),
  locale: z.string().min(1),
  currency: z.string().length(3),
  timeZone: z.string().min(1),
  coreVersion: z.string().min(1),
  productionReady: z.literal(false),
  modules: z.array(moduleStatusSchema),
});

export const readinessSchema = z.object({
  ready: z.boolean(),
  checks: z.object({
    database: z.enum(["ready", "not_ready"]),
    migrations: z.enum(["ready", "not_ready"]),
    worker: z.enum(["ready", "not_ready"]),
  }),
});

export const healthSchema = z.object({ status: z.literal("ok") });

export const domainEventSchema = z.object({
  eventId: z.string().uuid(),
  organizationId: z.string().uuid(),
  eventType: z.string().min(1),
  occurredAt: z.string().datetime(),
  payload: z.record(z.string(), z.unknown()),
});

export type ModuleStatus = z.infer<typeof moduleStatusSchema>;
export type PublicClientConfig = z.infer<typeof publicClientConfigSchema>;
export type ReadinessResponse = z.infer<typeof readinessSchema>;
export type DomainEvent = z.infer<typeof domainEventSchema>;
