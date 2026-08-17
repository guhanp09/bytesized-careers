import { noindexPage } from "../../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Reports");

import { getServerSession } from "next-auth";
import AdminReportsClient from "../../../components/admin/AdminReportsClient";
import { authOptions } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminReportsPage() {
  const session = await getServerSession(authOptions);
  return (
    <div>
      <h2 className="sr-only">Reports queue</h2>
      <AdminReportsClient accessToken={session?.backendAccessToken ?? ""} />
    </div>
  );
}
