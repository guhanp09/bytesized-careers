/**
 * Truthful progress for the draft assistant.
 *
 * The rule this module exists to enforce: a stage is only ever reported complete
 * because a real, observed state change made it complete. There is no timer, no
 * synthetic percentage, and no way for a caller to nudge progress forward. Every
 * function here is pure and takes the observed state as its argument, which is
 * what makes the claim testable rather than merely intended.
 *
 * The provider call is atomic — the backend cannot tell us how far through the
 * extraction it is — so the stage that covers it is modelled as *active with
 * unknown remaining work*, never as a creeping percentage. The bar holds the
 * portion that is genuinely earned and animates only within the active segment.
 */

import type { JobImportDraft, JobImportSourceType } from "./jobImportReadiness.ts";

export type JobImportStageId =
  | "source_accepted"
  | "page_retrieved"
  | "source_normalized"
  | "structuring"
  | "provider_returned"
  | "validated"
  | "answers_merged"
  | "draft_prepared";

export type JobImportStageStatus = "pending" | "active" | "complete" | "failed";

export type JobImportStage = {
  id: JobImportStageId;
  /** Recruiter-facing. Never names a provider, schema, span, or lifecycle. */
  label: string;
  status: JobImportStageStatus;
  /**
   * True when the stage is genuinely in flight and its remaining work cannot be
   * measured. The bar animates this segment instead of advancing through it.
   */
  indeterminate: boolean;
};

/** What the client has actually observed, and nothing it has merely assumed. */
export type JobImportProgressInput = {
  sourceType: JobImportSourceType;
  /** Null before the source call returns. */
  draft: JobImportDraft | null;
  /** True once the source POST resolved. */
  sourceCreated: boolean;
  /** True once apply/attach produced a native draft. */
  nativeDraftReady: boolean;
  failed?: boolean;
};

const URL_STAGES: readonly JobImportStageId[] = [
  "source_accepted",
  "page_retrieved",
  "source_normalized",
  "structuring",
  "provider_returned",
  "validated",
  "answers_merged",
  "draft_prepared",
];

const TEXT_STAGES: readonly JobImportStageId[] = [
  "source_accepted",
  "source_normalized",
  "structuring",
  "provider_returned",
  "validated",
  "answers_merged",
  "draft_prepared",
];

const STAGE_LABELS: Readonly<Record<JobImportStageId, string>> = {
  source_accepted: "Job details received",
  page_retrieved: "Opened the public job post",
  source_normalized: "Read the job information",
  structuring: "Matching the details to CreatorJobs",
  provider_returned: "Details organised",
  validated: "Checked against the CreatorJobs listing rules",
  answers_merged: "Your answers applied",
  draft_prepared: "Private draft prepared",
};

/** Draft statuses that mean extraction has genuinely finished. */
const PROCESSED_STATUSES: ReadonlySet<string> = new Set([
  "awaiting_recruiter_review",
  "partially_reviewed",
  "ready_to_apply",
  "applied_to_native_draft",
]);

export function jobImportStageOrder(
  sourceType: JobImportSourceType
): readonly JobImportStageId[] {
  return sourceType === "public_url" ? URL_STAGES : TEXT_STAGES;
}

/**
 * The last stage that observed state proves is finished.
 *
 * Each branch below names the evidence it relies on. If there is no evidence for
 * a stage, the stage is not complete — that is the whole contract.
 */
function completedThrough(input: JobImportProgressInput): number {
  const order = jobImportStageOrder(input.sourceType);
  const indexOf = (id: JobImportStageId) => order.indexOf(id);
  const { draft } = input;

  if (draft && input.nativeDraftReady) {
    return indexOf("draft_prepared");
  }
  if (draft && PROCESSED_STATUSES.has(draft.processing_status)) {
    // Fields exist, so extraction returned, was validated against field policy,
    // and any early recruiter answers were merged in the same transaction.
    return indexOf("answers_merged");
  }
  if (draft && draft.processing_status === "processing") {
    // The source row exists and was normalized on the way in; for a URL source
    // the page was also fetched. Nothing beyond that is yet observable.
    return indexOf("source_normalized");
  }
  if (draft) {
    // Draft row exists but processing has not started.
    return indexOf("source_normalized");
  }
  if (input.sourceCreated) {
    return indexOf("source_accepted");
  }
  return -1;
}

export function jobImportStages(input: JobImportProgressInput): JobImportStage[] {
  const order = jobImportStageOrder(input.sourceType);
  const through = completedThrough(input);
  const activeIndex = through + 1;

  return order.map((id, index) => {
    let status: JobImportStageStatus;
    if (index <= through) {
      status = "complete";
    } else if (index === activeIndex) {
      status = input.failed ? "failed" : "active";
    } else {
      status = "pending";
    }

    // Only the extraction stage is unmeasurable. Every other active stage is a
    // short client operation whose completion we will observe imminently.
    const indeterminate = status === "active" && id === "structuring";

    return { id, label: STAGE_LABELS[id], status, indeterminate };
  });
}

/**
 * Fraction of the bar that has been *earned*, in [0, 1].
 *
 * This deliberately reports completed stages only. The active stage contributes
 * nothing, because contributing a fraction of an unmeasurable stage is exactly
 * the fake-percentage behaviour this module refuses. The active segment is
 * animated by the view instead.
 */
export function jobImportProgressRatio(input: JobImportProgressInput): number {
  const order = jobImportStageOrder(input.sourceType);
  const completed = jobImportStages(input).filter(
    (stage) => stage.status === "complete"
  ).length;
  return order.length === 0 ? 0 : completed / order.length;
}

export function activeJobImportStage(
  input: JobImportProgressInput
): JobImportStage | null {
  return jobImportStages(input).find((stage) => stage.status === "active") ?? null;
}

/**
 * Reassurance for a long extraction, chosen from real source characteristics.
 *
 * Returns null when nothing truthful can be said, which is the common case. A
 * caller that gets null must stay silent rather than reach for filler.
 */
export function jobImportDelayMessage(
  input: JobImportProgressInput,
  sourceCharacterCount: number | null
): string | null {
  const active = activeJobImportStage(input);
  if (!active || active.id !== "structuring") return null;
  if (sourceCharacterCount !== null && sourceCharacterCount > 6_000) {
    return "This is a detailed post, so I'm still working through the responsibilities and requirements.";
  }
  return "I'm checking these details carefully rather than guessing at them.";
}
