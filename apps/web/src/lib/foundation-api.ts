import {
  publicClientConfigSchema,
  readinessSchema,
  type PublicClientConfig,
  type ReadinessResponse,
} from "@workspace/contracts";

export async function getPublicConfig(): Promise<PublicClientConfig> {
  const response = await fetch("/api/v1/public-config", { cache: "no-store" });
  if (!response.ok) throw new Error("Public configuration is unavailable");
  return publicClientConfigSchema.parse(await response.json());
}

export async function getReadiness(): Promise<ReadinessResponse> {
  const response = await fetch("/api/readyz", { cache: "no-store" });
  const body = readinessSchema.parse(await response.json());
  return body;
}
