import type { Metadata } from "next";
import { ForgotPasswordForm } from "../../components/identity/auth-forms";
export const metadata: Metadata = { title: "Reset password | Euro Infotech" };
export default function Page() {
  return <ForgotPasswordForm />;
}
