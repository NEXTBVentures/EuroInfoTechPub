import { NextResponse } from "next/server";
import { healthSchema } from "@workspace/contracts";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(healthSchema.parse({ status: "ok" }));
}
