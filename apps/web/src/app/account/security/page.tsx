import type { Metadata } from "next";
import { SecurityCenter } from "../../../components/identity/security-center";
export const metadata: Metadata = { title: "Account security | Euro Infotech" };
export default function Page() {
  return <SecurityCenter />;
}
