# ADR: PostgreSQL queue, transactional outbox and idempotent consumers

Status: accepted for M01 development.

Use pg-boss through a core QueuePort, with a separate Node.js worker.
The application transaction writes an OutboxEvent alongside future business changes;
the worker publishes pending synthetic foundation events to PostgreSQL-backed jobs.
The outbox does not promise exactly-once delivery: enqueue/publish acknowledgement can fail independently.
Consumers must therefore apply effects idempotently using tenant-scoped uniqueness.

No Redis, process-memory job persistence, HTTP business timers or live provider calls.
ProviderPort implementations are explicitly disabled until later module approval.
pg-boss owns queue claim/completion, retries and failure states; domain code never imports its SDK.

Idempotency uses a PostgreSQL transaction advisory lock over the tenant/actor/operation/key scope.
The result and transactional effect commit together. Competing identical requests replay the same
stored result; key reuse with different content is rejected.

One worker heartbeat identity is sufficient for a dedicated-client foundation.
Replica scaling and production availability/retention policy remain separate release work.
