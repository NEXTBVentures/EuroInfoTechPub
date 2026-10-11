export interface QueueMessage {
  organizationId: string;
  jobKey: string;
}

export interface QueuePort {
  start(): Promise<void>;
  enqueue(queue: string, payload: QueueMessage, dedupeKey: string): Promise<string | null>;
  consume(queue: string, handler: (payload: QueueMessage) => Promise<void>): Promise<void>;
  claim(queue: string): Promise<Array<{ id: string; payload: QueueMessage }>>;
  complete(queue: string, id: string): Promise<void>;
  retry(queue: string, id: string): Promise<void>;
  deadLetter(queue: string, id: string, reason: string): Promise<void>;
  stop(): Promise<void>;
}

export interface ProviderPort {
  readonly kind: "payments" | "shipping" | "messaging" | "ai";
  readonly enabled: boolean;
  execute(input: unknown): Promise<unknown>;
}

export class DisabledProvider implements ProviderPort {
  readonly enabled = false;
  constructor(readonly kind: ProviderPort["kind"]) {}
  async execute(): Promise<never> {
    throw new Error(`provider_disabled:${this.kind}`);
  }
}
