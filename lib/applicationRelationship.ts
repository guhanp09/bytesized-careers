export type JobApplicationRelationshipStatus =
  | "new"
  | "reviewing"
  | "shortlisted"
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
  shortlisted: "Application shortlisted",
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
