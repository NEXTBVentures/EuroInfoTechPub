import { NextResponse } from "next/server";
import { canTransitionVendorApplication, requireVendorApplicationTransition, type VendorApplicationStatus } from "@workspace/core";
import { vendorAdminDecisionSchema } from "@workspace/contracts";
import { prisma } from "@workspace/database";
import { enforceRecentAuthentication } from "../../../../../../../lib/identity-api";
import { requireVendorAdminPermission } from "../../../../../../../lib/vendor-auth";
import { getVendorOnboardingRules, writeVendorAudit } from "../../../../../../../lib/vendor-service";

export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

const targetStatuses = {
  "start-review": "UNDER_REVIEW",
  "request-changes": "CHANGES_REQUIRED",
  approve: "APPROVED",
  reject: "REJECTED",
  suspend: "SUSPENDED",
  reactivate: "APPROVED",
} as const satisfies Record<string, VendorApplicationStatus>;

function permissionFor(action: keyof typeof targetStatuses) {
  if (action === "approve") return "admin.vendors.approve";
  if (action === "suspend" || action === "reactivate") return "admin.vendors.suspend";
  return "admin.vendors.review";
}

export async function POST(request: Request, context: RouteContext): Promise<Response> {
  const parsed = vendorAdminDecisionSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  const { id } = await context.params;
  const guard = await requireVendorAdminPermission(request, permissionFor(parsed.data.action));
  if (guard.response || !guard.identity) return guard.response!;
  const denied = await enforceRecentAuthentication(
    request,
    guard.identity,
    parsed.data.password,
    parsed.data.code,
  );
  if (denied) return denied;
  const rules = await getVendorOnboardingRules(guard.identity.tenant.id);
  try {
    const result = await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "id" FROM "VendorApplication" WHERE "id" = ${id}::uuid AND "organizationId" = ${guard.identity.tenant.id}::uuid FOR UPDATE`;
      const application = await tx.vendorApplication.findFirst({
        where: { id, organizationId: guard.identity.tenant.id },
        include: { vendor: true, applicantMembership: { select: { userId: true } } },
      });
      if (!application) return { error: "application_not_found" as const };
      if (rules.preventSelfReview && application.applicantMembership.userId === guard.identity.user.id) {
        return { error: "self_review_not_allowed" as const };
      }
      const fromStatus = application.status as VendorApplicationStatus;
      const toStatus = targetStatuses[parsed.data.action];
      if (fromStatus === toStatus) {
        const latest = await tx.vendorDecision.findFirst({
          where: { applicationId: id }, orderBy: { createdAt: "desc" },
        });
        if (latest?.toStatus === toStatus) return { status: toStatus, idempotent: true };
      }
      if (!canTransitionVendorApplication(fromStatus, toStatus, "admin")) {
        return { error: "invalid_application_transition" as const };
      }
      requireVendorApplicationTransition(fromStatus, toStatus, "admin");
      const now = new Date();
      const applicationStatus = parsed.data.action === "reactivate" ? "APPROVED" : toStatus;
      await tx.vendorApplication.update({
        where: { id: application.id },
        data: {
          status: applicationStatus,
          reviewedAt: parsed.data.action === "start-review" ? now : application.reviewedAt,
          approvedAt: parsed.data.action === "approve" ? now : application.approvedAt,
          rejectedAt: parsed.data.action === "reject" ? now : application.rejectedAt,
        },
      });
      const vendorStatus = parsed.data.action === "approve" || parsed.data.action === "reactivate"
        ? "ACTIVE"
        : parsed.data.action === "reject"
          ? "REJECTED"
          : parsed.data.action === "suspend"
            ? "SUSPENDED"
            : undefined;
      if (vendorStatus) {
        await tx.vendor.update({
          where: { id_organizationId: { id: application.vendorId, organizationId: guard.identity.tenant.id } },
          data: { status: vendorStatus },
        });
      }
      await tx.vendorDecision.create({
        data: {
          organizationId: guard.identity.tenant.id,
          vendorId: application.vendorId,
          applicationId: application.id,
          actorUserId: guard.identity.user.id,
          fromStatus,
          toStatus: applicationStatus,
          internalReason: parsed.data.internalReason,
          vendorMessage: parsed.data.vendorMessage || null,
        },
      });
      await writeVendorAudit(tx, {
        organizationId: guard.identity.tenant.id,
        vendorId: application.vendorId,
        actorUserId: guard.identity.user.id,
        action: `application.${parsed.data.action}`,
        targetId: application.id,
        requestId: request.headers.get("x-request-id"),
        metadata: { fromStatus, toStatus: applicationStatus },
      });
      if (parsed.data.action === "approve") {
        const owner = await tx.roleAssignment.findFirst({
          where: {
            organizationId: guard.identity.tenant.id,
            membershipId: application.applicantMembershipId,
            roleKey: "VENDOR_OWNER",
            vendorId: application.vendorId,
          },
        });
        if (!owner) {
          await tx.roleAssignment.create({
            data: {
              organizationId: guard.identity.tenant.id,
              membershipId: application.applicantMembershipId,
              roleKey: "VENDOR_OWNER",
              vendorId: application.vendorId,
              vendorApprovedAt: now,
              assignedByUserId: guard.identity.user.id,
            },
          });
        }
      }
      if (["approve", "reject", "suspend", "reactivate"].includes(parsed.data.action)) {
        await tx.session.deleteMany({
          where: { userId: application.applicantMembership.userId },
        });
      }
      await tx.outboxEvent.create({
        data: {
          organizationId: guard.identity.tenant.id,
          dedupeKey: `vendor.application.decision:${application.id}:${now.getTime()}`,
          eventType: "vendor.application.decision",
          payload: {
            applicationId: application.id,
            vendorId: application.vendorId,
            status: applicationStatus,
            decision: parsed.data.action,
          },
        },
      });
      return { status: applicationStatus };
    });
    if ("error" in result) {
      const status = result.error === "application_not_found" ? 404 : 409;
      return NextResponse.json({ error: result.error }, { status });
    }
    return NextResponse.json(result);
  } catch {
    return NextResponse.json({ error: "vendor_decision_unavailable" }, { status: 503 });
  }
}
