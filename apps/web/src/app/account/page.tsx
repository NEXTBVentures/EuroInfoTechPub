import Link from "next/link";
import { requirePrivateArea } from "../../lib/require-private-area";
import { IdentityArea } from "../../components/identity/identity-area";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const identity = await requirePrivateArea("customer");
  return <IdentityArea area="Customer" name={identity.user.name} organizationName={identity.tenant.displayName}
    roles={identity.roleKeys} permissions={identity.permissions}>
    <h2>Your account</h2>
    <p>Your customer membership is active in this organisation.</p>
    <p><Link href="/account/security">Manage account security and active sessions</Link></p>
    <p>Shopping, orders and address-book workflows will be introduced in their approved modules.</p>
  </IdentityArea>;
}
