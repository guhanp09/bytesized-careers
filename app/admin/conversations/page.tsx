import { getServerSession } from "next-auth";
import AdminConversationsClient from "../../../components/admin/AdminConversationsClient";
import { authOptions } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminConversationsPage() {
  const session = await getServerSession(authOptions);
  return (
    <div>
      <h2 className="sr-only">Conversations</h2>
      <AdminConversationsClient accessToken={session?.backendAccessToken ?? ""} />
    </div>
  );
}
