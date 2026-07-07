import { getServerSession } from "next-auth";
import AdminOverviewClient from "../../components/admin/AdminOverviewClient";
import { authOptions } from "../../lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const session = await getServerSession(authOptions);
  return (
    <div>
      <h2 className="sr-only">Admin overview</h2>
      <AdminOverviewClient accessToken={session?.backendAccessToken ?? ""} />
    </div>
  );
}
