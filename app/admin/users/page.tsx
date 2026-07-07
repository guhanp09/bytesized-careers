import { getServerSession } from "next-auth";
import AdminUsersClient from "../../../components/admin/AdminUsersClient";
import { authOptions } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminUsersPage() {
  const session = await getServerSession(authOptions);
  return (
    <div>
      <h2 className="sr-only">Users</h2>
      <AdminUsersClient accessToken={session?.backendAccessToken ?? ""} />
    </div>
  );
}
