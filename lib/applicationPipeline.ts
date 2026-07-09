import {
  CUSTOM_INSTRUCTION_REQUIREMENT_KEY,
  isCurrencyAnswer,
  isPortfolioAnswer,
  isTurnaroundAnswer,
  summarizeAnswers,
  type RequirementContext,
  type RequirementIcon,
  type RequirementSummaryItem,
} from "./firstMessageRequirements.ts";
import type {
  InteractionDirection,
  InteractionKind,
  InteractionStatus,
  OwnerInteraction,
} from "./ownerInteractions";

/**
 * Pipeline domain for the applications workspace.
 *
 * The pipeline speaks the *backend* status vocabulary (job applications:
 * new/reviewing/shortlisted/interviewing/hired/rejected/archived/withdrawn;
 * hiring requests: new/reviewing/contacted/declined/archived/withdrawn) so a
 * stage move maps 1:1 onto the status endpoints. The inbox's display statuses
 * (`InteractionStatus`) are a lossy presentation layer on top; a reverse map
 * keeps demo/mock items usable in the pipeline too.
 */

/**
 * How informing the other side works for a stage the owner moved someone into.
 *
 * Statuses without a policy are internal-only: they exist for the owner's own
 * tracking and never message the counterparty. Statuses with a policy are
 * externally meaningful — after the move the workspace asks whether to post a
 * platform status update into the chat thread (never automatic).
 */
export type StageNotifyPolicy = {
  /** Whether the workspace should lead with "send" (true) or stay neutral. */
  recommended: boolean;
  /** The platform-voice chat update, e.g. `Shortlisted for “Thumbnail Designer”.` */
  notice: (context: { contextLabel: string | null }) => string;
};

export type PipelineStage = {
  /** Backend status value this stage represents. */
  key: string;
  /** Stage label from the viewer's point of view. */
  label: string;
  /** Tailwind classes for the stage dot. */
  dot: string;
  /** Terminal stages group at the end and don't read as active funnel steps. */
  terminal?: boolean;
  /** Present only on externally meaningful stages of manageable (received) boards. */
  notify?: StageNotifyPolicy;
};

const quoted = (label: string | null) => (label ? ` for “${label}”` : "");

/**
 * Stage taxonomy for received applications (the recruiter managing applicants).
 *
 * - new         — arrival state; set by the system; internal; reversible n/a.
 * - reviewing   — owner is reading; internal-only (never notifies); reversible.
 * - shortlisted — externally meaningful; notifying is allowed but optional
 *                 (owners often shortlist quietly while comparing); reversible.
 * - interviewing— externally meaningful; notifying recommended (the applicant
 *                 has to take part); reversible.
 * - hired       — outcome; notifying recommended; reversible via the menu in
 *                 case of misclicks, but treated as an end state.
 * - rejected    — outcome; notifying recommended (closure); terminal.
 * - withdrawn   — sender-only; the owner can never set it.
 * - archived    — tidy-up; internal-only; terminal.
 */
const APPLICATION_RECEIVED_STAGES: PipelineStage[] = [
  { key: "new", label: "New", dot: "bg-white" },
  { key: "reviewing", label: "Reviewing", dot: "bg-sky-300" },
  {
    key: "shortlisted",
    label: "Shortlisted",
    dot: "bg-violet-300",
    notify: { recommended: false, notice: ({ contextLabel }) => `Shortlisted${quoted(contextLabel)}.` },
  },
  {
    key: "interviewing",
    label: "Interviewing",
    dot: "bg-amber-300",
    notify: {
      recommended: true,
      notice: ({ contextLabel }) => `Invited to interview${quoted(contextLabel)}.`,
    },
  },
  {
    key: "hired",
    label: "Hired",
    dot: "bg-emerald-300",
    notify: { recommended: true, notice: ({ contextLabel }) => `Hired${quoted(contextLabel)}.` },
  },
  {
    key: "rejected",
    label: "Rejected",
    dot: "bg-rose-300/80",
    terminal: true,
    notify: {
      recommended: true,
      notice: ({ contextLabel }) => `Not moving forward${quoted(contextLabel)}.`,
    },
  },
  { key: "withdrawn", label: "Withdrawn", dot: "bg-white/35", terminal: true },
  { key: "archived", label: "Archived", dot: "bg-white/35", terminal: true },
];

const APPLICATION_SENT_STAGES: PipelineStage[] = [
  { key: "new", label: "Pending", dot: "bg-white" },
  { key: "reviewing", label: "Viewed", dot: "bg-sky-300" },
  { key: "shortlisted", label: "Shortlisted", dot: "bg-violet-300" },
  { key: "interviewing", label: "Interviewing", dot: "bg-amber-300" },
  { key: "hired", label: "Hired", dot: "bg-emerald-300" },
  { key: "rejected", label: "Not selected", dot: "bg-rose-300/80", terminal: true },
  { key: "withdrawn", label: "Withdrawn", dot: "bg-white/35", terminal: true },
  { key: "archived", label: "Archived", dot: "bg-white/35", terminal: true },
];

/**
 * Stage taxonomy for received hiring requests (the talent managing recruiters).
 *
 * - new       — arrival state; internal.
 * - reviewing — internal-only tracking; reversible.
 * - contacted — shown as "Accepted"; externally meaningful; notifying
 *               recommended (the recruiter is waiting on an answer); reversible.
 * - declined  — outcome; notifying recommended (closure); terminal.
 * - withdrawn — sender-only (the recruiter pulled the request).
 * - archived  — tidy-up; internal-only; terminal.
 */
const INTEREST_RECEIVED_STAGES: PipelineStage[] = [
  { key: "new", label: "New", dot: "bg-white" },
  { key: "reviewing", label: "Reviewing", dot: "bg-sky-300" },
  {
    key: "contacted",
    label: "Accepted",
    dot: "bg-emerald-300",
    notify: { recommended: true, notice: () => "Hiring request accepted." },
  },
  {
    key: "declined",
    label: "Declined",
    dot: "bg-rose-300/80",
    terminal: true,
    notify: { recommended: true, notice: () => "Hiring request declined." },
  },
  { key: "withdrawn", label: "Withdrawn", dot: "bg-white/35", terminal: true },
  { key: "archived", label: "Archived", dot: "bg-white/35", terminal: true },
];

const INTEREST_SENT_STAGES: PipelineStage[] = [
  { key: "new", label: "Pending", dot: "bg-white" },
  { key: "reviewing", label: "Viewed", dot: "bg-sky-300" },
  { key: "contacted", label: "Accepted", dot: "bg-emerald-300" },
  { key: "declined", label: "Declined", dot: "bg-rose-300/80", terminal: true },
  { key: "withdrawn", label: "Withdrawn", dot: "bg-white/35", terminal: true },
  { key: "archived", label: "Archived", dot: "bg-white/35", terminal: true },
];

export function pipelineStagesFor(kind: InteractionKind, direction: InteractionDirection): PipelineStage[] {
  if (kind === "application") {
    return direction === "received" ? APPLICATION_RECEIVED_STAGES : APPLICATION_SENT_STAGES;
  }
  return direction === "received" ? INTEREST_RECEIVED_STAGES : INTEREST_SENT_STAGES;
}

/**
 * Stages a manager may move a received item into. "new" is the arrival state
 * and "withdrawn" is sender-only, so neither is a manager target.
 */
export function stageTargetsFor(kind: InteractionKind): PipelineStage[] {
  if (kind === "application") {
    return APPLICATION_RECEIVED_STAGES.filter((stage) => stage.key !== "new" && stage.key !== "withdrawn");
  }
  return INTEREST_RECEIVED_STAGES.filter((stage) => stage.key !== "new" && stage.key !== "withdrawn");
}

/**
 * The notify policy for moving a received item into a stage, or null when the
 * stage is internal-only (reviewing, archived) and must never message anyone.
 */
export function stageNotifyPolicyOf(kind: InteractionKind, stageKey: string): StageNotifyPolicy | null {
  const stages = kind === "application" ? APPLICATION_RECEIVED_STAGES : INTEREST_RECEIVED_STAGES;
  return stages.find((stage) => stage.key === stageKey)?.notify ?? null;
}

export type WorkspaceModeKey = "talent" | "hiring";

/**
 * Workflow names for the two directions of a mode. "Received"/"Sent" are
 * technically right but mentally vague; within one mode each direction is one
 * uniform kind, so it can be named after the thing being managed.
 */
export function directionLabelsFor(mode: WorkspaceModeKey): { received: string; sent: string } {
  return mode === "hiring"
    ? { received: "Applicants", sent: "Outreach" }
    : { received: "Hiring requests", sent: "Applications" };
}

const PIPELINE_NOUNS: Record<WorkspaceModeKey, Record<InteractionDirection, [string, string]>> = {
  hiring: { received: ["applicant", "applicants"], sent: ["outreach request", "outreach requests"] },
  talent: { received: ["hiring request", "hiring requests"], sent: ["application", "applications"] },
};

/**
 * Compact at-a-glance summary of a pipeline, e.g. "6 applicants · 2 new ·
 * 1 interviewing": the total, how many just arrived, and the furthest-along
 * active stage that has people in it. Null when the board is empty.
 */
export function pipelineSummaryOf(
  items: Array<Pick<OwnerInteraction, "kind" | "status" | "backendStatus">>,
  kind: InteractionKind,
  direction: InteractionDirection,
  mode: WorkspaceModeKey
): string | null {
  if (items.length === 0) return null;
  const stages = pipelineStagesFor(kind, direction);
  const grouped = groupByStage(items, stages);
  const [singular, plural] = PIPELINE_NOUNS[mode][direction];
  const parts = [`${items.length} ${items.length === 1 ? singular : plural}`];
  const newStage = stages.find((stage) => stage.key === "new");
  const newCount = grouped.get("new")?.length ?? 0;
  if (newCount > 0 && newStage) parts.push(`${newCount} ${newStage.label.toLowerCase()}`);
  // The most advanced active stage with people in it tells the user where the
  // funnel currently reaches without listing every count.
  const active = stages.filter((stage) => !stage.terminal && stage.key !== "new");
  for (let index = active.length - 1; index >= 0; index -= 1) {
    const count = grouped.get(active[index].key)?.length ?? 0;
    if (count > 0) {
      parts.push(`${count} ${active[index].label.toLowerCase()}`);
      break;
    }
  }
  return parts.join(" · ");
}

const APPLICATION_DISPLAY_TO_BACKEND: Record<InteractionStatus, string> = {
  new: "new",
  pending: "new",
  viewed: "reviewing",
  responded: "interviewing",
  shortlisted: "shortlisted",
  accepted: "hired",
  hired: "hired",
  declined: "rejected",
  withdrawn: "withdrawn",
  closed: "archived",
};

const INTEREST_DISPLAY_TO_BACKEND: Record<InteractionStatus, string> = {
  new: "new",
  pending: "new",
  viewed: "reviewing",
  responded: "contacted",
  shortlisted: "reviewing",
  accepted: "contacted",
  hired: "contacted",
  declined: "declined",
  withdrawn: "withdrawn",
  closed: "archived",
};

/**
 * Resolve an interaction to backend status vocabulary. Live items carry the raw
 * value; demo/mock items fall back to a reverse map of their display status.
 */
export function backendStatusOf(item: Pick<OwnerInteraction, "kind" | "status" | "backendStatus">): string {
  if (item.backendStatus) return item.backendStatus;
  const map = item.kind === "application" ? APPLICATION_DISPLAY_TO_BACKEND : INTEREST_DISPLAY_TO_BACKEND;
  return map[item.status] ?? "new";
}

/** Group interactions under the given stages, preserving item order. */
export function groupByStage<T extends Pick<OwnerInteraction, "kind" | "status" | "backendStatus">>(
  items: T[],
  stages: PipelineStage[]
): Map<string, T[]> {
  const groups = new Map<string, T[]>(stages.map((stage) => [stage.key, []]));
  for (const item of items) {
    const key = backendStatusOf(item);
    const bucket = groups.get(key);
    if (bucket) {
      bucket.push(item);
    } else {
      // Unknown status: keep the item visible rather than silently dropping it.
      groups.set(key, [item]);
    }
  }
  return groups;
}

/** Case-insensitive match on the people/context fields a manager scans for. */
export function pipelineSearchMatch(
  item: Pick<OwnerInteraction, "title" | "counterpartyName" | "contextLabel" | "job" | "sourceListingTitle">,
  query: string
): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    item.title,
    item.counterpartyName,
    item.contextLabel,
    item.job?.title,
    item.sourceListingTitle,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

/** Distinct job/listing context labels present in the items, for the context filter. */
export function pipelineContextOptions(
  items: Array<Pick<OwnerInteraction, "job" | "sourceListingTitle" | "contextLabel">>
): string[] {
  const seen = new Set<string>();
  const options: string[] = [];
  for (const item of items) {
    const label = item.job?.title || item.sourceListingTitle || item.contextLabel || null;
    if (label && !seen.has(label)) {
      seen.add(label);
      options.push(label);
    }
  }
  return options;
}

export function pipelineContextLabelOf(
  item: Pick<OwnerInteraction, "job" | "sourceListingTitle" | "contextLabel">
): string | null {
  return item.job?.title || item.sourceListingTitle || item.contextLabel || null;
}

/**
 * Public profile of the person on the other side of the interaction. Mirrors
 * the inbox header's link logic: hiring requests point at the recruiter (or,
 * for sent ones, the talent who owns the listing); applications point at the
 * applicant (or, for sent ones, the hiring channel).
 */
export function pipelineProfileHrefOf(
  item: Pick<OwnerInteraction, "kind" | "job" | "talent" | "recruiter">
): string | null {
  const talentHref = item.talent?.profileSlug ? `/u/${item.talent.profileSlug}?view=talent` : null;
  const recruiterHref = item.recruiter?.profileSlug ? `/u/${item.recruiter.profileSlug}?view=hiring` : null;
  const channelHref = item.job?.channelProfileSlug ? `/u/${item.job.channelProfileSlug}?view=hiring` : null;
  return item.kind === "hiring_request" ? recruiterHref || talentHref : talentHref || channelHref;
}

const TURNAROUND_UNIT_SINGULAR: Record<string, string> = {
  hours: "hour",
  days: "day",
  weeks: "week",
};

export type PipelineCardFact = {
  /** Icon name signalling the fact type at a glance (rate, turnaround, start). */
  icon: "cash" | "clock" | "calendar";
  text: string;
};

/**
 * The short decision-making facts a manager scans on a pipeline card: proposed
 * terms first (they usually carry rate + turnaround already), otherwise the
 * structured first-message answers (rate, turnaround, start). Each fact carries
 * a type icon so the eye can find "the rate" without reading. Capped at two so
 * the card stays calm.
 */
export function pipelineCardFacts(
  item: Pick<OwnerInteraction, "proposedTerms" | "firstMessageAnswers">
): PipelineCardFact[] {
  if (item.proposedTerms?.trim()) return [{ icon: "cash", text: item.proposedTerms.trim() }];
  const answers = item.firstMessageAnswers || {};
  const facts: PipelineCardFact[] = [];
  const rate = answers["expected_rate"] ?? answers["project_budget"];
  if (isCurrencyAnswer(rate) && String(rate.amount).trim()) {
    facts.push({ icon: "cash", text: `₹${rate.amount} ${rate.unit}`.trim() });
  }
  const turnaround = answers["turnaround"];
  if (isTurnaroundAnswer(turnaround) && String(turnaround.value).trim()) {
    const unit = TURNAROUND_UNIT_SINGULAR[turnaround.unit] ?? turnaround.unit;
    facts.push({ icon: "clock", text: `${turnaround.value}-${unit} turnaround` });
  }
  const start = answers["start_availability"];
  if (typeof start === "string" && start.trim()) {
    facts.push({ icon: "calendar", text: start.trim() });
  }
  return facts.slice(0, 2);
}

/** Number of portfolio items attached to the first message (or legacy attachments). */
export function pipelinePortfolioCountOf(
  item: Pick<OwnerInteraction, "firstMessageAnswers" | "attachments">
): number {
  const portfolio = item.firstMessageAnswers?.["relevant_portfolio"];
  if (isPortfolioAnswer(portfolio) && portfolio.length > 0) return portfolio.length;
  return item.attachments?.length ?? 0;
}

/**
 * The card's first-message teaser. In the newer model the free-text message is
 * optional (only a system notification is sent by default) and the real "first
 * message" is the listing owner's structured requirements — so once those exist
 * the teaser is the fit note (the applicant's own words on fit), never the raw
 * message. Only a legacy interaction with no structured answers falls back to the
 * written message. Returns null when there's no single line to preview (the card
 * then shows a "First message" affordance for the requirements).
 */
export function pipelineSnippetOf(
  item: Pick<OwnerInteraction, "message" | "firstMessageAnswers">
): string | null {
  const answers = item.firstMessageAnswers;
  if (answers && Object.keys(answers).length > 0) {
    const fitNote = answers["fit_note"];
    return typeof fitNote === "string" && fitNote.trim() ? fitNote.trim() : null;
  }
  return item.message?.trim() || null;
}

/** The first-message context implied by the interaction kind. */
export function pipelineFirstMessageContext(item: Pick<OwnerInteraction, "kind">): RequirementContext {
  return item.kind === "application" ? "job" : "talent";
}

/** One condensed requirement line for the pipeline card's first-message tooltip. */
export type PipelineFirstMessageLine = {
  icon: RequirementIcon;
  label: string;
  value: string;
};

function firstMessageLineValue(entry: RequirementSummaryItem): string {
  if (entry.text?.trim()) return entry.text.trim();
  if (entry.links?.length) {
    const count = entry.links.length;
    const noun = entry.key === "relevant_portfolio" ? "item" : "link";
    return `${count} ${count === 1 ? noun : `${noun}s`}`;
  }
  return "";
}

/**
 * The listing owner's first-message requirements as the applicant answered them,
 * condensed to icon·label·value lines for the pipeline card tooltip. In the newer
 * model the free-text message is optional and the "first message" is really these
 * structured requirements — so the card surfaces them instead of assuming a
 * written cover note. Empty when the interaction carries no structured answers.
 */
export function pipelineFirstMessageLines(
  item: Pick<OwnerInteraction, "kind" | "firstMessageAnswers">
): PipelineFirstMessageLine[] {
  const answers = item.firstMessageAnswers;
  if (!answers || Object.keys(answers).length === 0) return [];
  return summarizeAnswers(Object.keys(answers), pipelineFirstMessageContext(item), answers)
    .map((entry) => ({
      icon: entry.icon,
      label: entry.key === CUSTOM_INSTRUCTION_REQUIREMENT_KEY ? "Screener" : entry.label,
      value: firstMessageLineValue(entry),
    }))
    .filter((line) => line.value);
}
