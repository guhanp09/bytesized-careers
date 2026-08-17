import { noindexPage } from "../../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Users");

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
