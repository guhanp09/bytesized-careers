import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import JobActionsPanelClient from "../../../components/job-details/JobActionsPanelClient";
import OwnerListingControlsClient from "../../../components/OwnerListingControlsClient";
import JobDescriptionSections from "../../../components/job-details/JobDescriptionSections";
import JobHero from "../../../components/job-details/JobHero";
import { StateCard } from "../../../components/ui";
import { authOptions } from "../../../lib/auth";
import { getJobById as getJobByIdFromBackend, isLocalMocksEnabled } from "../../../lib/backendClient";
import { getJobById as getJobByIdFromLocal } from "../../../lib/repositories/jobRepository";
import { formatPostedLabel } from "../../../lib/format";

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
const SECONDARY_BTN_BRIGHTNESS = 0.88; // 👈 change this anytime (0.75–0.95)
const siteUrl = (process.env.NEXT_PUBLIC_SITE_URL || process.env.NEXTAUTH_URL || "http://localhost:3000").replace(
  /\/+$/,
  ""
);

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const job = isLocalMocksEnabled()
    ? await getJobByIdFromLocal(String(id))
    : await getJobByIdFromBackend(String(id));
  if (!job) {
    return { title: "Job not found | CreatorJobs" };
  }
  return {
    title: `${job.title} | CreatorJobs`,
    description: [job.channel.name, job.location, job.budget].filter(Boolean).join(" · "),
    alternates: {
      canonical: `/jobs/${encodeURIComponent(String(job.id))}`,
    },
    openGraph: {
      title: `${job.title} | CreatorJobs`,
      description: [job.channel.name, job.location, job.budget].filter(Boolean).join(" · "),
      type: "article",
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
  const job = isLocalMocksEnabled()
    ? await getJobByIdFromLocal(jobId)
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

  return (
    <main className="min-h-screen text-white bg-[#0b0b0f]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(jobPostingJsonLd) }}
      />
      <div className="px-4 sm:px-6 py-8">
        <div className="mx-auto max-w-6xl grid gap-6 lg:grid-cols-[1fr_420px] items-start">
          <div className="space-y-6">
            <JobHero job={job} postedText={postedText} titleScale={TITLE_SCALE} />
            <JobDescriptionSections job={job} />
          </div>

          <aside className="space-y-6 lg:sticky lg:top-20">
            {isOwner ? (
              <OwnerListingControlsClient
                kind="job"
                id={job.id}
                status={job.status}
                editHref={`/post-job?draftId=${encodeURIComponent(job.id)}`}
                activityHref="/activity?tab=applications"
              />
            ) : null}
            <JobActionsPanelClient
              job={job}
              secondaryBtnBrightness={SECONDARY_BTN_BRIGHTNESS}
            />
          </aside>
        </div>
      </div>
    </main>
  );
}
