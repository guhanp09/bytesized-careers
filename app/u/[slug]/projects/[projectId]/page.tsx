import type { Metadata } from "next";
import Link from "next/link";

import ProjectDetailPage from "../../../../../components/project/ProjectDetailPage";
import type { BackendPortfolioItem, BackendPublicProfileResponse } from "../../../../../lib/backendClient";
import { resolvePublicProfileWithTalentFallback } from "../../../../../lib/publicProfileFallback";
import { NOINDEX } from "../../../../../lib/seo/noindex";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * Placeholder values the profile API uses where a field was never filled in.
 * Repeating them in a page title or description would present "not shared" as
 * the project's own words.
 */
const PUBLIC_PLACEHOLDERS = ["not shared", "not set", "creator-economy profile"];

function cleanPublicText(value?: string | null) {
  const text = value?.trim();
  if (!text) return null;
  return PUBLIC_PLACEHOLDERS.includes(text.toLowerCase()) ? null : text;
}

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

/**
 * A shared portfolio project is a page people link to directly, and until now it
 * carried no metadata at all: it inherited the site-wide title, so every project
 * on the platform presented itself as the same page, with no description and no
 * canonical of its own.
 *
 * Every case that does not resolve to a real project — missing profile, moved
 * profile, missing project — is noindexed rather than titled optimistically. A
 * page that says "Project not found" must not be offered to a searcher as a
 * project.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string; projectId: string }>;
}): Promise<Metadata> {
  const { slug: rawSlug, projectId: rawProjectId } = await params;
  const username = decodeURIComponent(rawSlug || "").trim().toLowerCase();
  const projectId = decodeURIComponent(rawProjectId || "");

  const profile = await resolvePublicProfileWithTalentFallback(username);
  const project = profile
    ? [...(profile.portfolio_now || []), ...(profile.portfolio_past || [])].find(
        (item) => item.id === projectId,
      )
    : null;

  if (!profile || profile.moved_to_username || !project) {
    return { title: "Project unavailable | CreatorJobs", ...NOINDEX };
  }

  const title = cleanPublicText(project.title) || "Project";
  const owner = cleanPublicText(profile.display_name) || profile.username;
  const description =
    cleanPublicText(project.description) || `A project from ${owner} on CreatorJobs.`;

  return {
    title: `${title} by ${owner} | CreatorJobs`,
    description,
    alternates: {
      canonical: `/u/${encodeURIComponent(profile.username)}/projects/${encodeURIComponent(project.id)}`,
    },
    openGraph: {
      title: `${title} by ${owner}`,
      description,
      type: "article",
      images: project.thumbnail_url ? [{ url: project.thumbnail_url }] : undefined,
    },
    twitter: {
      card: project.thumbnail_url ? "summary_large_image" : "summary",
      title: `${title} by ${owner}`,
      description,
    },
  };
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
