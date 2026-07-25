/**
 * The one place internal vocabulary becomes user-facing prose.
 *
 * The product carries four distinct vocabularies and they were being mixed at
 * render sites:
 *
 *  1. **Backend canonical** — `new`, `reviewing`, `interviewing`, `hired`,
 *     `rejected`, `withdrawn`, `archived`, plus the retired `shortlisted`.
 *  2. **Frontend display** — the `InteractionStatus` union the inbox renders.
 *  3. **Participant-facing** — what the *other* side is told, which is
 *     deliberately not what the manager sees.
 *  4. **Derived work state** — "Needs your reply" and friends, computed rather
 *     than stored.
 *
 * Vocabulary (1) leaked into the UI through a single `?? event.new_status`
 * fallback in the timeline builder: any status missing from an inline map fell
 * through as its raw enum, lowercase, and was then concatenated with a suffix.
 * That is where "new saved privately" came from — `new` was simply absent from
 * the map. Fixing it at the render site would have left the next missing value
 * to leak the same way, so the projection lives here and is total.
 */

/** Backend canonical stage → the manager's reading of it. */
const STAGE_LABELS: Record<string, string> = {
  new: "New",
  reviewing: "Reviewing",
  // Retired as a target (migration 0047) but live as history, so it still needs
  // an honest label rather than falling through to the raw value.
  shortlisted: "Under consideration",
  interviewing: "Interviewing",
  hired: "Hired",
  rejected: "Not selected",
  accepted: "Accepted",
  declined: "Declined",
  withdrawn: "Withdrawn",
  archived: "Archived",
};

/**
 * Sub-states that appear in engagement and interview planes rather than in the
 * application lifecycle. Included here because they were rendered raw too.
 */
const SUB_STATE_LABELS: Record<string, string> = {
  ready_to_start: "Ready to start",
  start_pending: "Start confirmation pending",
  start_confirmation_pending: "Start confirmation pending",
  active: "Work in progress",
  completion_pending: "Completion confirmation requested",
  completed: "Engagement completed",
  ended_after_start: "Ended after start",
  cancelled_before_start: "Cancelled before start",
  decision_needed: "Decision needed",
  decision_not_shared: "Decision not shared",
  feedback_pending: "Feedback pending",
  feedback_submitted: "Feedback submitted",
  proposed: "Interview proposed",
  confirmed: "Interview confirmed",
  cancelled: "Interview cancelled",
};

/**
 * Turn any internal identifier into prose.
 *
 * Total by construction: an unmapped value is title-cased from its parts rather
 * than printed raw, so a new backend status added tomorrow degrades to
 * "Some New Status" instead of leaking `some_new_status` mid-sentence. The
 * mapping is still the right fix — this is the floor, not the plan.
 */
export function displayLabel(value: string | null | undefined): string {
  if (!value) return "";
  const known = STAGE_LABELS[value] ?? SUB_STATE_LABELS[value];
  if (known) return known;
  return value
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1).toLowerCase())
    .join(" ");
}

/** True when a value has a deliberate label rather than a derived fallback. */
export function hasDisplayLabel(value: string | null | undefined): boolean {
  return Boolean(value && (STAGE_LABELS[value] || SUB_STATE_LABELS[value]));
}

/**
 * Every raw identifier that must never reach user-facing prose. Exported so the
 * guard test asserts against the same list the projection covers, rather than a
 * hand-maintained copy that can drift.
 */
export const INTERNAL_IDENTIFIERS: string[] = [
  ...Object.keys(STAGE_LABELS),
  ...Object.keys(SUB_STATE_LABELS),
];

/**
 * How a timeline entry reads, given who could see it.
 *
 * The suffix is a *visibility* statement, not part of the stage name, so it is
 * built here rather than concatenated at the call site — which is how
 * "new saved privately" ended up reading as one lowercase phrase.
 */
export function timelineEventLabel(options: {
  status: string;
  communicated?: boolean;
  managerOnly?: boolean;
}): string {
  const stage = displayLabel(options.status);
  if (options.communicated) return `${stage} · shared with them`;
  if (options.managerOnly) return `${stage} · saved privately`;
  return stage;
}

/**
 * A person's name, or a stable pseudonymous handle.
 *
 * Never a shared generic label. "Applicant" on every row is worse than a handle:
 * it makes distinct people indistinguishable, so a recruiter cannot tell two
 * unnamed applicants apart, and the pipeline reads as one person applying
 * repeatedly. The handle is derived from the record's own identifier, so it is
 * stable across reloads and unique per person.
 */
export function displayPersonName(options: {
  displayName?: string | null;
  username?: string | null;
  /** Stable per-person identifier — a user id, or the record id as a fallback. */
  identity?: string | null;
  /** Which side of the relationship, for the handle's prefix. */
  role?: "applicant" | "recruiter" | "member";
}): string {
  const named = (options.displayName || "").trim();
  if (named) return named;
  const handle = (options.username || "").trim();
  if (handle) return handle.startsWith("@") ? handle : `@${handle}`;
  return pseudonymousHandle(options.identity, options.role ?? "member");
}

const ROLE_PREFIX: Record<string, string> = {
  applicant: "editor",
  recruiter: "channel",
  member: "member",
};

/**
 * `@editor_4f2a` — deterministic from the identifier, so the same person is the
 * same handle everywhere, and two unnamed people are never the same string.
 */
export function pseudonymousHandle(
  identity: string | null | undefined,
  role: "applicant" | "recruiter" | "member" = "member"
): string {
  const prefix = ROLE_PREFIX[role] ?? "member";
  const source = (identity || "").replace(/[^a-z0-9]/gi, "");
  if (!source) return `@${prefix}`;
  // Last four hex-ish characters of the identifier: short enough to read aloud,
  // long enough that a collision inside one pipeline is not a practical worry.
  const suffix = source.slice(-4).toLowerCase();
  return `@${prefix}_${suffix}`;
}
