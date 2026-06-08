import { getServerSession } from "next-auth";
import { PageHeader, StateCard } from "../../../components/ui";
import { authOptions } from "../../../lib/auth";
import YouHubClient from "../../../components/you/YouHubClient";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export default async function EditYouPage() {
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
        <section className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Edit profile"
            description="Update the public details, tools, and work samples that shape your marketplace profile."
          />
          <StateCard
            icon="user"
            title="Sign in to edit your profile."
            description="Profile editing stays tied to your account so your public details and work samples stay consistent."
            actionLabel="Sign in"
            actionHref="/auth?mode=login&next=/you/edit"
          />
        </section>
      </main>
    );
  }

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] text-white">
      <section className="mx-auto w-full max-w-[1400px] px-4 py-5 sm:px-6 sm:py-7 xl:px-8">
        <YouHubClient backendAccessToken={session.backendAccessToken} mode="edit" />
      </section>
    </main>
  );
}
