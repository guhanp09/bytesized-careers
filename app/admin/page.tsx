import { noindexPage } from "../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Admin");

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
