import { NextResponse } from "next/server";
import { z } from "zod";
import { requireIdentity } from "../../../../../../lib/identity-api";

export async function GET(request: Request, { params }: { params: Promise<{ vendorId: string }> }): Promise<Response> {
  const guard = await requireIdentity(request);
  if (guard.response) return guard.response;
  const vendorId = z.string().uuid().safeParse((await params).vendorId);
  if (!vendorId.success) return NextResponse.json({ error: "invalid_vendor_scope" }, { status: 400 });
  const identity = guard.identity;
  const assignment = identity.assignments.find((role) =>
    role.vendorId === vendorId.data && role.vendorApprovedAt &&
    role.role.permissions.some((permission) => permission.permissionKey === "vendor.profile.manage")
  );
  if (!assignment) return NextResponse.json({ error: "access_denied" }, { status: 403 });
  return NextResponse.json({
    vendorId: vendorId.data,
    organization: identity.tenant.key,
    role: assignment.roleKey,
  }, { headers: { "Cache-Control": "no-store" } });
}
