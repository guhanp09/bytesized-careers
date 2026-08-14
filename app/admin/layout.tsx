import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import AdminShell from "../../components/admin/AdminShell";
import { AdminStrongAuthBoundary } from "../../components/security/StrongAuthControls";
import { authOptions } from "../../lib/auth";
import { isProductionRuntime } from "../../lib/backendClient";
import { isDevToolsAllowed } from "../../lib/devTools";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Server-side admin gate (docs/ADMIN_PANEL_PLAN.md §6): non-admins get a 404 —
 * not a login redirect — so the panel's existence never leaks. This gates the
 * UI shell only; every data call is separately enforced by `require_admin`-
 * backed permissions on the backend.
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.accountType !== "ADMIN" || !session.backendAccessToken) {
    notFound();
  }

  return (
    <main className="min-h-[calc(100dvh-56px)] bg-[#0b0b0f] text-white">
      <AdminStrongAuthBoundary
        provider={session.user.provider}
        failClosed={isProductionRuntime()}
      >
        <AdminShell
          accessToken={session.backendAccessToken}
          environment={isProductionRuntime() ? "production" : "development"}
          devToolsAllowed={isDevToolsAllowed()}
        >
          {children}
        </AdminShell>
      </AdminStrongAuthBoundary>
    </main>
  );
}
