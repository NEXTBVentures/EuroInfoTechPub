import { requirePrivateArea } from "../../lib/require-private-area";
import { IdentityArea } from "../../components/identity/identity-area";
import { RolesManager } from "../../components/identity/roles-manager";
import { AdminWorkspace } from "../../components/vendors";

export const dynamic = "force-dynamic";

export default async function AdminPage() {
  const identity = await requirePrivateArea("admin");
  return <IdentityArea area="Admin" name={identity.user.name} organizationName={identity.tenant.displayName}
    roles={identity.roleKeys} permissions={identity.permissions}>
    <h2>Organisation access</h2>
    <p>Administrator membership, permission and session-specific second factor have been verified.</p>
    {identity.hasPermission("admin.roles.manage")
      ? <RolesManager canManage />
      : <p>Role management requires the admin.roles.manage permission. Other administration features are outside M02.</p>}
    {identity.hasPermission("admin.vendors.view")
      ? <AdminWorkspace
        canReview={identity.hasPermission("admin.vendors.review")}
        canApprove={identity.hasPermission("admin.vendors.approve")}
        canSuspend={identity.hasPermission("admin.vendors.suspend")}
        canVerifyBank={identity.hasPermission("admin.vendor_bank.verify")}
        canConfigure={identity.hasPermission("organization.settings.manage")}
      />
      : <p>Vendor review requires the admin.vendors.view permission.</p>}
  </IdentityArea>;
}
