import type { Metadata } from "next";
import { VerifyEmailPanel } from "../../components/identity/auth-forms";
type SP = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const metadata: Metadata = { title: "Verify email | Euro Infotech" };
export default async function Page({ searchParams }: SP) {
  const sp = await searchParams;
  return <VerifyEmailPanel email={one(sp.email)} error={one(sp.error) || undefined} />;
}
