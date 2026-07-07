import { getServerSession } from "next-auth";
import AdminVerificationClient from "../../../components/admin/AdminVerificationClient";
import { authOptions } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminVerificationPage() {
  const session = await getServerSession(authOptions);
  return (
    <div>
      <h2 className="sr-only">Verification queue</h2>
      <AdminVerificationClient accessToken={session?.backendAccessToken ?? ""} />
    </div>
  );
}
