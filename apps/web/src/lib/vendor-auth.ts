import "server-only";
import { NextResponse } from "next/server";
import { hasVendorPermission, type IdentityContext } from "./identity-context";
import {
  requireFreshSecondFactor,
  requireIdentity,
} from "./identity-api";

export async function requireVendorPermission(
  request: Request,
  vendorId: string,
  permission: string,
): Promise<{ identity: IdentityContext; response?: never } | { identity?: never; response: NextResponse }> {
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return { response: guard.response! };
  if (!hasVendorPermission(guard.identity, vendorId, permission)) {
    return { response: NextResponse.json({ error: "access_denied" }, { status: 403 }) };
  }
  return { identity: guard.identity };
}

export async function requireVendorAdminPermission(
  request: Request,
  permission: string,
): Promise<{ identity: IdentityContext; response?: never } | { identity?: never; response: NextResponse }> {
  const guard = await requireIdentity(request);
  if (guard.response || !guard.identity) return { response: guard.response! };
  if (!guard.identity.hasAdminRole || !guard.identity.hasPermission(permission)) {
    return { response: NextResponse.json({ error: "access_denied" }, { status: 403 }) };
  }
  const mfaResponse = await requireFreshSecondFactor(guard.identity);
  return mfaResponse ? { response: mfaResponse } : { identity: guard.identity };
}
