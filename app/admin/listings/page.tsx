import { getServerSession } from "next-auth";
import AdminListingsClient from "../../../components/admin/AdminListingsClient";
import { authOptions } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminListingsPage() {
  const session = await getServerSession(authOptions);
  return (
    <div>
      <h2 className="sr-only">Listings</h2>
      <AdminListingsClient accessToken={session?.backendAccessToken ?? ""} />
    </div>
  );
}
