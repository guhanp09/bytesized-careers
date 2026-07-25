/**
 * Per-job workload summaries.
 *
 * An agency with six open roles cannot answer "where should I spend the next
 * twenty minutes?" from one flat list. This groups the same derived state by
 * job so the answer is one glance — and every number leads somewhere, so the
 * summary is navigation rather than a dashboard.
 *
 * Two things it deliberately does not do:
 *
 * - **No percentages.** "62% complete" would imply a fixed denominator and a
 *   linear funnel. Hiring has neither: candidates leave, roles get re-scoped,
 *   and one great applicant can end a search that had thirty.
 * - **No implied progression.** The counts are independent facts about a job,
 *   not stages someone must pass through in order.
 */

import { backendStatusOf, pipelineContextLabelOf } from "./applicationPipeline.ts";
import { isArchivedInteraction, type OwnerInteraction } from "./ownerInteractions.ts";
import {
  deriveWorkQueue,
  type QueueSignals,
  type WorkQueuePreferences,
  NO_QUEUE_PREFERENCES,
} from "./workQueues.ts";

export type JobSummaryCountKey =
  | "new_to_review"
  | "reviewing"
  | "interviewing"
  | "decision_needed"
  | "hired"
  | "starred";

export type JobSummaryCount = {
  key: JobSummaryCountKey;
  label: string;
  count: number;
  /**
   * Where this number leads. Queue keys filter the Inbox; stage keys focus the
   * Pipeline. A count that leads nowhere is decoration.
   */
  target: { kind: "queue"; queue: string } | { kind: "stage"; stage: string } | { kind: "starred" };
};

export type JobWorkloadSummary = {
  /** Grouping key. The job title, since that is what the user recognises. */
  jobKey: string;
  title: string;
  /** Everything not archived. The number the header leads with. */
  activeCount: number;
  /** Only counts that are non-zero, in a fixed order. */
  counts: JobSummaryCount[];
  /** How many records here need something from the viewer right now. */
  outstandingCount: number;
};

const ORDER: Array<{
  key: JobSummaryCountKey;
  label: string;
  target: JobSummaryCount["target"];
}> = [
  { key: "new_to_review", label: "New", target: { kind: "queue", queue: "new_to_review" } },
  { key: "reviewing", label: "Reviewing", target: { kind: "stage", stage: "reviewing" } },
  { key: "interviewing", label: "Interviewing", target: { kind: "stage", stage: "interviewing" } },
  { key: "decision_needed", label: "Decision needed", target: { kind: "queue", queue: "decision_needed" } },
  { key: "hired", label: "Hired", target: { kind: "stage", stage: "hired" } },
  { key: "starred", label: "Saved", target: { kind: "starred" } },
];

/**
 * Group the viewer's received records by job.
 *
 * Sent records are excluded: a summary of "my applications" grouped by someone
 * else's job title would be a different product. Archived records are excluded
 * from every count except the active total, which they are also excluded from —
 * an archive is out of the workload by definition.
 */
export function jobWorkloadSummaries(
  items: OwnerInteraction[],
  signalsFor: (item: OwnerInteraction) => QueueSignals,
  options: {
    preferences?: WorkQueuePreferences;
    isStarred?: (item: OwnerInteraction) => boolean;
  } = {}
): JobWorkloadSummary[] {
  const preferences = options.preferences ?? NO_QUEUE_PREFERENCES;
  const isStarred = options.isStarred ?? (() => false);

  const groups = new Map<string, { title: string; items: OwnerInteraction[] }>();
  for (const item of items) {
    if (item.direction !== "received") continue;
    if (isArchivedInteraction(item)) continue;
    // The same label the Pipeline's context filter uses, so the two views group
    // identically. Falling back to `title` would silently group by the *person*
    // on records that carry no job snapshot, which reads as nonsense.
    const title = pipelineContextLabelOf(item);
    if (!title) continue;
    const group = groups.get(title);
    if (group) group.items.push(item);
    else groups.set(title, { title, items: [item] });
  }

  const summaries: JobWorkloadSummary[] = [];
  for (const [jobKey, group] of groups) {
    const counts = new Map<JobSummaryCountKey, number>();
    let outstanding = 0;
    for (const item of group.items) {
      const stage = backendStatusOf(item);
      const queue = deriveWorkQueue(item, signalsFor(item), preferences);
      if (queue) outstanding += 1;
      if (queue === "new_to_review") counts.set("new_to_review", (counts.get("new_to_review") ?? 0) + 1);
      if (queue === "decision_needed") {
        counts.set("decision_needed", (counts.get("decision_needed") ?? 0) + 1);
      }
      if (stage === "reviewing") counts.set("reviewing", (counts.get("reviewing") ?? 0) + 1);
      if (stage === "interviewing") counts.set("interviewing", (counts.get("interviewing") ?? 0) + 1);
      if (stage === "hired") counts.set("hired", (counts.get("hired") ?? 0) + 1);
      if (isStarred(item)) counts.set("starred", (counts.get("starred") ?? 0) + 1);
    }
    summaries.push({
      jobKey,
      title: group.title,
      activeCount: group.items.length,
      outstandingCount: outstanding,
      counts: ORDER.filter((entry) => (counts.get(entry.key) ?? 0) > 0).map((entry) => ({
        key: entry.key,
        label: entry.label,
        count: counts.get(entry.key) as number,
        target: entry.target,
      })),
    });
  }

  // Most outstanding work first, then the biggest role, then alphabetically so
  // the order is stable between renders rather than jumping as counts tie.
  return summaries.sort(
    (a, b) =>
      b.outstandingCount - a.outstandingCount ||
      b.activeCount - a.activeCount ||
      a.title.localeCompare(b.title)
  );
}

/**
 * Worth showing at all?
 *
 * One job is just the inbox with a heading, and grouping it would be noise
 * pretending to be structure.
 */
export function shouldShowJobSummaries(summaries: JobWorkloadSummary[]): boolean {
  return summaries.length > 1;
}
