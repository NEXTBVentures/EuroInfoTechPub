import { VendorInvitationAcceptance } from "../../../../components/vendors/vendor-invitation-acceptance";

export const dynamic = "force-dynamic";
export const metadata = {
  title: "Accept vendor invitation",
  description: "Accept a private Euro Infotech vendor staff invitation.",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

export default async function VendorInvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  return <VendorInvitationAcceptance token={token} />;
}
