import type { Metadata } from "next";
import { AccessDenied } from "../../components/identity/auth-forms";
type SP = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const metadata: Metadata = { title: "Access denied | Euro Infotech" };
export default async function Page({ searchParams }: SP) {
  const sp = await searchParams;
  return <AccessDenied reason={one(sp.reason) || undefined} returnTo={one(sp.returnTo) || undefined} />;
}
