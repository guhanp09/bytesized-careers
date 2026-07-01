import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import JobActionsPanelClient from "../../../components/job-details/JobActionsPanelClient";
import JobOwnerControls from "../../../components/job-details/JobOwnerControls";
import JobDescriptionSections from "../../../components/job-details/JobDescriptionSections";
import JobHero from "../../../components/job-details/JobHero";
import { StateCard } from "../../../components/ui";
import { authOptions } from "../../../lib/auth";
import { getJobById as getJobByIdFromBackend, getPublicProfile } from "../../../lib/backendClient";
import { getMarketplaceDataSource } from "../../../lib/devDataSource.server";
import { formatPostedLabel } from "../../../lib/format";
import { JOBS } from "../../../lib/jobs";
import { getMockPublicTalentProfile } from "../../../lib/mockPublicTalentProfiles";
import { buildProfileReviewsHref, profileRatingSummaryFromProfile } from "../../../lib/profileRating";
import type { Job } from "../../../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * -------------------------
 * TITLE SIZE CONTROL (YOU EDIT THIS)
 * -------------------------
 * Make the job title smaller/larger globally by changing TITLE_SCALE.
 * - 1.00 = baseline
 * - 0.92 = slightly smaller
 * - 0.85 = noticeably smaller
 */
const TITLE_SCALE = 0.58; // 👈 change this number
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(
  /\/+$/,
  ""
);

async function getJobChannelRating(job: Job, dataSource: "backend" | "mock") {
  const channelSlug = job.channelProfileSlug?.trim();
  if (!channelSlug) return null;
  const href = buildProfileReviewsHref(channelSlug, "hiring");
  const profile =
    dataSource === "mock"
      ? getMockPublicTalentProfile(channelSlug)
      : await getPublicProfile(channelSlug).catch(() => null);
  return profileRatingSummaryFromProfile(profile, href);
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const dataSource = await getMarketplaceDataSource();
  const job = dataSource === "mock"
    ? JOBS.find((item) => String(item.id) === String(id))
    : await getJobByIdFromBackend(String(id));
  if (!job) {
    return { title: "Job not found | CreatorJobs" };
  }
  const description = [job.channel.name, job.location, job.budget].filter(Boolean).join(" · ");
  const image = job.channel.logoUrl || undefined;
  return {
    title: `${job.title} | CreatorJobs`,
    description,
    alternates: {
      canonical: `/jobs/${encodeURIComponent(String(job.id))}`,
    },
    openGraph: {
      title: `${job.title} | CreatorJobs`,
      description,
      siteName: "CreatorJobs",
      type: "article",
      images: image ? [{ url: image }] : undefined,
    },
    twitter: {
      card: image ? "summary_large_image" : "summary",
      title: `${job.title} | CreatorJobs`,
      description,
    },
  };
}

export default async function JobDetailsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const jobId = String(id ?? "");
  const dataSource = await getMarketplaceDataSource();
  const job = dataSource === "mock"
    ? JOBS.find((item) => String(item.id) === jobId)
    : await getJobByIdFromBackend(jobId);
  const session = await getServerSession(authOptions);

  if (!job) {
    return (
      <main className="min-h-screen text-white bg-[#0b0b0f] px-4 sm:px-6 py-10">
        <div className="mx-auto max-w-5xl">
          <StateCard
            icon="briefcase"
            title="Job not found"
            description="This listing is unavailable or has already been removed."
            actionLabel="Browse jobs"
            actionHref="/jobs"
          />
        </div>
      </main>
    );
  }

  const postedLabel = formatPostedLabel(job.postedShort);
  const postedText = postedLabel ? `Posted ${postedLabel}` : "Posted just now";
  const jobPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: [job.about, job.responsibilities, job.requirements].filter(Boolean).join("\n\n"),
    datePosted: new Date().toISOString(),
    employmentType: "CONTRACTOR",
    hiringOrganization: {
      "@type": "Organization",
      name: job.channel.name,
    },
    jobLocationType: job.location?.toLowerCase().includes("remote") ? "TELECOMMUTE" : undefined,
    applicantLocationRequirements: job.location
      ? {
          "@type": "Country",
          name: job.location,
        }
      : undefined,
    url: `${siteUrl}/jobs/${encodeURIComponent(String(job.id))}`,
  };
  const isOwner = Boolean(session?.backendUserId && job.postedByUserId === session.backendUserId);
  const channelRating = await getJobChannelRating(job, dataSource);

  return (
    <main className="min-h-screen text-white bg-[#0b0b0f]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingJsonLd) }}
      />
      <div className="px-4 sm:px-6 py-8">
        <div className="mx-auto grid max-w-6xl min-w-0 items-start gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)]">
          <div className="min-w-0 space-y-6">
            <JobHero
              job={job}
              postedText={postedText}
              titleScale={TITLE_SCALE}
              channelRating={channelRating}
              ownerControls={
                isOwner ? (
                  <JobOwnerControls
                    jobId={job.id}
                    status={job.status}
                    editHref={`/post-job?draftId=${encodeURIComponent(job.id)}`}
                    applicantsHref="/applications?view=hiring"
                  />
                ) : null
              }
            />
            <JobDescriptionSections job={job} />
          </div>

          <aside className="min-w-0 space-y-6 lg:sticky lg:top-20">
            <JobActionsPanelClient
              job={job}
              isOwner={isOwner}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}
