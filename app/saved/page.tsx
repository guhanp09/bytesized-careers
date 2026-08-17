import { noindexPage } from "../../lib/seo/noindex";

// Authenticated surface: it carries its own noindex rather than relying on a
// robots.txt Disallow, which would stop the crawler reading this directive.
export const metadata = noindexPage("Saved");

import { getServerSession } from "next-auth";
import SavedLibraryClient, {
  type SavedJobView,
  type SavedTalentView,
} from "../../components/SavedLibraryClient";
import { PageHeader, StateCard } from "../../components/ui";
import { authOptions } from "../../lib/auth";
import {
  classifyBackendLoadResult,
  classifyBackendLoadResults,
  hasBackendSessionAuthError,
  type BackendLoadState,
} from "../../lib/backendLoadState";
import {
  getSavedSummary,
  listMySavedJobs,
  listMySavedTalent,
  type BackendTalentListing,
} from "../../lib/backendClient";
import type { Job } from "../../lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

type SavedSummary = Awaited<ReturnType<typeof getSavedSummary>>;
type SavedJobs = Awaited<ReturnType<typeof listMySavedJobs>>;
type SavedTalent = Awaited<ReturnType<typeof listMySavedTalent>>;

const snapshotString = (snapshot: Record<string, unknown> | undefined, keys: string[], fallback = "") => {
  for (const key of keys) {
    const value = snapshot?.[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return fallback;
};

const snapshotTags = (snapshot: Record<string, unknown> | undefined) => {
  const value = snapshot?.tags;
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
};

const formatInr = (amount: number) => `₹${new Intl.NumberFormat("en-IN").format(amount)}`;

const talentRate = (item: BackendTalentListing | null, snapshot?: Record<string, unknown>) => {
  if (item?.rate_note) return item.rate_note;
  if (item?.rate_min != null && item.rate_max != null) {
    return `${formatInr(Number(item.rate_min))}-${formatInr(Number(item.rate_max))}`;
  }
  if (item?.rate_min != null) return `${formatInr(Number(item.rate_min))}+`;
  return snapshotString(snapshot, ["rate", "rate_note"], "Rate flexible");
};

const talentName = (item: BackendTalentListing | null, snapshot?: Record<string, unknown>) =>
  item?.owner_display_name ||
  snapshotString(snapshot, ["owner_display_name", "name"], "") ||
  item?.owner_username
    ?.split(/[-_.\s]+/)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ") ||
  "Talent profile";

const talentTags = (item: BackendTalentListing | null, snapshot?: Record<string, unknown>) => {
  if (item) {
    return [...item.tools, ...item.platforms, item.niche, ...item.formats].filter((value): value is string =>
      Boolean(value)
    );
  }
  return snapshotTags(snapshot);
};

const savedJobView = (savedId: string, savedJobId: string, job: Job | null, snapshot?: Record<string, unknown>): SavedJobView => ({
  savedId,
  jobId: job?.id || savedJobId,
  title: job?.title || snapshotString(snapshot, ["title"], "Saved job"),
  identity: job?.channel.name || snapshotString(snapshot, ["channel_name", "identity"], "Hiring team"),
  budget: job?.budget || snapshotString(snapshot, ["budget"], "Budget flexible"),
  location: job?.location || snapshotString(snapshot, ["location"], "Remote"),
  tags: job?.tags?.length ? job.tags : snapshotTags(snapshot),
});

const savedTalentView = (
  savedId: string,
  savedListingId: string,
  item: BackendTalentListing | null,
  snapshot?: Record<string, unknown>
): SavedTalentView => ({
  savedId,
  listingId: item?.id || savedListingId,
  title: item?.title || snapshotString(snapshot, ["title"], "Talent listing"),
  name: talentName(item, snapshot),
  profileHref: item?.owner_username ? `/u/${encodeURIComponent(item.owner_username)}?view=talent` : null,
  rate: talentRate(item, snapshot),
  location: [item?.primary_role || item?.roles?.[0], item?.location, item?.timezone].filter(Boolean).join(" · ") || "Remote",
  tags: talentTags(item, snapshot),
  workSamplesCount: item?.portfolio_item_ids?.length || 0,
});

async function loadSavedSummary(token: string): Promise<BackendLoadState<SavedSummary>> {
  const summaryState = classifyBackendLoadResult(
    (await Promise.allSettled([getSavedSummary(token)]))[0]
  );
  if (summaryState.kind !== "error") return summaryState;

  const fallbackResults: [
    PromiseSettledResult<SavedJobs>,
    PromiseSettledResult<SavedTalent>,
  ] = await Promise.allSettled([listMySavedJobs(token), listMySavedTalent(token)]);
  const fallbackState = classifyBackendLoadResults<[SavedJobs, SavedTalent]>(fallbackResults);
  if (fallbackState.kind !== "ready") return fallbackState;

  const [savedJobs, savedTalent] = fallbackState.data;
  return {
    kind: "ready",
    data: {
      jobs: savedJobs.map((saved) => ({ saved, job: null })),
      talent: savedTalent.map((saved) => ({ saved, talent: null })),
    },
  };
}

export default async function SavedPage() {
  const session = await getServerSession(authOptions);
  const token = session?.backendAccessToken;

  if (!session?.user) {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
        <section className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Saved"
            description="Jobs and talent listings you want to revisit."
          />
          <StateCard
            icon="bookmark"
            title="Sign in to keep your shortlist together."
            description="Save promising roles and talent listings, then come back when you are ready to compare or reach out."
            actionLabel="Sign in"
            actionHref="/auth?mode=login&next=/saved"
          />
        </section>
      </main>
    );
  }

  const loadState =
    !token || hasBackendSessionAuthError(session)
      ? ({ kind: "auth" } as const)
      : await loadSavedSummary(token);

  if (loadState.kind === "auth") {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
        <section className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Saved"
            description="Jobs and talent listings you want to revisit."
          />
          <div data-testid="saved-auth-expired">
            <StateCard
              icon="bookmark"
              title="Your session has expired."
              description="Sign in again to see your saved jobs and talent listings."
              actionLabel="Sign in again"
              actionHref="/auth?mode=login&next=/saved"
            />
          </div>
        </section>
      </main>
    );
  }

  if (loadState.kind === "error") {
    return (
      <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
        <section className="mx-auto max-w-6xl space-y-6">
          <PageHeader
            title="Saved"
            description="Jobs and talent listings you want to revisit."
          />
          <div data-testid="saved-load-error">
            <StateCard
              icon="alert"
              title="Couldn’t load saved items."
              description="The backend is unreachable right now. Your saved items are safe — try again in a moment."
              actionLabel="Retry"
              actionHref="/saved"
            />
          </div>
        </section>
      </main>
    );
  }

  const jobs = loadState.data.jobs
    .slice(0, 40)
    .map((item) => savedJobView(item.saved.id, item.saved.job_id, item.job, item.saved.job_snapshot));
  const talent = loadState.data.talent
    .slice(0, 40)
    .map((item) =>
      savedTalentView(item.saved.id, item.saved.talent_listing_id, item.talent, item.saved.talent_snapshot)
    );

  return (
    <main className="min-h-[calc(100vh-56px)] bg-[#0b0b0f] px-4 py-8 text-white sm:px-6">
      <section className="mx-auto max-w-6xl space-y-6">
        <PageHeader
          title="Saved"
          description="Jobs and talent listings you want to revisit."
        />
        <SavedLibraryClient jobs={jobs} talent={talent} />
      </section>
    </main>
  );
}
