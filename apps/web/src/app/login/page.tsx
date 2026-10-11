import type { Metadata } from "next";
import { LoginForm } from "../../components/identity/auth-forms";
type SP = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const metadata: Metadata = { title: "Sign in | Euro Infotech" };
export default async function Page({ searchParams }: SP) {
  const sp = await searchParams;
  return <LoginForm returnTo={one(sp.returnTo)} notice={one(sp.notice)} />;
}
