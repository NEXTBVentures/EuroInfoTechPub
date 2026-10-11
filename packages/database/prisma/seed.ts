import { readFile } from "node:fs/promises";
import { z } from "zod";
import { prisma } from "../src/client";
import { DEFAULT_ROLE_PERMISSIONS, PERMISSION_KEYS, ROLE_KEYS, ROLE_LABELS } from "@workspace/core";

const profileSchema = z.object({
  schemaVersion: z.literal(1),
  clientKey: z.literal("euro-infotech"),
  projectCode: z.literal("261002"),
  displayName: z.string().min(1),
  locale: z.literal("en-IN"),
  currency: z.literal("INR"),
  timeZone: z.literal("Asia/Kolkata"),
  deploymentMode: z.literal("dedicated-client"),
  coreVersion: z.string().min(1),
  enabledModules: z.array(z.string()),
  plannedModules: z.array(z.string()),
  providers: z.object({
    payments: z.literal("disabled"),
    shipping: z.literal("disabled"),
    messaging: z.literal("disabled"),
    ai: z.literal("disabled"),
    storage: z.literal("disabled"),
  }),
  payoutMode: z.literal("manual-approved"),
  productionReady: z.literal(false),
}).strict();

if (process.env.SEED_ENV !== "development" || process.env.NODE_ENV === "production") {
  throw new Error("Synthetic seed is permitted only with SEED_ENV=development outside production");
}

try {
  const profile = profileSchema.parse(JSON.parse(
    await readFile(new URL("../../../clients/euro-infotech/profile.json", import.meta.url), "utf8"),
  ));
  const keys = [...profile.enabledModules, ...profile.plannedModules];
  if (new Set(keys).size !== keys.length || profile.enabledModules.join(",") !== "organisation-config,identity,vendors") {
    throw new Error("Development profile must enable M01, M02 and M03 modules with unique module keys");
  }
  const moduleNames: Record<string, string> = {
    "organisation-config": "Organisation configuration",
    identity: "Identity & access", vendors: "Vendor management",
    catalogue: "Product catalogue", inventory: "Inventory",
    discovery: "Product discovery", cart: "Cart & checkout",
    pricing: "Pricing & promotions", orders: "Order management",
    payments: "Payments", fulfilment: "Fulfilment",
    returns: "Returns & refunds", reviews: "Reviews",
    commission: "Commission", payouts: "Vendor payouts",
    "ai-search": "AI search", "ai-product-entry": "AI product entry",
    cms: "Content management", notifications: "Notifications",
    support: "Customer support", reports: "Reports",
  };
  const euro = await prisma.organization.upsert({
    where: { key: profile.clientKey },
    create: {
      key: profile.clientKey, displayName: profile.displayName,
      locale: profile.locale, currency: profile.currency, timeZone: profile.timeZone,
      coreVersion: profile.coreVersion, config: profile,
    },
    update: {
      displayName: profile.displayName, locale: profile.locale,
      currency: profile.currency, timeZone: profile.timeZone,
      coreVersion: profile.coreVersion, config: profile,
    },
  });
  const second = await prisma.organization.upsert({
    where: { key: "synthetic-isolation-fixture" },
    create: {
      key: "synthetic-isolation-fixture", displayName: "Synthetic isolation fixture",
      locale: "en-IN", currency: "INR", timeZone: "Asia/Kolkata",
      coreVersion: "0.1.0", config: { synthetic: true, productionReady: false },
    },
    update: {},
  });
  for (const organization of [euro, second]) {
    for (const key of PERMISSION_KEYS) {
      await prisma.permission.upsert({
        where: { organizationId_key: { organizationId: organization.id, key } },
        create: { organizationId: organization.id, key, description: key },
        update: {},
      });
    }
    for (const key of ROLE_KEYS) {
      await prisma.role.upsert({
        where: { organizationId_key: { organizationId: organization.id, key } },
        create: { organizationId: organization.id, key, label: ROLE_LABELS[key] },
        update: {},
      });
      for (const permissionKey of DEFAULT_ROLE_PERMISSIONS[key]) {
        await prisma.rolePermission.upsert({
          where: { organizationId_roleKey_permissionKey: { organizationId: organization.id, roleKey: key, permissionKey } },
          create: { organizationId: organization.id, roleKey: key, permissionKey },
          update: {},
        });
      }
    }
  }
  // Inert synthetic identities: no password account, verified contact or usable session.
  // Real development users register with their own password and enroll TOTP.
  for (const [id, name, roleKey] of [
    ["synthetic-m02-customer", "Synthetic customer", "CUSTOMER"],
    ["synthetic-m02-owner", "Synthetic organisation owner", "ORGANISATION_OWNER"],
  ]) {
    const user = await prisma.user.upsert({
      where: { id },
      create: { id, name, email: `${id}@example.invalid` },
      update: {},
    });
    const membership = await prisma.organizationMembership.upsert({
      where: { organizationId_userId: { organizationId: euro.id, userId: user.id } },
      create: { organizationId: euro.id, userId: user.id }, update: {},
    });
    if (!await prisma.roleAssignment.findFirst({ where: { membershipId: membership.id, roleKey } })) {
      await prisma.roleAssignment.create({ data: { organizationId: euro.id, membershipId: membership.id, roleKey } });
    }
  }
  for (const [index, key] of keys.entries()) {
    await prisma.moduleDefinition.upsert({
      where: { key },
      create: {
        key, name: moduleNames[key] ?? key, displayOrder: index,
        description: key === "organisation-config" ? "M01 client configuration and platform foundation." :
          key === "identity" ? "M02 secure authentication, memberships, permissions and administrator TOTP." :
            key === "vendors" ? "M03 vendor applications, private onboarding evidence and scoped administration." :
            "Planned for a later module; not available yet.",
      },
      update: {
        name: moduleNames[key] ?? key, displayOrder: index,
        description: key === "organisation-config" ? "M01 client configuration and platform foundation." :
          key === "identity" ? "M02 secure authentication, memberships, permissions and administrator TOTP." :
            key === "vendors" ? "M03 vendor applications, private onboarding evidence and scoped administration." :
            "Planned for a later module; not available yet.",
      },
    });
    for (const organization of [euro, second]) {
      await prisma.organizationModule.upsert({
        where: { organizationId_moduleKey: { organizationId: organization.id, moduleKey: key } },
        create: {
          organizationId: organization.id, moduleKey: key,
          enabled: profile.enabledModules.includes(key),
          implementationStatus: profile.enabledModules.includes(key) ? "IMPLEMENTED" : "PLANNED",
        },
        update: {
          enabled: profile.enabledModules.includes(key),
          implementationStatus: profile.enabledModules.includes(key) ? "IMPLEMENTED" : "PLANNED",
        },
      });
    }
  }
  const hosts = new Set(["localhost", "127.0.0.1", "euro-infotech.test"]);
  if (process.env.REPLIT_DEV_DOMAIN) hosts.add(process.env.REPLIT_DEV_DOMAIN.toLowerCase());
  for (const host of hosts) {
    await prisma.domain.upsert({
      where: { host }, create: { host, organizationId: euro.id },
      update: { organizationId: euro.id },
    });
  }
  await prisma.domain.upsert({
    where: { host: "isolation-fixture.test" },
    create: { host: "isolation-fixture.test", organizationId: second.id },
    update: { organizationId: second.id },
  });
  await prisma.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: euro.id, key: "client-profile" } },
    create: { organizationId: euro.id, key: "client-profile", value: profile },
    update: { value: profile },
  });
  await prisma.organizationSetting.upsert({
    where: { organizationId_key: { organizationId: second.id, key: "isolation-marker" } },
    create: { organizationId: second.id, key: "isolation-marker", value: { synthetic: "org-b-only" } },
    update: {},
  });
  await prisma.outboxEvent.upsert({
    where: { organizationId_dedupeKey: { organizationId: euro.id, dedupeKey: "foundation-smoke-v1" } },
    create: {
      organizationId: euro.id, dedupeKey: "foundation-smoke-v1",
      eventType: "foundation.smoke", payload: { jobKey: "foundation-smoke-v1" },
    },
    update: {},
  });
  console.log("Development seed complete: M01/M02 preserved; M03 enabled with inert synthetic identity fixtures.");
} finally {
  await prisma.$disconnect();
}
