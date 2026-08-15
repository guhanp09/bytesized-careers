import type { Metadata } from "next";
import { getServerSession } from "next-auth";
import { notFound } from "next/navigation";
import JobActionsPanelClient from "../../../components/job-details/JobActionsPanelClient";
import JobOwnerControls from "../../../components/job-details/JobOwnerControls";
import JobDescriptionSections from "../../../components/job-details/JobDescriptionSections";
import JobHero from "../../../components/job-details/JobHero";
import { JobsBrowse } from "../page";
import { authOptions } from "../../../lib/auth";
import { getJobById as getJobByIdFromBackend, getPublicProfile } from "../../../lib/backendClient";
import { getMarketplaceDataSource } from "../../../lib/devDataSource.server";
import { formatPostedLabel } from "../../../lib/format";
import {
  cleanJobText,
  compensationForJob,
  roleForJob,
  workSetupForJob,
} from "../../../lib/jobPresentation";
import { JOBS } from "../../../lib/jobs";
import { getMockPublicTalentProfile } from "../../../lib/mockPublicTalentProfiles";
import { buildProfileReviewsHref, profileRatingSummaryFromProfile } from "../../../lib/profileRating";
import { getSeoFilterRoute, isSeoRouteIndexApproved } from "../../../lib/seoFilterRoutes";
import type { Job } from "../../../lib/types";
import { serializeJsonLd } from "../../../lib/jsonLd";

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

const SCHEMA_EMPLOYMENT_TYPES: Record<string, string> = {
  one_time_project: "CONTRACTOR",
  ongoing_freelance: "CONTRACTOR",
  retainer: "CONTRACTOR",
  part_time: "PART_TIME",
  full_time: "FULL_TIME",
  fixed_term: "TEMPORARY",
  internship: "INTERN",
};

function schemaDate(value?: string | null) {
  const raw = cleanJobText(value);
  if (!raw) return undefined;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

async function getJobChannelRating(job: Job, dataSource: "backend" | "mock") {
  const channelSlug = job.channelProfileSlug?.trim();
  if (!channelSlug) return null;
  const href = buildProfileReviewsHref(channelSlug, "hiring");
  const profile =
    dataSource === "mock"
      ? getMockPublicTalentProfile(channelSlug)
      : await getPublicProfile(channelSlug).catch(() => null);
  return profileRatingSummaryFromProfile(profile, href, "hiring");
}

export async function generateMetadata({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}): Promise<Metadata> {
  const { id } = await params;
  const seoRoute = getSeoFilterRoute("jobs", String(id));
  if (seoRoute) {
    const sp = (await searchParams) ?? {};
    const hasParams = Object.values(sp).some((v) => (Array.isArray(v) ? v.length > 0 : v != null && v !== ""));
    // Index only vouched curated routes with a clean URL. Un-vouched routes and
    // any Row-2 refinement variant (params) are noindex,follow with canonical
    // pointing at the clean route — never thin indexable pages.
    const indexApproved = isSeoRouteIndexApproved(seoRoute) && !hasParams;
    return {
      title: seoRoute.metaTitle,
      description: seoRoute.metaDescription,
      alternates: {
        canonical: seoRoute.path,
      },
      robots: indexApproved ? undefined : { index: false, follow: true },
      openGraph: {
        title: seoRoute.metaTitle,
        description: seoRoute.metaDescription,
        siteName: "CreatorJobs",
        type: "website",
      },
      twitter: {
        card: "summary",
        title: seoRoute.metaTitle,
        description: seoRoute.metaDescription,
      },
    };
  }
  const dataSource = await getMarketplaceDataSource();
  const job = dataSource === "mock"
    ? JOBS.find((item) => String(item.id) === String(id))
    : await getJobByIdFromBackend(String(id));
  if (!job) {
    return { title: "Job not found", robots: { index: false, follow: false } };
  }
  const compensation = compensationForJob(job);
  const role = roleForJob(job);
  const description = [
    cleanJobText(job.hiringDisplayName) || cleanJobText(job.channel.name),
    role.name !== "Role not specified" ? role.name : "",
    compensation.disclosed ? compensation.headline : "",
    workSetupForJob(job) !== "Work setup not specified" ? workSetupForJob(job) : "",
  ].filter(Boolean).join(" · ");
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
  const seoRoute = getSeoFilterRoute("jobs", jobId);
  if (seoRoute) {
    return (
      <>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: serializeJsonLd({
              "@context": "https://schema.org",
              "@type": "BreadcrumbList",
              itemListElement: [
                { "@type": "ListItem", position: 1, name: "Jobs", item: `${siteUrl}/jobs` },
                { "@type": "ListItem", position: 2, name: seoRoute.h1, item: `${siteUrl}${seoRoute.path}` },
              ],
            }),
          }}
        />
        <JobsBrowse searchParams={Promise.resolve({})} seoRoute={seoRoute} />
      </>
    );
  }
  const dataSource = await getMarketplaceDataSource();
  const job = dataSource === "mock"
    ? JOBS.find((item) => String(item.id) === jobId)
    : await getJobByIdFromBackend(jobId);
  const session = await getServerSession(authOptions);

  if (!job) {
    notFound();
  }

  const postedLabel = formatPostedLabel(job.postedShort);
  const postedText = postedLabel ? `Posted ${postedLabel}` : "";
  const description = [job.about, job.responsibilities, job.requirements]
    .map((value) => cleanJobText(value))
    .filter(Boolean)
    .join("\n\n");
  const engagementType = cleanJobText(job.engagementType).toLowerCase();
  const hiringOrganizationName =
    cleanJobText(job.hiringDisplayName) || cleanJobText(job.channel.name);
  const location = cleanJobText(job.location);
  const workMode = cleanJobText(job.workMode).toLowerCase();
  const isRemote = workMode === "remote" || (!workMode && location.toLowerCase() === "remote");
  const jobPostingJsonLd = {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: job.title,
    description: description || undefined,
    datePosted: schemaDate(job.createdAt),
    validThrough: schemaDate(job.deadlineAt),
    employmentType: engagementType ? SCHEMA_EMPLOYMENT_TYPES[engagementType] : undefined,
    hiringOrganization: hiringOrganizationName
      ? {
          "@type": "Organization",
          name: hiringOrganizationName,
        }
      : undefined,
    jobLocationType: isRemote ? "TELECOMMUTE" : undefined,
    jobLocation: location && !isRemote
      ? {
          "@type": "Place",
          address: {
            "@type": "PostalAddress",
            addressLocality: location,
          },
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
        dangerouslySetInnerHTML={{ __html: serializeJsonLd(jobPostingJsonLd) }}
      />
      <div className="px-4 pb-28 pt-8 sm:px-6 lg:pb-8">
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
