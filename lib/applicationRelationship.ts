/**
 * The status an applicant reads on their *own* application.
 *
 * `under_consideration` belongs here because this type describes a sender-facing
 * read, and the backend renames the legacy stored `shortlisted` on the way out.
 * Omitting it meant `STATUS_LABELS[status]` returned undefined and the job-detail
 * CTA showed a blank status for anyone holding a legacy record.
 */
export type JobApplicationRelationshipStatus =
  | "new"
  | "reviewing"
  | "shortlisted"
  | "under_consideration"
  | "interviewing"
  | "hired"
  | "rejected"
  | "archived"
  | "withdrawn";

const CLOSED_APPLICATION_STATUSES = new Set<JobApplicationRelationshipStatus>([
  "rejected",
  "archived",
  "withdrawn",
]);

const STATUS_LABELS: Record<JobApplicationRelationshipStatus, string> = {
  new: "Application submitted",
  reviewing: "Application under review",
  // Both spellings of the same historical state read the same way to the
  // person it happened to. "Shortlisted" is never shown as such.
  shortlisted: "Under consideration",
  under_consideration: "Under consideration",
  interviewing: "Interviewing",
  hired: "Hired",
  rejected: "Application not selected",
  archived: "Application archived",
  withdrawn: "Application withdrawn",
};

/** Job-detail CTA copy derived from the persisted application relationship. */
export function applicationRelationshipPresentation(status: JobApplicationRelationshipStatus) {
  const closed = CLOSED_APPLICATION_STATUSES.has(status);
  return {
    closed,
    statusLabel: STATUS_LABELS[status],
    actionLabel: closed ? "View application" : "Open conversation",
  };
}

export type TalentInterestRelationshipStatus =
  | "new"
  | "reviewing"
  | "accepted"
  | "declined"
  | "archived"
  | "withdrawn";

const CLOSED_INTEREST_STATUSES = new Set<TalentInterestRelationshipStatus>([
  "declined",
  "archived",
  "withdrawn",
]);

const INTEREST_STATUS_LABELS: Record<TalentInterestRelationshipStatus, string> = {
  new: "Hiring request sent",
  reviewing: "Hiring request under review",
  accepted: "Hiring request accepted",
  declined: "Hiring request declined",
  archived: "Hiring request archived",
  withdrawn: "Hiring request withdrawn",
};

/** Talent-detail CTA copy derived from the persisted hiring-request relationship. */
export function talentInterestRelationshipPresentation(status: TalentInterestRelationshipStatus) {
  const closed = CLOSED_INTEREST_STATUSES.has(status);
  return {
    closed,
    statusLabel: INTEREST_STATUS_LABELS[status],
    actionLabel: closed ? "View request" : "Open conversation",
  };
}
