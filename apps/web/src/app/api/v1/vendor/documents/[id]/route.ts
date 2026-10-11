import { NextResponse } from "next/server";
import { prisma } from "@workspace/database";
import { hasVendorPermission } from "../../../../../../lib/identity-context";
import { requireIdentity } from "../../../../../../lib/identity-api";
import { requireVendorAdminPermission } from "../../../../../../lib/vendor-auth";
import { readVendorDocument, safeVendorFilename } from "../../../../../../lib/vendor-security";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ id: string }> };

export async function GET(request: Request, context: RouteContext): Promise<Response> {
  const { id } = await context.params;
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return guard.response!;
  const identity = guard.identity;
  const admin = identity.hasAdminRole
    ? await requireVendorAdminPermission(request, "admin.vendors.view")
    : null;
  if (admin?.response) return admin.response;
  const document = await prisma.vendorDocument.findFirst({
    where: { id, organizationId: identity.tenant.id },
    include: { application: { select: { applicantMembershipId: true } } },
  });
  if (!document) return NextResponse.json({ error: "document_not_found" }, { status: 404 });
  const permitted = admin?.identity
    ? true
    : document.application.applicantMembershipId === identity.membership.id ||
      hasVendorPermission(identity, document.vendorId, "vendor.application.view");
  if (!permitted) return NextResponse.json({ error: "access_denied" }, { status: 403 });
  try {
    const bytes = await readVendorDocument(document.storageKey);
    const body = Uint8Array.from(bytes);
    const filename = safeVendorFilename(document.originalFilename);
    return new Response(body, {
      headers: {
        "Content-Type": document.mediaType,
        "Content-Length": String(body.byteLength),
        "Content-Disposition": `attachment; filename="${filename.replace(/"/g, "_")}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "default-src 'none'; sandbox",
      },
    });
  } catch {
    return NextResponse.json({ error: "private_document_unavailable" }, { status: 503 });
  }
}
