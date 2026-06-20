import { getServerSession } from "next-auth";
import { redirect } from "next/navigation";
import { PageHeader, StateCard } from "../../components/ui";
import { authOptions } from "../../lib/auth";
import YouHubClient from "../../components/you/YouHubClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function YouPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  // Applications and Drafts moved out of the /you profile tabs into their own
  // standalone workspaces; preserve any old links/state that still point here.
  const params = await searchParams;
  const tabParam = Array.isArray(params.tab) ? params.tab[0] : params.tab;
  if (tabParam === "applications") {
    redirect("/applications");
  }
  if (tabParam === "drafts") {
    redirect("/drafts");
  }

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
