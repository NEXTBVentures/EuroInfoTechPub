import type { Metadata } from "next";
import { ResetPasswordForm } from "../../components/identity/auth-forms";
type SP = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const metadata: Metadata = { title: "New password | Euro Infotech", referrer: "no-referrer" };
export default async function Page({ searchParams }: SP) {
  const sp = await searchParams;
  return <ResetPasswordForm token={one(sp.token)} error={one(sp.error) || undefined} />;
}
