import type { Metadata } from "next";
import { PhoneLoginForm } from "../../components/identity/auth-forms";
type SP = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const metadata: Metadata = { title: "Phone sign-in | Euro Infotech" };
export default async function Page({ searchParams }: SP) {
  const sp = await searchParams;
  return <PhoneLoginForm returnTo={one(sp.returnTo)} />;
}
