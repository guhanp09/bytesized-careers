import { noindexPage } from "../../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Conversations");

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
