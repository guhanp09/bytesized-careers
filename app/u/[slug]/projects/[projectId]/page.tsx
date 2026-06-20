import Link from "next/link";

import ProjectDetailPage from "../../../../../components/project/ProjectDetailPage";
import type { BackendPortfolioItem, BackendPublicProfileResponse } from "../../../../../lib/backendClient";
import { resolvePublicProfileWithTalentFallback } from "../../../../../lib/publicProfileFallback";

export const dynamic = "force-dynamic";
export const revalidate = 0;

function PublicProjectUnavailable({
  title,
  message,
  href = "/",
  label = "Back to jobs",
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

export default async function PublicProjectPage({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}) {
  const { slug: rawSlug, projectId: rawProjectId } = await params;
  const username = decodeURIComponent(rawSlug || "").trim().toLowerCase();
  const projectId = decodeURIComponent(rawProjectId || "");

  const profile: BackendPublicProfileResponse | null = await resolvePublicProfileWithTalentFallback(username);

  if (!profile) {
    return (
      <PublicProjectUnavailable
        title="Project unavailable"
        message="This public project could not be loaded right now."
        href={`/u/${encodeURIComponent(username)}`}
        label="Back to profile"
      />
    );
  }

  if (profile.moved_to_username) {
    return (
      <PublicProjectUnavailable
        title="Profile moved"
        message={`This profile moved to ${profile.moved_to_username}.`}
        href={`/u/${encodeURIComponent(profile.moved_to_username)}`}
        label="Open new profile"
      />
    );
  }

  const project: BackendPortfolioItem | null =
    [...(profile.portfolio_now || []), ...(profile.portfolio_past || [])].find((item) => item.id === projectId) || null;

  if (!project) {
    return (
      <PublicProjectUnavailable
        title="Project not found"
        message="This public project is unavailable."
        href={`/u/${encodeURIComponent(username)}`}
        label="Back to profile"
      />
    );
  }

  return (
    <ProjectDetailPage
      project={project}
      profile={profile}
      backHref={`/u/${encodeURIComponent(username)}?tab=portfolio`}
      backLabel="Back to profile"
      profileHref={`/u/${encodeURIComponent(username)}`}
    />
  );
}
