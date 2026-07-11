import { getServerSession } from "next-auth";
import { PageHeader, StateCard } from "../../components/ui";
import { authOptions } from "../../lib/auth";
import { isProductionRuntime } from "../../lib/backendClient";
import ApplicationsPageClient from "../../components/applications/ApplicationsPageClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function ApplicationsPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
        <section className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Applications"
            description="Track job applications, hiring requests, replies, and outcomes."
          />
          <StateCard
            icon="inbox"
            title="Sign in to open your applications."
            description="Your sent applications, received hiring requests, replies, and outcomes stay together in one private workspace."
            actionLabel="Sign in"
            actionHref="/auth?mode=login&next=/applications"
          />
        </section>
      </main>
    );
  }

  return (
    <main className="h-[calc(100dvh-56px)] min-h-[calc(100dvh-56px)] overflow-hidden bg-[#0b0b0f] text-white">
      <section className="mx-auto h-full min-h-0 w-full max-w-[1760px] px-3 sm:px-5 xl:px-6 2xl:px-8">
        {/* allowDemo is computed server-side: the client can't read APP_ENV/VERCEL_ENV,
            so the sample-data affordance is gated by the reliable server value. */}
        <ApplicationsPageClient
          backendAccessToken={session.backendAccessToken}
          backendUserId={session.backendUserId}
          allowDemo={!isProductionRuntime()}
        />
      </section>
    </main>
  );
}
