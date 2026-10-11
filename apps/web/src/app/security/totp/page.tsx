import type { Metadata } from "next";
import { TotpFlow } from "../../../components/identity/totp-flow";
type SP = { searchParams: Promise<Record<string, string | string[] | undefined>> };
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";
export const metadata: Metadata = { title: "Authenticator | Euro Infotech" };
export default async function Page({ searchParams }: SP) {
  const sp = await searchParams;
  return <TotpFlow mode={one(sp.mode) === "setup" ? "setup" : "challenge"} returnTo={one(sp.returnTo)} />;
}
