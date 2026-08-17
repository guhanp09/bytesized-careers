import { noindexPage } from "../../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Verification");

import { getServerSession } from "next-auth";
import AdminVerificationClient from "../../../components/admin/AdminVerificationClient";
import { authOptions } from "../../../lib/auth";

export const dynamic = "force-dynamic";

export default async function AdminVerificationPage() {
  const session = await getServerSession(authOptions);
  return (
    <div>
      <h2 className="sr-only">Verification queue</h2>
      <AdminVerificationClient accessToken={session?.backendAccessToken ?? ""} />
    </div>
  );
}
