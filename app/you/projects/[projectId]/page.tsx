import Link from "next/link";
import { getServerSession } from "next-auth";

import OwnerProjectDetailClient from "../../../../components/project/OwnerProjectDetailClient";
import { authOptions } from "../../../../lib/auth";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function ProjectUnavailable({
  title,
  message,
  href = "/you?tab=portfolio",
  label = "Back to Work",
}: {
  title: string;
  message: string;
  href?: string;
  label?: string;
}) {
  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-10 text-white sm:px-6">
      <section className="mx-auto flex min-h-[65vh] max-w-xl items-center justify-center">
        <div className="w-full rounded-3xl border border-white/10 bg-white/[0.055] p-6 text-center shadow-[0_22px_70px_-44px_rgba(0,0,0,1)]">
          <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
          <p className="mt-2 text-sm leading-relaxed text-white/58">{message}</p>
          <Link
            href={href}
            className="mt-6 inline-flex h-10 items-center justify-center rounded-full border border-white/10 bg-white/[0.06] px-4 text-sm font-semibold text-white/78 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            {label}
          </Link>
        </div>
      </section>
    </main>
  );
}

export default async function OwnerProjectPage({
  params,
}: {
  params: Promise<{ projectId: string }>;
}) {
  const { projectId: rawProjectId } = await params;
  const projectId = decodeURIComponent(rawProjectId || "");
  const session = await getServerSession(authOptions);

  if (!session?.user) {
    return (
      <ProjectUnavailable
        title="Sign in to view this project"
        message="Owner project pages require an authenticated CreatorJobs account."
        href="/auth"
        label="Sign in"
      />
    );
  }

  return (
    <OwnerProjectDetailClient
      projectId={projectId}
      initialBackendAccessToken={session.backendAccessToken}
    />
  );
}
