import { getServerSession } from "next-auth";
import { PageHeader, StateCard } from "../../components/ui";
import { authOptions } from "../../lib/auth";
import YouHubClient from "../../components/you/YouHubClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function YouPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white px-4 sm:px-6 py-10">
        <section className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="You"
            description="Your CreatorJobs workspace for profile, portfolio, jobs, and saved marketplace activity."
          />
          <StateCard
            icon="user"
            title="Sign in to open your workspace."
            description="Keep your public profile, work samples, listings, and saved opportunities in one place."
            actionLabel="Sign in"
            actionHref="/auth"
          />
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white">
      <section className="mx-auto w-full max-w-[1760px] px-3 py-5 sm:px-5 sm:py-7 xl:px-6 2xl:px-8">
        <YouHubClient backendAccessToken={session.backendAccessToken} />
      </section>
    </main>
  );
}
