/**
 * Whether a job may still present itself to a search engine as a job.
 *
 * This is the rule job sites get penalised for, and it is easy to miss because
 * nothing visibly breaks. `JobPosting` structured data is a machine-readable
 * claim that a role is open and can be applied to. Leaving it on a closed or
 * expired posting means an aggregator keeps showing it, someone clicks it, and
 * they find a job that no longer exists — which is the specific complaint behind
 * Google's requirement to remove a posting when it closes, and behind the manual
 * actions issued for not doing so.
 *
 * The status alone is not enough. A posting can be `published` and still have a
 * `validThrough` in the past, which makes it expired in exactly the way that
 * matters to an aggregator while looking fine in the database.
 */

/** Statuses in which a job is genuinely open to applications. */
const OPEN_STATUSES = new Set(["published", "featured"]);

export type JobPostingVisibility = {
  /** Emit `JobPosting` structured data. Only ever true for a live, open role. */
  structuredData: boolean;
  /** Let a search engine index the page. */
  indexable: boolean;
  /**
   * Why, for the tests and for whoever is reading this in six months wondering
   * why their closed job vanished from search.
   */
  reason: string;
};

/**
 * The rule, in one place because it has to be identical in the page's metadata
 * and in its structured data. Those are two different functions in a Next route,
 * and the failure mode of duplicating it is a page that noindexes itself while
 * still publishing a JobPosting — or the reverse, which is worse.
 */
export function jobPostingVisibility(job: {
  status?: string | null;
  deadlineAt?: string | null;
}, now: Date = new Date()): JobPostingVisibility {
  const status = (job.status || "").trim().toLowerCase();

  if (!OPEN_STATUSES.has(status)) {
    // Covers closed, archived, paused and draft. Paused is deliberately in here:
    // it means "not accepting applications right now", and structured data has
    // no way to express a pause — an aggregator reads its absence correctly and
    // its presence as an open role.
    return {
      structuredData: false,
      indexable: false,
      reason: `status is ${status || "unset"}, which is not open to applications`,
    };
  }

  const deadline = parseDeadline(job.deadlineAt);
  if (deadline && deadline.getTime() < now.getTime()) {
    // Published but past its own deadline. The database says open; the posting
    // says otherwise, and the posting is what an applicant relies on.
    return {
      structuredData: false,
      indexable: false,
      reason: "the application deadline has passed",
    };
  }

  return {
    structuredData: true,
    indexable: true,
    reason: "open to applications",
  };
}

function parseDeadline(value?: string | null): Date | null {
  const raw = value?.trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
