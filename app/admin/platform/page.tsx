import { getServerSession } from "next-auth";
import AdminPlatformClient from "../../../components/admin/AdminPlatformClient";
import { authOptions } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminPlatformPage() {
  const session = await getServerSession(authOptions);
  return (
    <div>
      <h2 className="sr-only">Platform</h2>
      <AdminPlatformClient accessToken={session?.backendAccessToken ?? ""} />
    </div>
  );
}
