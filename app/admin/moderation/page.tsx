import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";

import { AdminModerationClient } from "../../../components/marketplace/AdminModerationClient";
import { authOptions } from "../../../lib/auth";
import { BackendRequestError, listAdminReports, type BackendReport } from "../../../lib/backendClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function AdminModerationPage() {
  const session = await getServerSession(authOptions);
  if (!session?.user || !session.backendAccessToken) {
    redirect(`/auth?mode=login&next=${encodeURIComponent("/admin/moderation")}`);
  }

  let reports: BackendReport[] = [];
  let forbidden = false;
  try {
    reports = await listAdminReports(session.backendAccessToken, "open");
  } catch (error) {
    forbidden = error instanceof BackendRequestError && error.status === 403;
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-6xl space-y-7">
        <header>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-white/42">Admin</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-white">Moderation</h1>
          <p className="mt-2 text-sm text-white/52">Review reports and take minimal safety actions.</p>
        </header>
        {forbidden ? (
          <div className="rounded-[28px] border border-white/10 bg-white/[0.035] px-6 py-12 text-center text-sm text-white/55">
            Admin access required.
          </div>
        ) : (
          <AdminModerationClient accessToken={session.backendAccessToken} initialReports={reports} />
        )}
      </section>
    </main>
  );
}
