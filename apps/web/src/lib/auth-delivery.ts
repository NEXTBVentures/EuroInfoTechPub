export type AuthDeliveryKind = "email-verification" | "password-reset" | "phone-otp";

export interface CapturedAuthMessage {
  kind: AuthDeliveryKind;
  recipient: string;
  content: string;
  createdAt: Date;
}

const capturedMessages: CapturedAuthMessage[] = [];

function testAdapterEnabled(): boolean {
  return process.env.NODE_ENV !== "production" &&
    process.env.AUTH_TEST_ADAPTERS === "true";
}

export async function deliverAuthMessage(
  kind: AuthDeliveryKind,
  recipient: string,
  content: string,
): Promise<void> {
  assertAuthDeliveryAvailable();
  capturedMessages.push({ kind, recipient, content, createdAt: new Date() });
}

export function assertAuthDeliveryAvailable(): void {
  if (!testAdapterEnabled()) throw new Error("authentication_delivery_provider_disabled");
}

export function readCapturedAuthMessages(recipient?: string): CapturedAuthMessage[] {
  if (!testAdapterEnabled()) throw new Error("test_adapter_disabled");
  return capturedMessages
    .filter((message) => !recipient || message.recipient === recipient)
    .map((message) => ({ ...message }));
}

export function clearCapturedAuthMessages(): void {
  if (!testAdapterEnabled()) throw new Error("test_adapter_disabled");
  capturedMessages.length = 0;
}
