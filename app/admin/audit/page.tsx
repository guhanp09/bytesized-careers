import { getServerSession } from "next-auth";
import AdminAuditClient from "../../../components/admin/AdminAuditClient";
import { authOptions } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminAuditPage() {
  const session = await getServerSession(authOptions);
  return (
    <div>
      <h2 className="sr-only">Audit log</h2>
      <AdminAuditClient accessToken={session?.backendAccessToken ?? ""} />
    </div>
  );
}
