import { NextResponse } from "next/server";

// Cache control is not an authorization boundary; server pages and APIs independently
// validate the database session, tenant, membership, permissions and second factor.
export function proxy() {
  const response = NextResponse.next();
  response.headers.set("Cache-Control", "private, no-store, max-age=0");
  response.headers.set("Pragma", "no-cache");
  return response;
}

export const config = {
  matcher: ["/account/:path*", "/admin/:path*", "/vendor/:path*", "/security/:path*", "/api/v1/identity/:path*", "/api/auth/:path*"],
};
