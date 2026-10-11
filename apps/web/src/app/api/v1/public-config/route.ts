import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { publicClientConfigSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";

export const dynamic = "force-dynamic";

export async function GET() {
  const hostHeader = (await headers()).get("host") ?? "";
  const host = hostHeader.trim().toLowerCase().replace(/:\d+$/, "");

  let organization = host
    ? await prisma.organization.findFirst({
        where: { domains: { some: { host } } },
        include: {
          modules: {
            include: { module: true },
            orderBy: { moduleKey: "asc" },
          },
        },
      })
    : null;

  if (
    !organization &&
    process.env.NODE_ENV === "development" &&
    process.env.ALLOW_UNMAPPED_DOMAIN_IN_DEV === "true"
  ) {
    organization = await prisma.organization.findUnique({
      where: { key: process.env.CLIENT_CONFIG_KEY ?? "euro-infotech" },
      include: {
        modules: {
          include: { module: true },
          orderBy: { moduleKey: "asc" },
        },
      },
    });
  }

  if (!organization) {
    return NextResponse.json({ error: "Unknown application domain" }, { status: 404 });
  }

  const response = publicClientConfigSchema.parse({
    schemaVersion: 1,
    clientKey: organization.key,
    projectCode: organization.key === "euro-infotech" ? "261002" : "fixture",
    displayName: organization.displayName,
    locale: organization.locale,
    currency: organization.currency,
    timeZone: organization.timeZone,
    coreVersion: organization.coreVersion,
    productionReady: false,
    modules: organization.modules.map(({ module, enabled, implementationStatus }) => ({
      key: module.key,
      name: module.name,
      description: module.description,
      status: implementationStatus === "IMPLEMENTED" ? "implemented" : "planned",
      enabled,
    })),
  });

  return NextResponse.json(response, {
    headers: { "Cache-Control": "no-store" },
  });
}
