import { noindexPage } from "../../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Audit log");

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
