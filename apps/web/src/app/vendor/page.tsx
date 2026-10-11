import { requirePrivateArea } from "../../lib/require-private-area";
import { hasVendorPermission } from "../../lib/identity-context";
import { IdentityArea } from "../../components/identity/identity-area";
import { VendorWorkspace } from "../../components/vendors";

export const dynamic = "force-dynamic";

export default async function VendorPage() {
  const identity = await requirePrivateArea("vendor");
  const vendorAssignment = identity.assignments.find((assignment) =>
    assignment.vendorId && ["VENDOR_OWNER", "VENDOR_STAFF"].includes(assignment.roleKey),
  );
  const vendorId = vendorAssignment?.vendorId ?? undefined;

  return <IdentityArea area="Vendor" name={identity.user.name} organizationName={identity.tenant.displayName}
    roles={identity.roleKeys} permissions={identity.permissions}>
    <VendorWorkspace
      vendorId={vendorId}
      canApply={identity.hasPermission("vendor.application.create") && !vendorId}
      canManageProfile={Boolean(vendorId && hasVendorPermission(identity, vendorId, "vendor.profile.manage"))}
      canManageBank={Boolean(vendorId && hasVendorPermission(identity, vendorId, "vendor.bank.manage"))}
      canManageStaff={Boolean(vendorId && hasVendorPermission(identity, vendorId, "vendor.staff.manage"))}
    />
  </IdentityArea>;
}
