import Link from "next/link";
import { getServerSession } from "next-auth";
import ActivityStatusControls from "../../components/activity/ActivityStatusControls";
import OwnerListingControlsClient from "../../components/OwnerListingControlsClient";
import { Icon } from "../../components/Icons";
import { PageHeader, StateCard } from "../../components/ui";
import { authOptions } from "../../lib/auth";
import {
  getActivitySummary,
  type BackendJobApplication,
  type BackendTalentInterest,
  type BackendTalentListing,
} from "../../lib/backendClient";
import type { Job } from "../../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type Tab = "applications" | "interests" | "drafts" | "updates";

const tabs: Array<{ id: Tab; label: string }> = [
  { id: "applications", label: "Applications" },
  { id: "interests", label: "Interests" },
  { id: "drafts", label: "Drafts" },
  { id: "updates", label: "Updates" },
];

const first = (value?: string | string[]) => (Array.isArray(value) ? value[0] : value) || "";

const normalizeTab = (value: string): Tab => {
  if (value === "applicants") return "applications";
  if (value === "leads") return "interests";
  if (tabs.some((tab) => tab.id === value)) return value as Tab;
  return "applications";
};

const label = (value?: string | null) =>
  (value || "new")
    .split("_")
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");

const formatDate = (value?: string | null) => {
  if (!value) return "";
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) return "";
  return new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric" }).format(parsed);
};

const snapshotName = (snapshot: Record<string, unknown>) => {
  const candidates = [
    snapshot.display_name,
    snapshot.name,
    snapshot.username,
    snapshot.email,
  ];
  return candidates.find((item): item is string => typeof item === "string" && item.trim().length > 0) || "Applicant";
};

function StatusPill({ status }: { status?: string | null }) {
  return (
    <span className="rounded-full border border-white/10 bg-white/[0.05] px-2.5 py-1 text-[11px] font-semibold text-white/58">
      {label(status)}
    </span>
  );
}

function CardShell({ children }: { children: React.ReactNode }) {
  return (
    <article className="rounded-[26px] border border-white/[0.08] bg-white/[0.045] p-5 shadow-[0_18px_55px_-42px_rgba(0,0,0,0.95)] transition-[border-color,background-color,transform] duration-200 hover:-translate-y-0.5 hover:border-white/[0.14] hover:bg-white/[0.06]">
      {children}
    </article>
  );
}

function LinkButton({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <Link
      href={href}
      className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-semibold text-white/72 transition hover:bg-white/[0.08] hover:text-white"
    >
      {children}
    </Link>
  );
}

function ApplicationCard({
  application,
  job,
  received,
}: {
  application: BackendJobApplication;
  job: Job | null;
  received?: boolean;
}) {
  const applicant = snapshotName(application.applicant_snapshot || {});
  return (
    <CardShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={application.status} />
            {formatDate(application.created_at) ? (
              <span className="text-xs text-white/38">{formatDate(application.created_at)}</span>
            ) : null}
          </div>
          <h2 className="mt-3 line-clamp-2 text-base font-semibold text-white">
            {received ? applicant : job?.title || "Submitted application"}
          </h2>
          <p className="mt-1 line-clamp-1 text-sm text-white/52">
            {received ? `Applied to ${job?.title || "your job"}` : job?.channel.name || "Hiring team"}
          </p>
          {application.cover_note ? (
            <p className="mt-3 line-clamp-2 text-sm leading-6 text-white/62">{application.cover_note}</p>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {job ? <LinkButton href={`/jobs/${encodeURIComponent(job.id)}`}>Open job</LinkButton> : null}
          {received ? (
            <ActivityStatusControls kind="application" id={application.id} status={application.status} />
          ) : null}
        </div>
      </div>
    </CardShell>
  );
}

function InterestCard({
  interest,
  listing,
  job,
  received,
}: {
  interest: BackendTalentInterest;
  listing: BackendTalentListing | null;
  job: Job | null;
  received?: boolean;
}) {
  const title = listing?.title || "Talent listing";
  const person = listing?.owner_display_name || listing?.owner_username || "Talent";
  return (
    <CardShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill status={interest.status} />
            {interest.job_id ? (
              <span className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-semibold text-white/55">
                Job invite
              </span>
            ) : null}
            {formatDate(interest.created_at) ? (
              <span className="text-xs text-white/38">{formatDate(interest.created_at)}</span>
            ) : null}
          </div>
          <h2 className="mt-3 line-clamp-2 text-base font-semibold text-white">
            {received ? title : person}
          </h2>
          <p className="mt-1 line-clamp-1 text-sm text-white/52">
            {job ? `Attached to ${job.title}` : received ? "Recruiter contact request" : title}
          </p>
          {interest.note ? <p className="mt-3 line-clamp-2 text-sm leading-6 text-white/62">{interest.note}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          {listing ? <LinkButton href={`/talent/${encodeURIComponent(listing.id)}`}>Open listing</LinkButton> : null}
          {job ? <LinkButton href={`/jobs/${encodeURIComponent(job.id)}`}>Open job</LinkButton> : null}
          {received ? (
            <ActivityStatusControls kind="interest" id={interest.id} status={interest.status} />
          ) : null}
        </div>
      </div>
    </CardShell>
  );
}

function DraftCard({
  type,
  title,
  updatedAt,
  href,
  children,
}: {
  type: string;
  title: string;
  updatedAt?: string | null;
  href: string;
  children: React.ReactNode;
}) {
  return (
    <CardShell>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-white/38">{type}</p>
          <h2 className="mt-2 line-clamp-2 text-base font-semibold text-white">{title}</h2>
          {updatedAt ? <p className="mt-2 text-xs text-white/42">Updated {formatDate(updatedAt)}</p> : null}
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <LinkButton href={href}>Resume</LinkButton>
          {children}
        </div>
      </div>
    </CardShell>
  );
}

export default async function ActivityPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const session = await getServerSession(authOptions);
  const token = session?.backendAccessToken;
  const params = await searchParams;
  const activeTab = normalizeTab(first(params.tab));

  if (!token) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
        <section className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Activity"
            description="Applications, talent interest, drafts, and listing updates."
          />
          <StateCard
            icon="inbox"
            title="Sign in to see your marketplace activity."
            description="Applications, contact requests, and draft listings stay here so you can pick work back up without losing context."
            actionLabel="Sign in"
            actionHref="/auth?mode=login&next=/activity"
          />
        </section>
      </main>
    );
  }

  const summary = await getActivitySummary(token).catch(() => ({
    myJobs: [],
    myTalentListings: [],
    sentApplications: [],
    receivedApplications: [],
    receivedInterests: [],
    sentInterests: [],
    relatedJobs: [],
    relatedTalentListings: [],
  }));

  const {
    myJobs,
    myTalentListings: talentListings,
    sentApplications,
    receivedApplications,
    receivedInterests,
    sentInterests,
    relatedJobs,
    relatedTalentListings,
  } = summary;

  const jobsById = new Map<string, Job>();
  [...myJobs, ...relatedJobs].forEach((job) => {
    if (job) jobsById.set(job.id, job);
  });

  const listingsById = new Map<string, BackendTalentListing>();
  talentListings.forEach((listing) => listingsById.set(listing.id, listing));
  relatedTalentListings.forEach((listing) => {
    if (listing) listingsById.set(listing.id, listing);
  });

  const draftJobs = myJobs.filter((job) => job.status === "draft");
  const draftTalent = talentListings.filter((listing) => listing.status === "draft");
  const managedJobs = myJobs.filter((job) => job.status !== "draft");
  const managedTalent = talentListings.filter((listing) => listing.status !== "draft");

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Activity"
          description="Applications, talent interest, drafts, and listing updates."
        />

        <div className="flex flex-wrap gap-2 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-1.5">
          {tabs.map((tab) => (
            <Link
              key={tab.id}
              href={`/activity?tab=${tab.id}`}
              className={[
                "cursor-pointer rounded-xl px-3 py-2 text-sm font-semibold transition",
                activeTab === tab.id
                  ? "bg-white text-black shadow-[0_12px_30px_-24px_rgba(0,0,0,1)]"
                  : "text-white/65 hover:bg-white/[0.06] hover:text-white",
              ].join(" ")}
            >
              {tab.label}
            </Link>
          ))}
        </div>

        {activeTab === "applications" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-white/82">Sent applications</h2>
              {sentApplications.length ? (
                sentApplications.map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                    job={jobsById.get(application.job_id) || null}
                  />
                ))
              ) : (
                <StateCard
                  icon="briefcase"
                  title="No applications sent yet."
                  description="Applied jobs will appear here once you start reaching out."
                />
              )}
            </section>
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-white/82">Applicants</h2>
              {receivedApplications.length ? (
                receivedApplications.map((application) => (
                  <ApplicationCard
                    key={application.id}
                    application={application}
                    job={jobsById.get(application.job_id) || null}
                    received
                  />
                ))
              ) : (
                <StateCard
                  icon="users"
                  title="No applicants yet."
                  description="Applications to your posted jobs will appear here once talent starts responding."
                />
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "interests" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-white/82">Received interest</h2>
              {receivedInterests.length ? (
                receivedInterests.map((interest) => (
                  <InterestCard
                    key={interest.id}
                    interest={interest}
                    listing={listingsById.get(interest.talent_listing_id) || null}
                    job={interest.job_id ? jobsById.get(interest.job_id) || null : null}
                    received
                  />
                ))
              ) : (
                <StateCard
                  icon="inbox"
                  title="No incoming interest yet."
                  description="Recruiter messages and talent invites tied to your listings will appear here."
                />
              )}
            </section>
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-white/82">Sent outreach</h2>
              {sentInterests.length ? (
                sentInterests.map((interest) => (
                  <InterestCard
                    key={interest.id}
                    interest={interest}
                    listing={listingsById.get(interest.talent_listing_id) || null}
                    job={interest.job_id ? jobsById.get(interest.job_id) || null : null}
                  />
                ))
              ) : (
                <StateCard
                  icon="send"
                  title="No outreach sent yet."
                  description="Talent invites and contact requests you send from listings will appear here."
                />
              )}
            </section>
          </div>
        ) : null}

        {activeTab === "drafts" ? (
          <div className="space-y-4">
            {draftJobs.map((job) => (
              <DraftCard
                key={job.id}
                type="Job draft"
                title={job.title || "Untitled job draft"}
                updatedAt={job.updatedAt}
                href={`/post-job?draftId=${encodeURIComponent(job.id)}`}
              >
                <OwnerListingControlsClient
                  kind="job"
                  id={job.id}
                  status={job.status}
                  editHref={`/post-job?draftId=${encodeURIComponent(job.id)}`}
                  activityHref="/activity?tab=applications"
                />
              </DraftCard>
            ))}
            {draftTalent.map((listing) => (
              <DraftCard
                key={listing.id}
                type="Talent listing draft"
                title={listing.title || "Untitled talent listing draft"}
                updatedAt={listing.updated_at}
                href={`/post-talent?draftId=${encodeURIComponent(listing.id)}`}
              >
                <OwnerListingControlsClient
                  kind="talent"
                  id={listing.id}
                  status={listing.status}
                  editHref={`/post-talent?draftId=${encodeURIComponent(listing.id)}`}
                  activityHref="/activity?tab=interests"
                />
              </DraftCard>
            ))}
            {!draftJobs.length && !draftTalent.length ? (
              <StateCard
                icon="bookmark"
                title="No drafts yet."
                description="Saved job posts and talent listings will appear here once you start a draft."
              />
            ) : null}
          </div>
        ) : null}

        {activeTab === "updates" ? (
          <div className="grid gap-6 lg:grid-cols-2">
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-white/82">Your jobs</h2>
              {managedJobs.length ? (
                managedJobs.map((job) => (
                  <CardShell key={job.id}>
                    <div className="flex items-start gap-3">
                      <Icon name="briefcase" className="mt-1 h-4 w-4 text-white/48" />
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-base font-semibold text-white">{job.title}</h3>
                        <p className="mt-1 text-sm text-white/52">{job.channel.name}</p>
                        <div className="mt-3">
                          <OwnerListingControlsClient
                            kind="job"
                            id={job.id}
                            status={job.status}
                            editHref={`/post-job?draftId=${encodeURIComponent(job.id)}`}
                            activityHref="/activity?tab=applications"
                          />
                        </div>
                      </div>
                    </div>
                  </CardShell>
                ))
              ) : (
                <StateCard
                  icon="briefcase"
                  title="No active jobs yet."
                  description="Posted jobs will appear here once you publish something hiring-side."
                />
              )}
            </section>
            <section className="space-y-4">
              <h2 className="text-sm font-semibold text-white/82">Your talent listings</h2>
              {managedTalent.length ? (
                managedTalent.map((listing) => (
                  <CardShell key={listing.id}>
                    <div className="flex items-start gap-3">
                      <Icon name="user" className="mt-1 h-4 w-4 text-white/48" />
                      <div className="min-w-0 flex-1">
                        <h3 className="line-clamp-2 text-base font-semibold text-white">{listing.title}</h3>
                        <p className="mt-1 text-sm text-white/52">
                          {[listing.primary_role || listing.roles[0], listing.location, listing.timezone].filter(Boolean).join(" · ") || "Talent listing"}
                        </p>
                        <div className="mt-3">
                          <OwnerListingControlsClient
                            kind="talent"
                            id={listing.id}
                            status={listing.status}
                            editHref={`/post-talent?draftId=${encodeURIComponent(listing.id)}`}
                            activityHref="/activity?tab=interests"
                          />
                        </div>
                      </div>
                    </div>
                  </CardShell>
                ))
              ) : (
                <StateCard
                  icon="user"
                  title="No active talent listings yet."
                  description="Published talent listings will appear here once you put yourself on the marketplace."
                />
              )}
            </section>
          </div>
        ) : null}
      </section>
    </main>
  );
}
